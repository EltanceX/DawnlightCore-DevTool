const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { CONTRACT_VERSIONS } = require('../../packages/contracts/dist');
const { LSP_METHODS } = require('../../packages/contracts/dist');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const root = path.resolve(__dirname, '..', '..');
const serverPath = path.join(root, 'dist', 'server.js');

function createWorkspace(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-completion-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const write = (relativePath, value) => {
    const target = path.join(workspace, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    return target;
  };
  return { workspace, write };
}

function positionAt(source, offset) {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function labels(result) {
  return new Set((result?.items || []).map(item => typeof item.label === 'string' ? item.label : item.label.label));
}

async function waitForSymbols(harness) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const snapshot = await harness.sendRequest(LSP_METHODS.symbolSnapshot);
    if (snapshot.generation > 0 && snapshot.projects.length > 0) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  return harness.sendRequest(LSP_METHODS.symbolSnapshot);
}

function open(harness, uri, text) {
  harness.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'jsonc', version: 1, text }
  });
}

test('dynamic completion merges pack-local IDs and filters program kind', async t => {
  const { workspace, write } = createWorkspace(t);
  write('shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:dynamic',
    name: 'Dynamic',
    version: '0.1.0',
    shaderRoot: 'shaders',
    settings: 'manifest/ui/settings.json',
    fragments: ['manifest/defs.json']
  });
  write('manifest/defs.json', { options: [], resources: [], programs: [], passes: [] });
  write('manifest/ui/settings.json', {
    schemaVersion: 1,
    translations: { 'en-US': { 'page.main': 'Main', 'option.quality': 'Quality' } },
    pages: []
  });
  write('shaders/main.csh', 'void main() {}\n');
  write('shaders/main.vsh', 'void main() {}\n');

  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  await waitForSymbols(harness);

  const fragmentPath = path.join(workspace, 'manifest', 'defs.json');
  const fragmentUri = pathToFileURL(fragmentPath).toString();
  const fragment = `{
  "options": [{"id": "example:quality", "type": "string", "default": "high", "allowed": ["low", "high"], "impact": ["program"]}],
  "resources": [{"id": "example:color", "kind": "texture2D", "lifetime": "persistent", "size": {"mode": "viewport"}, "format": "rgba8"}],
  "programs": [
    {"id": "example:graphics", "kind": "graphics", "vertex": ""},
    {"id": "example:compute", "kind": "compute", "compute": ""}
  ],
  "passes": [{
    "id": "example:pass",
    "enabledWhen": [{"option": ""}],
    "programs": [""],
    "commands": [{"type": "compute", "program": ""}],
    "inputs": [""],
    "outputs": ["example:color"]
  }]
}\n`;
  open(harness, fragmentUri, fragment);

  const optionOffset = fragment.indexOf('"option": ""') + '"option": "'.length;
  const optionCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri }, position: positionAt(fragment, optionOffset)
  });
  assert.ok(labels(optionCompletion).has('example:quality'));
  const optionItem = optionCompletion.items.find(item => item.label === 'example:quality');
  assert.match(optionItem.detail, /string/);
  assert.equal(optionItem.insertText, '"example:quality"');
  assert.equal(optionItem.textEdit.newText, '"example:quality"');
  assert.ok(optionItem.textEdit.range.start.character < optionItem.textEdit.range.end.character);

  const computeProgramOffset = fragment.indexOf('"program": ""') + '"program": "'.length;
  const computeProgramCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri }, position: positionAt(fragment, computeProgramOffset)
  });
  assert.ok(labels(computeProgramCompletion).has('example:compute'));
  assert.equal(labels(computeProgramCompletion).has('example:graphics'), false);

  const shaderOffset = fragment.indexOf('"compute": ""') + '"compute": "'.length;
  const shaderCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri }, position: positionAt(fragment, shaderOffset)
  });
  assert.ok(labels(shaderCompletion).has('main.csh'));
  assert.equal(labels(shaderCompletion).has('main.vsh'), false);

  const rootPath = path.join(workspace, 'shaderpack.json');
  const rootUri = pathToFileURL(rootPath).toString();
  const rootText = fs.readFileSync(rootPath, 'utf8').replace('"manifest/defs.json"', '""');
  open(harness, rootUri, rootText);
  await waitForSymbols(harness);
  const rootOffset = rootText.indexOf('""') + 1;
  const rootCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: rootUri }, position: positionAt(rootText, rootOffset)
  });
  assert.ok(labels(rootCompletion).has('manifest/defs.json'));
  assert.ok(rootCompletion.items.some(item => item.detail === 'fragment JSON file'));
});

test('settings completion uses option metadata and translation keys', async t => {
  const { workspace, write } = createWorkspace(t, 'dawnlight-settings-completion-');
  write('shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:settings', name: 'Settings', version: '0.1.0',
    settings: 'manifest/ui/settings.json', fragments: ['manifest/defs.json']
  });
  write('manifest/defs.json', {
    options: [{ id: 'example:enabled', type: 'boolean', default: true, impact: ['program'] }]
  });
  write('manifest/ui/settings.json', { schemaVersion: 1, pages: [] });

  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  await waitForSymbols(harness);
  const settingsPath = path.join(workspace, 'manifest', 'ui', 'settings.json');
  const settingsUri = pathToFileURL(settingsPath).toString();
  const settings = `{
  "schemaVersion": 1,
  "translations": {"en-US": {"page.main": "Main"}},
  "pages": [{"id": "main", "title": "", "groups": [{"id": "general", "title": "Main", "controls": [{"id": "enabled", "option": "", "widget": "", "label": ""}]}]}]
}\n`;
  open(harness, settingsUri, settings);

  const optionOffset = settings.indexOf('"option": ""') + '"option": "'.length;
  const optionCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: settingsUri }, position: positionAt(settings, optionOffset)
  });
  assert.ok(labels(optionCompletion).has('example:enabled'));

  const selectedSettings = settings.replace('"option": ""', '"option": "example:enabled"');
  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: settingsUri, version: 2 },
    contentChanges: [{ text: selectedSettings }]
  });

  const widgetOffset = selectedSettings.indexOf('"widget": ""') + '"widget": "'.length;
  const widgetCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: settingsUri }, position: positionAt(selectedSettings, widgetOffset)
  });
  assert.ok(labels(widgetCompletion).has('toggle'));
  assert.ok(widgetCompletion.items.find(item => item.label === 'toggle').detail.includes('example:enabled'));

  const titleOffset = settings.indexOf('"title": ""') + '"title": "'.length;
  const titleCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: settingsUri }, position: positionAt(settings, titleOffset)
  });
  assert.ok(labels(titleCompletion).has('page.main'));
});

test('Catalog completion is context-aware and links ID fields to exact versions', async t => {
  const { workspace, write } = createWorkspace(t);
  write('shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:catalog-completion',
    name: 'Catalog Completion',
    version: '0.1.0',
    fragments: ['manifest/catalog.json']
  });
  write('manifest/catalog.json', { options: [], resources: [], programs: [], passes: [] });

  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [CONTRACT_VERSIONS.catalogSnapshot]
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  await waitForSymbols(harness);

  const fragmentPath = path.join(workspace, 'manifest', 'catalog.json');
  const fragmentUri = pathToFileURL(fragmentPath).toString();
  const fragment = `{
  "options": [],
  "resources": [{
    "id": "example:target", "kind": "texture2D", "lifetime": "persistent",
    "size": {"mode": "viewport"}, "format": "rgba8",
    "content": {"type": "service", "service": "dawnlight:cubemap", "version": 0}
  }],
  "programs": [{
    "id": "example:program", "kind": "graphics", "vertex": "main.vsh", "fragment": "main.psh",
    "defines": {"MAX_JOINTS": {"capability": "dawnlight:model_shadow/max_joints"}}
  }],
  "passes": [{
    "id": "example:pass",
    "stage": {"template": "dawnlight:fullscreen", "version": 0, "target": "world", "phase": "post"},
    "services": [{"id": "dawnlight:cubemap", "version": 0, "mode": "required"}],
    "programs": ["example:program"],
    "commands": [{
      "type": "engineDraw",
      "provider": {"id": "dawnlight:terrain/opaque", "version": 0},
      "semantics": [{"symbol": "view", "semantic": "dawnlight:camera/view_matrix", "version": 0}]
    }]
  }]
}\n`;
  open(harness, fragmentUri, fragment);

  const completeAt = async (needle, adjustment = 0) => harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: positionAt(fragment, fragment.indexOf(needle) + adjustment)
  });

  const format = await completeAt('"rgba8"', 2);
  assert.ok(labels(format).has('rgba16f'));
  assert.match(format.items.find(item => item.label === 'rgba16f').detail, /resource format.*bundled/);

  const capability = await completeAt('"dawnlight:model_shadow/max_joints"', 2);
  assert.ok(labels(capability).has('dawnlight:model_shadow/max_instances'));

  const template = await completeAt('"dawnlight:fullscreen"', 2);
  assert.ok(labels(template).has('dawnlight:command_list'));
  const templateVersionOffset = fragment.indexOf('"version": 0', fragment.indexOf('"stage"'));
  const templateVersion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: positionAt(fragment, templateVersionOffset + '"version": '.length)
  });
  assert.ok(labels(templateVersion).has('1'));
  assert.match(templateVersion.items.find(item => item.label === '1').detail, /stage template/);

  const serviceIdNeedle = '"id": "dawnlight:cubemap"';
  const service = await completeAt(serviceIdNeedle, serviceIdNeedle.indexOf('dawnlight'));
  assert.ok(labels(service).has('dawnlight:point_lights'));
  const serviceVersionOffset = fragment.indexOf('"version": 0', fragment.indexOf(serviceIdNeedle));
  const serviceVersion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: positionAt(fragment, serviceVersionOffset + '"version": '.length)
  });
  assert.ok(labels(serviceVersion).has('1'));
  assert.match(serviceVersion.items.find(item => item.label === '1').detail, /Catalog service/);

  const providerNeedle = '"id": "dawnlight:terrain/opaque"';
  const provider = await completeAt(providerNeedle, providerNeedle.indexOf('dawnlight'));
  assert.ok(labels(provider).has('dawnlight:terrain/transparent'));
  const providerVersionOffset = fragment.indexOf('"version": 0', fragment.indexOf(providerNeedle));
  const providerVersion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: positionAt(fragment, providerVersionOffset + '"version": '.length)
  });
  assert.ok(labels(providerVersion).has('1'));
  assert.match(providerVersion.items.find(item => item.label === '1').detail, /EngineDraw provider/);

  const semanticNeedle = '"semantic": "dawnlight:camera/view_matrix"';
  const semantic = await completeAt(semanticNeedle, semanticNeedle.indexOf('dawnlight'));
  assert.ok(labels(semantic).has('dawnlight:camera/projection_matrix'));
  assert.match(semantic.items.find(item => item.label === 'dawnlight:camera/view_matrix').detail, /matrix4/);
  const semanticVersionOffset = fragment.indexOf('"version": 0', fragment.indexOf(semanticNeedle));
  const semanticVersion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: positionAt(fragment, semanticVersionOffset + '"version": '.length)
  });
  assert.ok(labels(semanticVersion).has('1'));
  assert.match(semanticVersion.items.find(item => item.label === '1').detail, /Catalog semantic/);

  const contentServiceNeedle = '"service": "dawnlight:cubemap"';
  const contentService = await completeAt(contentServiceNeedle, contentServiceNeedle.indexOf('dawnlight'));
  assert.ok(labels(contentService).has('dawnlight:scene_target'));
  const contentVersionOffset = fragment.indexOf('"version": 0', fragment.indexOf(contentServiceNeedle));
  const contentVersion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: positionAt(fragment, contentVersionOffset + '"version": '.length)
  });
  assert.ok(labels(contentVersion).has('1'));
});
