const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
const path = require('node:path');
const {
  CONTRACT_VERSIONS,
  LSP_METHODS,
  computeCatalogSnapshotHash,
  verifyCatalogSnapshotHash
} = require('../../packages/contracts/dist');
const {
  loadBundledCatalogSnapshot,
  negotiateCatalogSnapshotVersion,
  resolveCatalogSnapshot
} = require('../../packages/language-server/dist/catalog');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const serverPath = path.resolve(__dirname, '..', '..', 'dist', 'server.js');
const catalogDirectory = path.resolve(__dirname, '..', '..', 'catalogs');

function createExternalCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-catalog-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bundled = loadBundledCatalogSnapshot(catalogDirectory).snapshot;
  const payload = {
    ...bundled,
    host: { ...bundled.host, build: 'external-test' }
  };
  payload.hash = computeCatalogSnapshotHash(payload);
  const filePath = path.join(directory, 'external.catalog.json');
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return { filePath, snapshot: payload };
}

test('bundled Dawnlight 3.1 Catalog Snapshot loads with a valid canonical hash', () => {
  const catalog = loadBundledCatalogSnapshot(catalogDirectory);
  assert.equal(catalog.source, 'bundled');
  assert.equal(catalog.snapshot.contractVersion, CONTRACT_VERSIONS.catalogSnapshot);
  assert.equal(catalog.snapshot.host.id, 'dawnlight');
  assert.equal(catalog.snapshot.host.version, '3.1');
  assert.equal(catalog.hashValid, true);
  assert.equal(verifyCatalogSnapshotHash(catalog.snapshot), true);
  assert.match(catalog.hash, /^[0-9a-f]{64}$/);
});

test('Catalog version negotiation selects the highest common version', () => {
  assert.deepEqual(negotiateCatalogSnapshotVersion([1, 3, 2], [1, 2]), {
    clientSupportedVersions: [1, 2, 3],
    serverSupportedVersions: [1, 2],
    selectedVersion: 2,
    compatible: true
  });
  assert.deepEqual(negotiateCatalogSnapshotVersion([7], [1]), {
    clientSupportedVersions: [7],
    serverSupportedVersions: [1],
    selectedVersion: undefined,
    compatible: false
  });
});

test('external Catalog is selected when valid and falls back when its hash is invalid', t => {
  const external = createExternalCatalog(t);
  const selected = resolveCatalogSnapshot(catalogDirectory, {
    externalPath: external.filePath,
    clientSupportedVersions: [1]
  });
  assert.equal(selected.source, 'external');
  assert.equal(selected.snapshot.host.build, 'external-test');
  assert.equal(selected.fallbackReason, undefined);
  assert.equal(selected.negotiation.selectedVersion, 1);

  const tampered = { ...external.snapshot, host: { ...external.snapshot.host, build: 'tampered' } };
  fs.writeFileSync(external.filePath, `${JSON.stringify(tampered, null, 2)}\n`);
  const fallback = resolveCatalogSnapshot(catalogDirectory, {
    externalPath: external.filePath,
    clientSupportedVersions: [1]
  });
  assert.equal(fallback.source, 'bundled');
  assert.match(fallback.fallbackReason, /canonical hash does not match/);
});

test('language server exposes bundled Catalog source and hash without a workspace', async t => {
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });

  const catalog = await harness.sendRequest(LSP_METHODS.catalogSnapshot);
  assert.equal(catalog.source, 'bundled');
  assert.equal(catalog.hashValid, true);
  assert.equal(catalog.snapshot.contractVersion, 1);
  assert.equal(catalog.snapshot.host.id, 'dawnlight');
  assert.equal(catalog.snapshot.host.version, '3.1');
  assert.ok(catalog.snapshot.stageTemplates.some(entry => entry.id === 'dawnlight:fullscreen'));
  assert.ok(catalog.snapshot.services.some(entry => entry.id === 'dawnlight:scene_target'));
  assert.ok(catalog.snapshot.semantics.some(entry => entry.id === 'dawnlight:camera/view_matrix'));
  assert.deepEqual(catalog.negotiation, {
    clientSupportedVersions: [1],
    serverSupportedVersions: [1],
    selectedVersion: 1,
    compatible: true
  });
});

test('language server negotiates and exposes a configured external Catalog', async t => {
  const external = createExternalCatalog(t);
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [1],
    catalogPath: external.filePath
  });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });

  const catalog = await harness.sendRequest(LSP_METHODS.catalogSnapshot);
  assert.equal(catalog.source, 'external');
  assert.equal(catalog.path, external.filePath);
  assert.equal(catalog.snapshot.host.build, 'external-test');
  assert.equal(catalog.negotiation.selectedVersion, 1);
});
