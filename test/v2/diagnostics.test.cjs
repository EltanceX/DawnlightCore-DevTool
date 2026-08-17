const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { CONTRACT_VERSIONS, LSP_METHODS } = require('../../packages/contracts/dist');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const root = path.resolve(__dirname, '..', '..');
const serverPath = path.join(root, 'dist', 'server.js');

function createWorkspace(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-diagnostics-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const write = (relativePath, value) => {
    const target = path.join(workspace, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(target, text);
    return { path: target, uri: pathToFileURL(target).toString(), text };
  };
  return { workspace, write };
}

function open(harness, file, languageId = 'jsonc') {
  harness.sendNotification('textDocument/didOpen', {
    textDocument: { uri: file.uri, languageId, version: 1, text: file.text }
  });
}

async function waitForDiagnostics(notifications, files, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const latest = new Map();
    for (const file of files) {
      const matching = [...notifications].reverse().find(item => item.uri === file.uri);
      if (matching) latest.set(file.uri, matching);
    }
    if (predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const latest = new Map();
  for (const file of files) {
    const matching = [...notifications].reverse().find(item => item.uri === file.uri);
    if (matching) latest.set(file.uri, matching);
  }
  return latest;
}

function sourceCodes(params) {
  return new Map((params?.diagnostics || []).map(diagnostic => [
    diagnostic.source,
    [...(params?.diagnostics || [])].filter(item => item.source === diagnostic.source)
      .map(item => item.code)
  ]));
}

test('publishes independent L0/L2 sources with precise cross-file diagnostics', async t => {
  const { workspace, write } = createWorkspace(t);
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:diagnostics',
    name: 'Diagnostics',
    version: '0.1.0',
    shaderRoot: 'shaders',
    settings: 'ui/settings.json',
    fragments: ['config/definitions.json', 'config/usage.json', 'config/missing.json']
  });
  const definitions = write('config/definitions.json', {
    options: [
      { id: 'example:enabled', type: 'boolean', default: true, impact: ['uniform'] },
      { id: 'example:number', type: 'number', default: 1, impact: ['uniform'] },
      { id: 'example:omitted', type: 'boolean', default: false, impact: ['uniform'] }
    ],
    resources: [
      { id: 'example:color', kind: 'texture2D', lifetime: 'persistent', size: { mode: 'viewport' }, format: 'rgba8' },
      { id: 'example:depth', kind: 'texture2D', lifetime: 'persistent', size: { mode: 'viewport' }, format: 'depth24' },
      { id: 'example:buffer', kind: 'buffer', lifetime: 'persistent' }
    ],
    programs: [
      { id: 'example:graphics', kind: 'graphics', vertex: 'missing.vsh', fragment: 'missing.psh' },
      { id: 'example:compute', kind: 'compute', compute: 'missing.csh' }
    ],
    passes: [{
      id: 'example:pass',
      stage: {
        template: 'dawnlight:stage', version: 1, target: 'world', phase: 'main',
        ordering: { after: ['example:pass'] }
      },
      programs: [],
      commands: [
        { type: 'compute', program: 'example:graphics', bindings: [{
          kind: 'sampler2D', symbol: 'Color', binding: 0, resource: 'example:buffer'
        }], targets: { colors: [{ location: 0, resource: 'example:depth' }] } },
        { type: 'historyCommit', resource: 'example:color' }
      ]
    }]
  });
  const usage = write('config/usage.json', {
    options: [
      { id: 'example:duplicate', type: 'boolean', default: true, impact: ['uniform'] },
      { id: 'example:duplicate', type: 'boolean', default: false, impact: ['uniform'] }
    ],
    resources: [{
      id: 'example:asset', kind: 'texture2D', lifetime: 'persistent',
      size: { mode: 'viewport' }, format: 'rgba8', content: { type: 'asset', path: 'assets/missing.png' }
    }],
    passes: [{
      id: 'example:usage', programs: ['example:graphics'], commands: [],
      enabledWhen: [{ option: 'example:missing-option', equals: true }],
      inputs: ['example:missing-resource']
    }]
  });
  const settings = write('ui/settings.json', {
    schemaVersion: 1,
    translations: { 'en-US': { 'page.present': 'Present' } },
    unexpected: true,
    pages: [{
      id: 'main', title: 'page.missing', groups: [{
        id: 'controls', title: 'Controls', controls: [
          { id: 'enabled-a', option: 'example:enabled', widget: 'toggle', label: 'Enabled' },
          { id: 'enabled-b', option: 'example:enabled', widget: 'toggle', label: 'Enabled again' },
          { id: 'number', option: 'example:number', widget: 'toggle', label: 'Number' },
          { id: 'unknown', option: 'example:unknown-ui', widget: 'toggle', label: 'Unknown' }
        ]
      }]
    }]
  });

  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile, 'json');
  open(harness, definitions);
  open(harness, usage);
  open(harness, settings, 'json');

  const latest = await waitForDiagnostics(notifications, [rootFile, definitions, usage, settings], value => {
    const all = [...value.values()].flatMap(params => params.diagnostics || []);
    const sources = new Set(all.map(diagnostic => diagnostic.source));
    return sources.has('dawnlight-path') && sources.has('dawnlight-symbol') &&
      sources.has('dawnlight-graph') && sources.has('dawnlight-schema');
  });
  assert.ok(latest.has(rootFile.uri));
  const rootCodes = sourceCodes(latest.get(rootFile.uri));
  assert.ok(rootCodes.get('dawnlight-path')?.includes('DLPATH0004'));

  const usageCodes = sourceCodes(latest.get(usage.uri));
  assert.ok(usageCodes.get('dawnlight-symbol')?.includes('DLSYMBOL0001'));
  assert.ok(usageCodes.get('dawnlight-symbol')?.includes('DLSYMBOL0002'));
  assert.ok(usageCodes.get('dawnlight-path')?.includes('DLPATH0004'));

  const definitionCodes = sourceCodes(latest.get(definitions.uri));
  assert.ok(definitionCodes.get('dawnlight-path')?.includes('DLPATH0004'));
  const graphCodes = definitionCodes.get('dawnlight-graph') || [];
  for (const expected of ['DLGRAPH0001', 'DLGRAPH0002', 'DLGRAPH0004', 'DLGRAPH0005', 'DLGRAPH0006', 'DLGRAPH0007']) {
    assert.ok(graphCodes.includes(expected), `${expected} missing: ${graphCodes.join(', ')}`);
  }
  assert.ok(graphCodes.includes('DLGRAPH0011'));

  const settingsCodes = sourceCodes(latest.get(settings.uri));
  assert.ok(settingsCodes.get('dawnlight-schema')?.length > 0);
  assert.ok(settingsCodes.get('dawnlight-symbol')?.includes('DLSYMBOL0002'));
  const settingsGraphCodes = settingsCodes.get('dawnlight-graph') || [];
  for (const expected of ['DLGRAPH0008', 'DLGRAPH0009', 'DLGRAPH0010']) {
    assert.ok(settingsGraphCodes.includes(expected), `${expected} missing: ${settingsGraphCodes.join(', ')}`);
  }
  assert.ok((latest.get(settings.uri).diagnostics || []).every(diagnostic => diagnostic.source));

  await harness.shutdown();
});

test('syntax diagnostics and stale schema results do not erase other sources', async t => {
  const { workspace, write } = createWorkspace(t, 'dawnlight-diagnostics-stale-');
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:stale', name: 'Stale', version: '0.1.0',
    fragments: ['fragment.json']
  });
  const fragment = write('fragment.json', {
    options: [{ id: 'example:enabled', type: 'boolean', default: true, impact: ['uniform'] }],
    passes: [{ id: 'example:pass', programs: [], commands: [], enabledWhen: [{ option: 'example:unknown' }] }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile, 'json');
  open(harness, fragment);
  await waitForDiagnostics(notifications, [fragment], latest =>
    (latest.get(fragment.uri)?.diagnostics || []).some(item => item.source === 'dawnlight-symbol'));

  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragment.uri, version: 2 },
    contentChanges: [{ text: '{\n  "options": [\n' }]
  });
  const malformed = await waitForDiagnostics(notifications, [fragment], latest =>
    (latest.get(fragment.uri)?.diagnostics || []).some(item => item.source === 'dawnlight-json'));
  const malformedSources = new Set((malformed.get(fragment.uri)?.diagnostics || []).map(item => item.source));
  assert.ok(malformedSources.has('dawnlight-json'));

  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragment.uri, version: 3 },
    contentChanges: [{ text: fragment.text }]
  });
  const restored = await waitForDiagnostics(notifications, [fragment], latest => {
    const current = latest.get(fragment.uri)?.diagnostics || [];
    return current.some(item => item.source === 'dawnlight-symbol') &&
      !current.some(item => item.source === 'dawnlight-json');
  });
  assert.ok((restored.get(fragment.uri)?.diagnostics || []).some(item => item.code === 'DLSYMBOL0002'));
  assert.ok(notifications.length > 0);
  await harness.shutdown();
});
