const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { WorkspaceCompositionManager } = require('../../packages/language-server/dist/composition');
const { JsoncDocumentStore } = require('../../packages/language-server/dist/jsoncDocuments');
const { WorkspacePackDiscovery } = require('../../packages/language-server/dist/workspaceDiscovery');

function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-composition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relativePath, value) => {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string'
      ? value
      : `${JSON.stringify(value, null, 2)}\n`);
    return target;
  };
  return { root, write };
}

function rootManifest(fragments) {
  return {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id: 'example:composition',
    name: 'Composition Test',
    version: '0.1.0',
    fragments
  };
}

test('JSONC store accepts comments and trailing commas and exposes precise AST ranges', t => {
  const { root, write } = createWorkspace(t);
  const filePath = write('fragment.json', '{"options": []}\n');
  const uri = pathToFileURL(filePath).toString();
  const store = new JsoncDocumentStore();
  const source = '{\n  // an unsaved option\n  "options": [{"id": "example:one",}],\n}\n';
  const snapshot = store.open(uri, source, 7);
  assert.equal(snapshot.source, 'overlay');
  assert.equal(snapshot.version, 7);
  assert.equal(snapshot.errors.length, 0);
  assert.deepEqual(snapshot.nodePathAtOffset(source.indexOf('example:one')), ['options', 0, 'id']);
  const idNode = snapshot.nodeAtPath(['options', 0, 'id']);
  assert.ok(idNode);
  assert.deepEqual(snapshot.rangeForNode(idNode).start, { line: 2, character: 21 });
  assert.deepEqual(snapshot.rangeForNode(idNode).end, { line: 2, character: 34 });

  const disk = store.close(uri);
  assert.equal(disk.source, 'disk');
  assert.equal(disk.version, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(disk.value)), { options: [] });
});

test('composition preserves declared fragment order and forwards references naturally', async t => {
  const { root, write } = createWorkspace(t);
  const manifestPath = write('shaderpack.json', rootManifest(['b.json', 'a.json']));
  write('a.json', { options: [{ id: 'example:option' }] });
  write('b.json', { resources: [{ id: 'example:resource' }] });

  const discovery = new WorkspacePackDiscovery([root]);
  const discoverySnapshot = discovery.refresh();
  const manager = new WorkspaceCompositionManager(new JsoncDocumentStore());
  const result = await manager.rebuild(discoverySnapshot);
  assert.equal(result.applied, true);
  const project = result.snapshot.projects[0];
  assert.deepEqual(project.definitions.resources.map(item => [item.id, item.fragmentOrder]), [
    ['example:resource', 0]
  ]);
  assert.deepEqual(project.definitions.options.map(item => [item.id, item.fragmentOrder]), [
    ['example:option', 1]
  ]);
  assert.equal(project.documents.length, 3);
  assert.ok(project.documents.some(document => document.uri === pathToFileURL(manifestPath).toString()));
});

test('a malformed fragment reports JSONC diagnostics without removing valid sibling definitions', async t => {
  const { root, write } = createWorkspace(t);
  write('shaderpack.json', rootManifest(['valid.json', 'broken.json']));
  write('valid.json', { options: [{ id: 'example:survives' }] });
  write('broken.json', '{\n  "resources": [{"id": "example:temporary"}],\n');

  const discovery = new WorkspacePackDiscovery([root]);
  const manager = new WorkspaceCompositionManager(new JsoncDocumentStore());
  const result = await manager.rebuild(discovery.refresh());
  const project = result.snapshot.projects[0];
  assert.deepEqual(project.definitions.options.map(item => item.id), ['example:survives']);
  assert.ok(project.diagnostics.some(diagnostic => diagnostic.code === 'DLJSON0001'));
  assert.equal(project.documents.length, 3);
});

test('an unsaved root overlay changes composition order without writing to disk', async t => {
  const { root, write } = createWorkspace(t);
  const manifestPath = write('shaderpack.json', rootManifest(['a.json']));
  write('a.json', { options: [{ id: 'example:a' }] });
  write('b.json', { options: [{ id: 'example:b' }] });
  const discovery = new WorkspacePackDiscovery([root]);
  discovery.refresh();
  const store = new JsoncDocumentStore();
  const rootUri = pathToFileURL(manifestPath).toString();
  const overlay = `${JSON.stringify(rootManifest(['b.json', 'a.json']), null, 2)}\n`;
  store.open(rootUri, overlay, 18);
  const overlaidDiscovery = discovery.setDocumentOverlay(manifestPath, overlay);
  const manager = new WorkspaceCompositionManager(store);
  const result = await manager.rebuild(overlaidDiscovery);
  assert.deepEqual(result.snapshot.projects[0].definitions.options.map(item => item.id), [
    'example:b',
    'example:a'
  ]);
  assert.equal(result.snapshot.projects[0].documents.find(document =>
    document.uri === rootUri).version, 18);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).fragments, ['a.json']);
});

test('cancelled composition cannot publish a stale generation', async t => {
  const { root, write } = createWorkspace(t);
  write('shaderpack.json', rootManifest(['a.json']));
  write('a.json', { options: [{ id: 'example:one' }] });
  const manager = new WorkspaceCompositionManager(new JsoncDocumentStore());
  const discovery = new WorkspacePackDiscovery([root]);
  const pending = manager.rebuild(discovery.refresh());
  manager.cancel();
  const cancelled = await pending;
  assert.equal(cancelled.applied, false);
  assert.equal(cancelled.snapshot.generation, 0);

  const applied = await manager.rebuild(discovery.snapshot);
  assert.equal(applied.applied, true);
  assert.equal(applied.snapshot.generation, 1);
});

test('a newer document version is the only version composed after an async yield', async t => {
  const { root, write } = createWorkspace(t);
  const fragmentPath = write('a.json', { options: [{ id: 'example:disk' }] });
  const manifestPath = write('shaderpack.json', rootManifest(['a.json']));
  const discovery = new WorkspacePackDiscovery([root]);
  const store = new JsoncDocumentStore();
  const uri = pathToFileURL(fragmentPath).toString();
  store.open(uri, '{"options":[{"id":"example:first"}]}', 1);
  const manager = new WorkspaceCompositionManager(store);
  const pending = manager.rebuild(discovery.refresh());
  store.update(uri, '{"options":[{"id":"example:second"}]}', 2);
  const result = await pending;
  assert.equal(result.snapshot.projects[0].definitions.options[0].id, 'example:second');
  assert.equal(result.snapshot.projects[0].documents.find(document =>
    document.uri === uri).version, 2);
  assert.ok(manifestPath);
});
