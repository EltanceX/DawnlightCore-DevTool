const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PackPathError,
  WorkspacePackDiscovery,
  normalizePackRelativePath
} = require('../../packages/language-server/dist/workspaceDiscovery');

function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relativePath, value) => {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target,
      typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    return target;
  };
  return { root, write };
}

function basicRoot(overrides = {}) {
  return {
    manifestVersion: 3,
    id: 'example:test',
    name: 'Test Pack',
    version: '0.1.0',
    ...overrides
  };
}

test('pack-relative paths normalize without changing portable separators', () => {
  assert.equal(normalizePackRelativePath('config/pipeline.json'), 'config/pipeline.json');
  for (const invalid of [
    '', '/root.json', 'C:/root.json', 'C:\\root.json', 'a\\b.json',
    './a.json', 'a/../b.json', 'a//b.json', 'a/', 'a/./b.json'
  ]) {
    assert.throws(() => normalizePackRelativePath(invalid), PackPathError, invalid);
  }
});

test('discovery tracks only explicit arbitrary paths and preserves fragment order', t => {
  const { root, write } = createWorkspace(t);
  write('shaderpack.json', basicRoot({
    sourceFormatVersion: 1,
    fragments: ['parts/second.json', 'config/first.json'],
    settings: 'authoring/ui.json',
    shaderRoot: 'shaders'
  }));
  const second = write('parts/second.json', { passes: [] });
  write('config/first.json', { resources: [] });
  write('authoring/ui.json', { schemaVersion: 1, pages: [] });
  write('shaders/main.glsl', 'void main() {}\n');
  const ordinary = write('notes/ordinary.json', { ordinary: true });

  const discovery = new WorkspacePackDiscovery([root]);
  const snapshot = discovery.refresh();
  assert.equal(snapshot.packs.length, 1);
  const pack = snapshot.packs[0];
  assert.deepEqual(pack.fragments.map(reference => reference.path), [
    'parts/second.json',
    'config/first.json'
  ]);
  assert.equal(pack.settings.path, 'authoring/ui.json');
  assert.equal(pack.shaderRoot.path, 'shaders');
  assert.equal(discovery.getDocumentAssociation(second).role, 'fragment');
  assert.equal(discovery.getDocumentAssociation(ordinary).role, 'untracked');
});

test('workspace scan excludes source-control, dependency, bin and obj copies', t => {
  const { root, write } = createWorkspace(t);
  write('source/shaderpack.json', basicRoot({ id: 'example:source' }));
  for (const directory of ['.git', 'node_modules', 'bin', 'obj']) {
    write(`${directory}/copy/shaderpack.json`, basicRoot({ id: `example:${directory}` }));
  }

  const discovery = new WorkspacePackDiscovery([root]);
  const snapshot = discovery.refresh();
  assert.deepEqual(snapshot.packs.map(pack => pack.id), ['example:source']);
  assert.equal(discovery.findPackForDocument(path.join(root, 'bin/copy/part.json')), undefined);
});

test('nearest nested pack wins while explicit cross-ownership is reported', t => {
  const { root, write } = createWorkspace(t);
  write('shaderpack.json', basicRoot({
    id: 'example:outer',
    sourceFormatVersion: 1,
    fragments: ['inner/shared.json']
  }));
  write('inner/shaderpack.json', basicRoot({
    id: 'example:inner',
    sourceFormatVersion: 1,
    fragments: ['shared.json']
  }));
  const shared = write('inner/shared.json', { options: [] });

  const discovery = new WorkspacePackDiscovery([root]);
  const snapshot = discovery.refresh();
  assert.equal(snapshot.packs.length, 2);
  assert.equal(discovery.findPackForDocument(shared).id, 'example:inner');
  assert.equal(discovery.getDocumentAssociation(shared).role, 'fragment');
  assert.equal(snapshot.ambiguousDocuments.length, 1);
  assert.ok(snapshot.packs.every(pack =>
    pack.diagnostics.some(diagnostic => diagnostic.code === 'DLPATH0006')));
  assert.ok(snapshot.packs.every(pack => pack.valid === false));
});

test('independent packs keep document ownership and state isolated', t => {
  const { root, write } = createWorkspace(t);
  write('pack-a/shaderpack.json', basicRoot({
    id: 'example:pack_a',
    sourceFormatVersion: 1,
    fragments: ['a.json']
  }));
  const fragmentA = write('pack-a/a.json', { options: [] });
  write('pack-b/shaderpack.json', basicRoot({
    id: 'example:pack_b',
    sourceFormatVersion: 1,
    fragments: ['b.json']
  }));
  const fragmentB = write('pack-b/b.json', { resources: [] });

  const discovery = new WorkspacePackDiscovery([root]);
  const snapshot = discovery.refresh();
  assert.equal(snapshot.packs.length, 2);
  assert.equal(snapshot.ambiguousDocuments.length, 0);
  assert.equal(discovery.getDocumentAssociation(fragmentA).pack.id, 'example:pack_a');
  assert.equal(discovery.getDocumentAssociation(fragmentB).pack.id, 'example:pack_b');
});

test('invalid, duplicate, self and missing references become stable path diagnostics', t => {
  const { root, write } = createWorkspace(t);
  write('present.json', { options: [] });
  write('shaderpack.json', basicRoot({
    sourceFormatVersion: 1,
    fragments: [
      'present.json', 'present.json', 'shaderpack.json', 'missing.json',
      '../escape.json', '/root.json', 'C:/drive.json', 'a//b.json', 'a\\b.json'
    ]
  }));

  const pack = new WorkspacePackDiscovery([root]).refresh().packs[0];
  const codes = new Set(pack.diagnostics.map(diagnostic => diagnostic.code));
  assert.equal(pack.valid, false);
  assert.equal(Object.isFrozen(pack.diagnostics[0]), true);
  assert.ok(codes.has('DLPATH0001'));
  assert.ok(codes.has('DLPATH0002'));
  assert.ok(codes.has('DLPATH0003'));
  assert.ok(codes.has('DLPATH0004'));
  assert.equal(pack.fragments.find(reference => reference.path === 'missing.json').exists, false);
});

test('temporarily malformed roots stay discoverable without partial composition', t => {
  const { root, write } = createWorkspace(t);
  write('shaderpack.json', '{\n  "fragments": [\n');
  const pack = new WorkspacePackDiscovery([root]).refresh().packs[0];
  assert.equal(pack.valid, false);
  assert.deepEqual(pack.fragments, []);
  assert.equal(pack.diagnostics[0].code, 'DLJSON0001');
});

test('refresh atomically replaces fragment order and ignores unrelated events', t => {
  const { root, write } = createWorkspace(t);
  const manifestPath = write('shaderpack.json', basicRoot({
    sourceFormatVersion: 1,
    fragments: ['a.json']
  }));
  write('a.json', { options: [] });
  write('b.json', { resources: [] });
  const discovery = new WorkspacePackDiscovery([root]);
  const first = discovery.refresh();

  write('shaderpack.json', basicRoot({
    sourceFormatVersion: 1,
    fragments: ['b.json', 'a.json']
  }));
  assert.equal(discovery.handleFileEvents([path.join(root, 'untracked.txt')]), first);
  const second = discovery.handleFileEvents([manifestPath]);
  assert.equal(second.generation, first.generation + 1);
  assert.deepEqual(first.packs[0].fragments.map(item => item.path), ['a.json']);
  assert.deepEqual(second.packs[0].fragments.map(item => item.path), ['b.json', 'a.json']);
});

test('opening a document can discover its nearest pack before the initial scan', t => {
  const { root, write } = createWorkspace(t);
  write('pack/shaderpack.json', basicRoot());
  const document = write('pack/folder/new.json', { value: true });
  const discovery = new WorkspacePackDiscovery([root]);
  assert.equal(discovery.snapshot.generation, 0);
  assert.equal(discovery.locatePackForDocument(document).id, 'example:test');
  assert.equal(discovery.snapshot.generation, 1);
});

test('root and tracked file create, rename and delete events rebuild the project model', t => {
  const { root, write } = createWorkspace(t);
  const manifestPath = path.join(root, 'pack', 'shaderpack.json');
  const fragmentPath = path.join(root, 'pack', 'part.json');
  const discovery = new WorkspacePackDiscovery([root]);
  assert.equal(discovery.refresh().packs.length, 0);

  write('pack/shaderpack.json', basicRoot({
    sourceFormatVersion: 1,
    fragments: ['part.json']
  }));
  let snapshot = discovery.handleFileEvents([manifestPath]);
  assert.equal(snapshot.packs.length, 1);
  assert.equal(snapshot.packs[0].fragments[0].exists, false);

  write('pack/part.json', { passes: [] });
  snapshot = discovery.handleFileEvents([fragmentPath]);
  assert.equal(snapshot.packs[0].fragments[0].exists, true);

  const renamedPath = path.join(root, 'pack', 'renamed.json');
  fs.renameSync(fragmentPath, renamedPath);
  snapshot = discovery.handleFileEvents([fragmentPath, renamedPath]);
  assert.equal(snapshot.packs[0].fragments[0].exists, false);

  fs.rmSync(manifestPath);
  snapshot = discovery.handleFileEvents([manifestPath]);
  assert.equal(snapshot.packs.length, 0);
});
