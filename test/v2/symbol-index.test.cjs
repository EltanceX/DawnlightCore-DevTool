const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WorkspaceCompositionManager } = require('../../packages/language-server/dist/composition');
const { JsoncDocumentStore } = require('../../packages/language-server/dist/jsoncDocuments');
const { WorkspaceSymbolIndexManager } = require('../../packages/language-server/dist/symbols');
const { WorkspacePackDiscovery } = require('../../packages/language-server/dist/workspaceDiscovery');

function createWorkspace(t, prefix = 'dawnlight-symbols-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relativePath, value) => {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    return target;
  };
  return { root, write };
}

function rootManifest(id, fragments, settings = 'ui/settings.json') {
  return {
    sourceFormatVersion: 1,
    manifestVersion: 3,
    id,
    name: id,
    version: '0.1.0',
    shaderRoot: 'shaders',
    settings,
    fragments
  };
}

async function buildIndex(root, store = new JsoncDocumentStore(), changedPaths = []) {
  const discovery = new WorkspacePackDiscovery([root]);
  const discoverySnapshot = discovery.refresh();
  const composition = new WorkspaceCompositionManager(store);
  const compositionResult = await composition.rebuild(discoverySnapshot);
  const index = new WorkspaceSymbolIndexManager();
  const indexResult = await index.rebuild(compositionResult.snapshot, discoverySnapshot, changedPaths);
  return { discovery, composition, index, snapshot: indexResult.snapshot };
}

test('indexes definitions, settings symbols, ID references, and resolved file paths', async t => {
  const { root, write } = createWorkspace(t);
  write('shaderpack.json', rootManifest('example:index', ['manifest/defs.json']));
  write('manifest/defs.json', {
    options: [{ id: 'example:enabled', type: 'boolean', default: true, impact: ['program'] }],
    resources: [{
      id: 'example:color', kind: 'texture2D', lifetime: 'persistent',
      size: { mode: 'viewport' }, format: 'rgba8',
      content: { type: 'asset', path: 'assets/color.png' }
    }],
    programs: [{
      id: 'example:program', kind: 'graphics', vertex: 'main.vsh', fragment: 'main.psh',
      defines: { ENABLED: { option: 'example:enabled' } }
    }],
    passes: [{
      id: 'example:pass',
      enabledWhen: [{ option: 'example:enabled', equals: true }],
      programs: ['example:program'],
      commands: [{
        type: 'fullscreen',
        program: 'example:program',
        targets: { colors: [{ location: 0, resource: 'example:color' }] }
      }],
      inputs: ['example:color'],
      outputs: ['example:color']
    }]
  });
  write('ui/settings.json', {
    schemaVersion: 1,
    pages: [{
      id: 'display', title: 'Display', groups: [{
        id: 'main', title: 'Main', controls: [{
          id: 'enabled', option: 'example:enabled', widget: 'toggle', label: 'Enabled'
        }]
      }]
    }]
  });
  write('shaders/main.vsh', 'void main() {}\n');
  write('shaders/main.psh', 'void main() {}\n');
  write('assets/color.png', 'fixture');

  const { snapshot } = await buildIndex(root);
  const project = snapshot.projects[0];
  assert.equal(project.symbols.filter(symbol => symbol.kind === 'option').length, 1);
  assert.equal(project.symbols.filter(symbol => symbol.kind === 'resource').length, 1);
  assert.equal(project.symbols.filter(symbol => symbol.kind === 'program').length, 1);
  assert.equal(project.symbols.filter(symbol => symbol.kind === 'pass').length, 1);
  assert.deepEqual(project.symbols.filter(symbol => symbol.kind.startsWith('settings')).map(symbol => symbol.kind), [
    'settingsPage', 'settingsGroup', 'settingsControl'
  ]);
  assert.equal(project.symbols.filter(symbol => symbol.kind === 'file').length, 6);

  const optionRefs = project.references.filter(reference => reference.kind === 'option');
  const programRefs = project.references.filter(reference => reference.kind === 'program');
  const resourceRefs = project.references.filter(reference => reference.kind === 'resource');
  assert.equal(optionRefs.length, 3);
  assert.equal(programRefs.length, 2);
  assert.equal(resourceRefs.length, 3);
  assert.ok(optionRefs.every(reference => reference.resolved && !reference.ambiguous));
  assert.ok(programRefs.every(reference => reference.resolved && !reference.ambiguous));
  assert.ok(resourceRefs.every(reference => reference.resolved && !reference.ambiguous));
  assert.equal(project.references.filter(reference => reference.kind === 'shader').length, 2);
  assert.equal(project.references.filter(reference => reference.kind === 'asset').length, 1);
  assert.ok(project.references.filter(reference => reference.kind === 'shader').every(reference => reference.resolved));
  assert.ok(project.references.find(reference => reference.kind === 'asset').targetPath === 'assets/color.png');
  assert.ok(project.symbols.every(symbol => Array.isArray(symbol.path)));
  assert.equal(Object.isFrozen(project), true);
  assert.equal(Object.isFrozen(project.symbols), true);
  assert.equal(Object.isFrozen(project.symbols[0].range), true);
});

test('reports duplicate canonical IDs while isolating packs', async t => {
  const { root, write } = createWorkspace(t, 'dawnlight-symbol-duplicate-');
  write('pack-a/shaderpack.json', rootManifest('example:a', ['a.json'], undefined));
  write('pack-a/a.json', { options: [{ id: 'example:duplicate' }], resources: [{ id: 'example:duplicate' }] });
  write('pack-b/shaderpack.json', rootManifest('example:b', ['b.json'], undefined));
  write('pack-b/b.json', { options: [{ id: 'example:duplicate' }] });

  const { snapshot } = await buildIndex(root);
  assert.equal(snapshot.projects.length, 2);
  const packA = snapshot.projects.find(project => project.rootUri.endsWith(`${path.sep}pack-a`));
  const packB = snapshot.projects.find(project => project.rootUri.endsWith(`${path.sep}pack-b`));
  assert.equal(packA.duplicates.length, 1);
  assert.equal(packA.duplicates[0].canonicalId, 'example:duplicate');
  assert.equal(packA.duplicates[0].definitions.length, 2);
  assert.equal(packA.diagnostics.filter(diagnostic => diagnostic.code === 'DLSYMBOL0001').length, 2);
  assert.equal(packB.duplicates.length, 0);
});

test('reuses unaffected project snapshots for an incremental rebuild', async t => {
  const { root, write } = createWorkspace(t, 'dawnlight-symbol-incremental-');
  const aRoot = path.join(root, 'pack-a');
  const bRoot = path.join(root, 'pack-b');
  write('pack-a/shaderpack.json', rootManifest('example:a', ['a.json'], undefined));
  const changedPath = write('pack-a/a.json', { options: [{ id: 'example:a' }] });
  write('pack-b/shaderpack.json', rootManifest('example:b', ['b.json'], undefined));
  write('pack-b/b.json', { options: [{ id: 'example:b' }] });

  const store = new JsoncDocumentStore();
  const first = await buildIndex(root, store);
  const firstB = first.snapshot.projects.find(project => project.rootUri === bRoot);
  fs.writeFileSync(changedPath, '{\n  "options": [{"id": "example:a2"}]\n}\n');
  store.invalidate(changedPath);
  const discoverySnapshot = first.discovery.refresh();
  const compositionResult = await first.composition.rebuild(discoverySnapshot);
  const second = await first.index.rebuild(compositionResult.snapshot, discoverySnapshot, [changedPath]);
  const secondB = second.snapshot.projects.find(project => project.rootUri === bRoot);
  assert.equal(secondB, firstB);
  assert.ok(second.snapshot.projects.find(project => project.rootUri === aRoot)
    .symbols.some(symbol => symbol.id === 'example:a2'));
});
