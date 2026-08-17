const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  CONTRACT_VERSIONS,
  LSP_METHODS,
  verifyCatalogSnapshotHash
} = require('../../packages/contracts/dist');
const { loadBundledCatalogSnapshot } = require('../../packages/language-server/dist/catalog');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const serverPath = path.resolve(__dirname, '..', '..', 'dist', 'server.js');

test('bundled Dawnlight 3.1 Catalog Snapshot loads with a valid canonical hash', () => {
  const catalog = loadBundledCatalogSnapshot(path.resolve(__dirname, '..', '..', 'catalogs'));
  assert.equal(catalog.source, 'bundled');
  assert.equal(catalog.snapshot.contractVersion, CONTRACT_VERSIONS.catalogSnapshot);
  assert.equal(catalog.snapshot.host.id, 'dawnlight');
  assert.equal(catalog.snapshot.host.version, '3.1');
  assert.equal(catalog.hashValid, true);
  assert.equal(verifyCatalogSnapshotHash(catalog.snapshot), true);
  assert.match(catalog.hash, /^[0-9a-f]{64}$/);
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
  assert.deepEqual(catalog.snapshot.stageTemplates, []);
});
