const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  CONTRACT_VERSIONS,
  computeCatalogSnapshotHash
} = require('../../packages/contracts/dist');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const root = path.resolve(__dirname, '..', '..');
const serverPath = path.join(root, 'dist', 'server.js');
const bundledCatalogPath = path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json');

function createWorkspace(t, prefix = 'dawnlight-catalog-diagnostics-') {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function createExternalCatalog(t, mutate) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-catalog-diagnostics-snapshot-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const catalog = JSON.parse(fs.readFileSync(bundledCatalogPath, 'utf8'));
  mutate(catalog);
  catalog.hash = computeCatalogSnapshotHash(catalog);
  const catalogPath = path.join(directory, 'catalog.json');
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalogPath;
}

function open(harness, file, languageId = 'jsonc') {
  harness.sendNotification('textDocument/didOpen', {
    textDocument: { uri: file.uri, languageId, version: 1, text: file.text }
  });
}

async function waitForDiagnostics(notifications, files, predicate) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const latest = new Map();
    for (const file of files) {
      const matching = [...notifications].reverse().find(item => item.uri === file.uri);
      if (matching) latest.set(file.uri, matching.diagnostics || []);
    }
    if (predicate(latest)) return latest;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return new Map(files.map(file => [
    file.uri,
    ([...notifications].reverse().find(item => item.uri === file.uri)?.diagnostics || [])
  ]));
}

function catalogDiagnostics(latest, file) {
  return (latest.get(file.uri) || []).filter(item => item.source === 'dawnlight-catalog');
}

test('Catalog diagnostics validate every ID/version context and required Services', async t => {
  const { workspace, write } = createWorkspace(t);
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:catalog-diagnostics',
    name: 'Catalog Diagnostics',
    version: '0.1.0',
    fragments: ['manifest/catalog.json']
  });
  const fragment = write('manifest/catalog.json', {
    resources: [{
      id: 'example:target', kind: 'texture2D', lifetime: 'persistent',
      size: { mode: 'viewport' }, format: 'vendor:unknown-format',
      content: { type: 'service', service: 'vendor:unknown-content-service', version: 1 }
    }],
    programs: [{
      id: 'example:program', kind: 'graphics', vertex: 'main.vsh', fragment: 'main.psh',
      defines: { LIMIT: { capability: 'vendor:unknown-capability' } }
    }],
    passes: [{
      id: 'example:unknown',
      stage: { template: 'dawnlight:fullscreen', version: 99, target: 'world', phase: 'post' },
      services: [{ id: 'vendor:unknown-pass-service', version: 1, mode: 'required' }],
      programs: ['example:program'],
      commands: [{
        type: 'engineDraw',
        provider: { id: 'vendor:unknown-provider', version: 1 },
        semantics: [{ symbol: 'view', semantic: 'vendor:unknown-semantic', version: 1 }]
      }]
    }, {
      id: 'example:requirements',
      stage: { template: 'dawnlight:command_list', version: 1, target: 'world', phase: 'post' },
      programs: [],
      commands: [{
        type: 'engineDraw',
        provider: { id: 'dawnlight:model_shadow/opaque_instanced', version: 1 },
        semantics: [{
          symbol: 'cluster', semantic: 'dawnlight:point_lights/cluster_x', version: 1
        }]
      }]
    }]
  });

  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [CONTRACT_VERSIONS.catalogSnapshot]
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile, 'json');
  open(harness, fragment);

  const latest = await waitForDiagnostics(notifications, [fragment], value => {
    const codes = catalogDiagnostics(value, fragment).map(item => item.code);
    return codes.includes('DLCAT0001') && codes.includes('DLCAT0002') && codes.includes('DLCAT0006');
  });
  const diagnostics = catalogDiagnostics(latest, fragment);
  assert.equal(diagnostics.filter(item => item.code === 'DLCAT0001').length, 6);
  assert.equal(diagnostics.filter(item => item.code === 'DLCAT0002').length, 1);
  assert.equal(diagnostics.filter(item => item.code === 'DLCAT0006').length, 2);
  assert.match(diagnostics.find(item => item.code === 'DLCAT0002').message, /Available versions: 1/);
  assert.deepEqual(
    new Set(diagnostics.filter(item => item.code === 'DLCAT0001').map(item =>
      item.message.match(/Catalog (.+?) '/)?.[1])),
    new Set(['Resource Format', 'Service', 'Capability', 'EngineDraw Provider', 'Semantic'])
  );
  assert.ok(diagnostics.every(item => item.range.end.character > item.range.start.character));

  const correctedValue = JSON.parse(fragment.text);
  correctedValue.resources[0].format = 'rgba8';
  correctedValue.resources[0].content.service = 'dawnlight:cubemap';
  correctedValue.programs[0].defines.LIMIT.capability = 'dawnlight:model_shadow/max_joints';
  correctedValue.passes[0].stage.version = 1;
  correctedValue.passes[0].services[0].id = 'dawnlight:point_lights';
  correctedValue.passes[0].commands[0].provider.id = 'dawnlight:terrain/opaque';
  correctedValue.passes[0].commands[0].semantics[0].semantic = 'dawnlight:camera/view_matrix';
  correctedValue.passes[1].services = [
    { id: 'dawnlight:model_shadows', version: 1, mode: 'required' },
    { id: 'dawnlight:point_lights', version: 1, mode: 'required' }
  ];
  const corrected = `${JSON.stringify(correctedValue, null, 2)}\n`;
  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragment.uri, version: 2 },
    contentChanges: [{ text: corrected }]
  });
  const cleared = await waitForDiagnostics(notifications, [fragment], value =>
    catalogDiagnostics(value, fragment).length === 0);
  assert.equal(catalogDiagnostics(cleared, fragment).length, 0);

  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragment.uri, version: 3 },
    contentChanges: [{ text: '{\n  "resources": [{ "format": "vendor:unknown" }' }]
  });
  const malformed = await waitForDiagnostics(notifications, [fragment], value =>
    (value.get(fragment.uri) || []).some(item => item.source === 'dawnlight-json'));
  assert.equal(catalogDiagnostics(malformed, fragment).length, 0);
});

test('external Catalog reports deprecated entries and unsupported document formats', async t => {
  const catalogPath = createExternalCatalog(t, catalog => {
    catalog.supportedFormats = { manifest: [7], sourceComposition: [8], settingsUi: [9] };
    catalog.stageTemplates.push({
      id: 'vendor:deprecated-stage',
      version: 1,
      deprecated: true,
      description: 'Deprecated test stage.'
    });
    catalog.stageTemplates.push({
      id: 'dawnlight:fullscreen',
      version: 2,
      description: 'Second test version.'
    });
  });
  const { workspace, write } = createWorkspace(t, 'dawnlight-catalog-external-diagnostics-');
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:external-catalog',
    name: 'External Catalog',
    version: '0.1.0',
    settings: 'ui/settings.json',
    fragments: ['fragment.json']
  });
  const fragment = write('fragment.json', {
    passes: [{
      id: 'example:deprecated',
      stage: { template: 'vendor:deprecated-stage', version: 1, target: 'world', phase: 'post' },
      programs: [], commands: []
    }, {
      id: 'example:version',
      stage: { template: 'dawnlight:fullscreen', version: 7, target: 'world', phase: 'post' },
      programs: [], commands: []
    }]
  });
  const settings = write('ui/settings.json', { schemaVersion: 1, pages: [] });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [1],
    catalogPath
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile, 'json');
  open(harness, fragment);
  open(harness, settings, 'json');
  const latest = await waitForDiagnostics(notifications, [rootFile, fragment, settings], value =>
    catalogDiagnostics(value, rootFile).filter(item => item.code === 'DLCAT0005').length === 2 &&
    catalogDiagnostics(value, settings).some(item => item.code === 'DLCAT0005') &&
    catalogDiagnostics(value, fragment).some(item => item.code === 'DLCAT0003'));

  assert.equal(catalogDiagnostics(latest, rootFile).filter(item => item.code === 'DLCAT0005').length, 2);
  assert.equal(catalogDiagnostics(latest, settings).filter(item => item.code === 'DLCAT0005').length, 1);
  const deprecated = catalogDiagnostics(latest, fragment).find(item => item.code === 'DLCAT0003');
  assert.equal(deprecated.severity, 2);
  const unsupported = catalogDiagnostics(latest, fragment).find(item => item.code === 'DLCAT0002');
  assert.match(unsupported.message, /Available versions: 1, 2/);
});

test('incompatible Catalog negotiation emits one root warning and suppresses entry cascades', async t => {
  const { workspace, write } = createWorkspace(t, 'dawnlight-catalog-incompatible-');
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:incompatible-catalog',
    name: 'Incompatible Catalog',
    version: '0.1.0',
    fragments: ['fragment.json']
  });
  const fragment = write('fragment.json', {
    resources: [{
      id: 'example:target', kind: 'texture2D', lifetime: 'persistent',
      size: { mode: 'viewport' }, format: 'vendor:unknown'
    }],
    passes: [{
      id: 'example:pass',
      stage: { template: 'vendor:unknown', version: 99, target: 'world', phase: 'post' },
      programs: [], commands: []
    }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [99]
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile, 'json');
  open(harness, fragment);
  const latest = await waitForDiagnostics(notifications, [rootFile, fragment], value =>
    catalogDiagnostics(value, rootFile).some(item => item.code === 'DLCAT0004'));
  const rootCatalog = catalogDiagnostics(latest, rootFile);
  assert.equal(rootCatalog.length, 1);
  assert.equal(rootCatalog[0].code, 'DLCAT0004');
  assert.equal(rootCatalog[0].severity, 2);
  assert.equal(catalogDiagnostics(latest, fragment).length, 0);
});

test('Catalog diagnostics remain isolated between independent packs', async t => {
  const { workspace, write } = createWorkspace(t, 'dawnlight-catalog-pack-isolation-');
  const rootA = write('pack-a/shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:pack-a', name: 'Pack A', version: '1.0.0',
    fragments: ['fragment.json']
  });
  const fragmentA = write('pack-a/fragment.json', {
    passes: [{
      id: 'example:invalid',
      stage: { template: 'vendor:pack-a-only', version: 1, target: 'world', phase: 'post' },
      programs: [], commands: []
    }]
  });
  const rootB = write('pack-b/shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:pack-b', name: 'Pack B', version: '1.0.0',
    fragments: ['fragment.json']
  });
  const fragmentB = write('pack-b/fragment.json', {
    passes: [{
      id: 'example:valid',
      stage: { template: 'dawnlight:fullscreen', version: 1, target: 'world', phase: 'post' },
      programs: [], commands: []
    }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [1]
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  for (const file of [rootA, fragmentA, rootB, fragmentB]) open(harness, file);
  const latest = await waitForDiagnostics(notifications, [fragmentA, fragmentB], value =>
    catalogDiagnostics(value, fragmentA).some(item => item.code === 'DLCAT0001') &&
    value.has(fragmentB.uri));
  assert.equal(catalogDiagnostics(latest, fragmentA).filter(item => item.code === 'DLCAT0001').length, 1);
  assert.equal(catalogDiagnostics(latest, fragmentB).length, 0);
});
