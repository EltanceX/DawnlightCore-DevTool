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

function createWorkspace(t, prefix = 'dawnlight-navigation-') {
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

function positionAt(source, offset) {
  const lines = source.slice(0, offset).split('\n');
  return { line: lines.length - 1, character: lines[lines.length - 1].length };
}

function stringPosition(source, value, occurrence = 0) {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(`"${value}"`, offset + 1);
  assert.notEqual(offset, -1, `Expected ${value} in fixture.`);
  return positionAt(source, offset + 1);
}

function stringRange(source, value, occurrence = 0) {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(`"${value}"`, offset + 1);
  return {
    start: positionAt(source, offset),
    end: positionAt(source, offset + value.length + 2)
  };
}

function open(harness, file, version = 1, text = file.text) {
  harness.sendNotification('textDocument/didOpen', {
    textDocument: { uri: file.uri, languageId: 'jsonc', version, text }
  });
}

async function waitForIndex(harness, predicate = () => true) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = await harness.sendRequest(LSP_METHODS.symbolSnapshot);
    if (snapshot.generation > 0 && predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  return harness.sendRequest(LSP_METHODS.symbolSnapshot);
}

function createNavigationPack(t) {
  const fixture = createWorkspace(t);
  const rootFile = fixture.write('pack-a/shaderpack.json', {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:navigation',
    name: 'Navigation',
    version: '0.1.0',
    shaderRoot: 'shaders',
    settings: 'ui/settings.json',
    fragments: ['manifest/definitions.json', 'manifest/usage.json']
  });
  const definitions = fixture.write('pack-a/manifest/definitions.json', {
    options: [{
      id: 'example:quality', type: 'string', default: 'high', allowed: ['low', 'high'], impact: ['program']
    }],
    resources: [{
      id: 'example:color', kind: 'texture2D', lifetime: 'persistent',
      size: { mode: 'viewport' }, format: 'rgba8'
    }],
    programs: [{
      id: 'example:main', kind: 'graphics', vertex: 'main.vsh', fragment: 'main.psh'
    }],
    passes: [{ id: 'example:prepare', programs: ['example:main'], commands: [] }]
  });
  const usage = fixture.write('pack-a/manifest/usage.json', {
    programs: [{
      id: 'example:post', kind: 'graphics', vertex: 'main.vsh', fragment: 'main.psh',
      defines: { QUALITY: { option: 'example:quality' } }
    }],
    resources: [{
      id: 'example:lut', kind: 'texture2D', lifetime: 'persistent',
      size: { mode: 'fixed', width: 16, height: 16 }, format: 'rgba8',
      content: { type: 'asset', path: 'assets/lut.png' }
    }],
    passes: [{
      id: 'example:output',
      stage: {
        template: 'dawnlight:stage', version: 1, target: 'afterDraw', phase: 'output',
        ordering: { after: ['example:prepare'] }
      },
      enabledWhen: [{ option: 'example:quality', equals: 'high' }],
      programs: ['example:main'],
      commands: [{ type: 'fullscreen', program: 'example:main' }],
      inputs: ['example:color'],
      outputs: ['example:color']
    }]
  });
  const settings = fixture.write('pack-a/ui/settings.json', {
    schemaVersion: 1,
    pages: [{ id: 'display', title: 'Display', groups: [{
      id: 'quality', title: 'Quality', controls: [{
        id: 'quality', option: 'example:quality', widget: 'choice', label: 'Quality'
      }]
    }]}]
  });
  const vertex = fixture.write('pack-a/shaders/main.vsh', 'void main() {}\n');
  fixture.write('pack-a/shaders/main.psh', 'void main() {}\n');
  const asset = fixture.write('pack-a/assets/lut.png', 'fixture');
  fixture.write('pack-b/shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'other:pack', name: 'Other', version: '0.1.0',
    fragments: ['definitions.json']
  });
  const other = fixture.write('pack-b/definitions.json', {
    options: [{ id: 'example:quality', type: 'boolean', default: true, impact: ['uniform'] }]
  });
  return { ...fixture, rootFile, definitions, usage, settings, vertex, asset, other };
}

test('Definition, References, Hover, and Rename use the pack-local index', async t => {
  const fixture = createNavigationPack(t);
  const { harness, result } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [fixture.workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  assert.equal(result.capabilities.definitionProvider, true);
  assert.equal(result.capabilities.referencesProvider, true);
  assert.deepEqual(result.capabilities.renameProvider, { prepareProvider: true });
  open(harness, fixture.rootFile);
  open(harness, fixture.definitions);
  open(harness, fixture.usage);
  open(harness, fixture.settings);
  await waitForIndex(harness, snapshot => snapshot.projects.length === 2 &&
    snapshot.projects.some(project => project.documents.some(document =>
      document.uri === fixture.usage.uri && document.version === 1)));

  const optionPosition = stringPosition(fixture.usage.text, 'example:quality');
  const definition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.usage.uri }, position: optionPosition
  });
  assert.equal(definition.length, 1);
  assert.equal(definition[0].uri, fixture.definitions.uri);
  assert.deepEqual(definition[0].range, stringRange(fixture.definitions.text, 'example:quality'));

  const fragmentDefinition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.rootFile.uri },
    position: stringPosition(fixture.rootFile.text, 'manifest/usage.json')
  });
  assert.deepEqual(fragmentDefinition, [{
    uri: fixture.usage.uri,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
  }]);

  const shaderDefinition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.usage.uri }, position: stringPosition(fixture.usage.text, 'main.vsh')
  });
  assert.equal(shaderDefinition[0].uri, fixture.vertex.uri);
  const assetDefinition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.usage.uri }, position: stringPosition(fixture.usage.text, 'assets/lut.png')
  });
  assert.equal(assetDefinition[0].uri, fixture.asset.uri);

  const references = await harness.sendRequest('textDocument/references', {
    textDocument: { uri: fixture.definitions.uri },
    position: stringPosition(fixture.definitions.text, 'example:quality'),
    context: { includeDeclaration: false }
  });
  assert.equal(references.length, 3);
  assert.deepEqual(new Set(references.map(location => location.uri)),
    new Set([fixture.usage.uri, fixture.settings.uri]));
  const referencesWithDeclaration = await harness.sendRequest('textDocument/references', {
    textDocument: { uri: fixture.definitions.uri },
    position: stringPosition(fixture.definitions.text, 'example:quality'),
    context: { includeDeclaration: true }
  });
  assert.equal(referencesWithDeclaration.length, 4);

  const passDefinition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.usage.uri }, position: stringPosition(fixture.usage.text, 'example:prepare')
  });
  assert.equal(passDefinition[0].uri, fixture.definitions.uri);
  for (const id of ['example:main', 'example:color']) {
    const target = await harness.sendRequest('textDocument/definition', {
      textDocument: { uri: fixture.usage.uri }, position: stringPosition(fixture.usage.text, id)
    });
    assert.equal(target[0].uri, fixture.definitions.uri, `Expected a definition for ${id}.`);
  }
  const settingsDefinition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.rootFile.uri },
    position: stringPosition(fixture.rootFile.text, 'ui/settings.json')
  });
  assert.equal(settingsDefinition[0].uri, fixture.settings.uri);

  const hover = await harness.sendRequest('textDocument/hover', {
    textDocument: { uri: fixture.usage.uri }, position: optionPosition
  });
  assert.match(hover.contents.value, /\*\*Option\*\* `example:quality`/);
  assert.match(hover.contents.value, /Type: `string`/);
  assert.match(hover.contents.value, /Default: `high`/);
  assert.match(hover.contents.value, /Defined in `manifest\/definitions\.json`/);
  const pathHover = await harness.sendRequest('textDocument/hover', {
    textDocument: { uri: fixture.usage.uri }, position: stringPosition(fixture.usage.text, 'main.vsh')
  });
  assert.match(pathHover.contents.value, /\*\*Shader file\*\* `shaders\/main\.vsh`/);
  assert.match(pathHover.contents.value, /does not move the file/);

  const prepare = await harness.sendRequest('textDocument/prepareRename', {
    textDocument: { uri: fixture.usage.uri }, position: optionPosition
  });
  assert.equal(prepare.placeholder, 'example:quality');
  assert.deepEqual(prepare.range, stringRange(fixture.usage.text, 'example:quality'));

  const rename = await harness.sendRequest('textDocument/rename', {
    textDocument: { uri: fixture.usage.uri }, position: optionPosition, newName: 'example:quality_level'
  });
  assert.deepEqual(new Set(Object.keys(rename.changes)),
    new Set([fixture.definitions.uri, fixture.usage.uri, fixture.settings.uri]));
  assert.equal(Object.hasOwn(rename.changes, fixture.other.uri), false);
  assert.equal(Object.values(rename.changes).flat().length, 4);
  assert.ok(Object.values(rename.changes).flat().every(edit => edit.newText === '"example:quality_level"'));

  const pathRename = await harness.sendRequest('textDocument/rename', {
    textDocument: { uri: fixture.usage.uri },
    position: stringPosition(fixture.usage.text, 'main.vsh'),
    newName: 'renamed/main.vsh'
  });
  assert.deepEqual(new Set(Object.keys(pathRename.changes)),
    new Set([fixture.definitions.uri, fixture.usage.uri]));
  assert.equal(Object.values(pathRename.changes).flat().length, 2);
  assert.ok(Object.values(pathRename.changes).flat().every(edit =>
    edit.newText === '"renamed/main.vsh"'));
  assert.equal(pathRename.documentChanges, undefined);

  await assert.rejects(harness.sendRequest('textDocument/prepareRename', {
    textDocument: { uri: fixture.settings.uri },
    position: stringPosition(fixture.settings.text, 'display')
  }), /supported for option, resource, program, pass/i);

  const overlayDefinitions = fixture.definitions.text.replace('example:quality', 'example:overlay');
  const overlayUsage = fixture.usage.text.replaceAll('example:quality', 'example:overlay');
  const overlaySettings = fixture.settings.text.replace('example:quality', 'example:overlay');
  for (const [file, text] of [
    [fixture.definitions, overlayDefinitions],
    [fixture.usage, overlayUsage],
    [fixture.settings, overlaySettings]
  ]) {
    harness.sendNotification('textDocument/didChange', {
      textDocument: { uri: file.uri, version: 2 }, contentChanges: [{ text }]
    });
  }
  await waitForIndex(harness, snapshot => {
    const project = snapshot.projects.find(item => item.rootUri.endsWith(`${path.sep}pack-a`));
    return project?.symbols.some(symbol => symbol.id === 'example:overlay') &&
      [fixture.definitions.uri, fixture.usage.uri, fixture.settings.uri].every(uri =>
        project.documents.some(document => document.uri === uri && document.version === 2));
  });
  const overlayDefinition = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fixture.usage.uri },
    position: stringPosition(overlayUsage, 'example:overlay')
  });
  assert.equal(overlayDefinition[0].uri, fixture.definitions.uri);
  assert.deepEqual(overlayDefinition[0].range, stringRange(overlayDefinitions, 'example:overlay'));

  await harness.shutdown();
});

test('Rename rejects duplicate IDs, syntax errors, unresolved references, and collisions', async t => {
  const { workspace, write } = createWorkspace(t, 'dawnlight-rename-safety-');
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:safety', name: 'Safety', version: '0.1.0',
    fragments: ['definitions.json', 'usage.json']
  });
  const definitions = write('definitions.json', {
    options: [
      { id: 'example:first', type: 'boolean', default: true, impact: ['uniform'] },
      { id: 'example:second', type: 'boolean', default: false, impact: ['uniform'] }
    ]
  });
  const usage = write('usage.json', {
    passes: [{
      id: 'example:pass', programs: [], commands: [],
      enabledWhen: [{ option: 'example:missing', equals: true }]
    }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  open(harness, rootFile);
  open(harness, definitions);
  open(harness, usage);
  await waitForIndex(harness, snapshot => snapshot.projects[0]?.documents.every(item => item.version === 1));

  await assert.rejects(harness.sendRequest('textDocument/prepareRename', {
    textDocument: { uri: usage.uri }, position: stringPosition(usage.text, 'example:missing')
  }), /unresolved or ambiguous reference/i);

  await assert.rejects(harness.sendRequest('textDocument/rename', {
    textDocument: { uri: definitions.uri },
    position: stringPosition(definitions.text, 'example:first'),
    newName: 'example:second'
  }), /already defined/i);

  const malformed = definitions.text.slice(0, definitions.text.lastIndexOf('}'));
  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: definitions.uri, version: 2 }, contentChanges: [{ text: malformed }]
  });
  await waitForIndex(harness, snapshot => snapshot.projects[0]?.documents.some(item =>
    item.uri === definitions.uri && item.version === 2 && item.parseErrorCount > 0));
  await assert.rejects(harness.sendRequest('textDocument/prepareRename', {
    textDocument: { uri: definitions.uri }, position: stringPosition(malformed, 'example:first')
  }), /syntax errors/i);

  await harness.shutdown();
});

test('Rename rejects every target while a pack contains duplicate canonical IDs', async t => {
  const { workspace, write } = createWorkspace(t, 'dawnlight-rename-duplicate-');
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:duplicate', name: 'Duplicate', version: '0.1.0',
    fragments: ['definitions.json']
  });
  const definitions = write('definitions.json', {
    options: [{ id: 'example:same' }], resources: [{ id: 'example:same' }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  open(harness, rootFile);
  open(harness, definitions);
  await waitForIndex(harness, snapshot => snapshot.projects[0]?.duplicates.length > 0);
  await assert.rejects(harness.sendRequest('textDocument/prepareRename', {
    textDocument: { uri: definitions.uri }, position: stringPosition(definitions.text, 'example:same')
  }), /duplicate symbol IDs/i);
  await harness.shutdown();
});
