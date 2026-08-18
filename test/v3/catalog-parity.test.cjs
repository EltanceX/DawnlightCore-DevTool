const assert = require('node:assert/strict');
const Ajv = require('ajv');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  COLLECTIONS,
  exportCatalogSnapshot,
  validateCatalogSnapshot,
  diffCatalogSnapshots
} = require('../../tools/catalog/catalog-tool.cjs');

const root = path.resolve(__dirname, '..', '..');

function bundledSnapshot() {
  return JSON.parse(fs.readFileSync(
    path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json'),
    'utf8'
  ));
}

function sourceRegistrationFromSnapshot(snapshot) {
  return {
    sourceContractVersion: 1,
    host: snapshot.host,
    supportedFormats: snapshot.supportedFormats,
    registrations: Object.fromEntries(COLLECTIONS.map(collection => [collection, snapshot[collection]])),
    limits: snapshot.limits
  };
}

test('Catalog exporter reproduces the bundled Dawnlight snapshot and hash', () => {
  const expected = bundledSnapshot();
  const actual = exportCatalogSnapshot(sourceRegistrationFromSnapshot(expected));
  assert.deepEqual(actual, expected);
  assert.deepEqual(diffCatalogSnapshots(actual, expected), {
    equal: true,
    actualHash: expected.hash,
    expectedHash: expected.hash,
    differences: []
  });
});

test('generated engine source-registration fixture is in strict parity with bundled Catalog', () => {
  const expected = bundledSnapshot();
  const source = JSON.parse(fs.readFileSync(
    path.join(root, 'fixtures', 'catalog', 'dawnlight-3.1.engine-source-registration.json'),
    'utf8'
  ));
  const actual = exportCatalogSnapshot(source);
  assert.deepEqual(actual, expected);
});

test('source-registration v1 JSON Schema accepts the exporter input', () => {
  const expected = bundledSnapshot();
  const source = sourceRegistrationFromSnapshot(expected);
  const schema = JSON.parse(fs.readFileSync(
    path.join(root, 'schemas', 'dawnlight-catalog-source-registration-v1.schema.json'),
    'utf8'
  ));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
});

test('Catalog exporter normalizes registration order and dependency references', () => {
  const snapshot = exportCatalogSnapshot({
    sourceContractVersion: 1,
    host: { id: 'test', displayName: 'Test Host', version: '1' },
    supportedFormats: { manifest: [3, 1], sourceComposition: [1], settingsUi: [1] },
    registrations: {
      stageTemplates: [
        { id: 'test:z', version: 1 },
        { id: 'test:a', version: 2 }
      ],
      services: [{ id: 'test:service', version: 1 }],
      semantics: [{
        id: 'test:value', version: 1, valueKind: 'float',
        requiredServices: [{ id: 'test:service', version: 1 }]
      }],
      engineDrawProviders: [],
      capabilities: [],
      resourceFormats: []
    },
    limits: {}
  });
  assert.deepEqual(snapshot.supportedFormats.manifest, [1, 3]);
  assert.deepEqual(snapshot.stageTemplates.map(entry => entry.id), ['test:a', 'test:z']);
  assert.deepEqual(snapshot.semantics[0].requiredServices, ['test:service@1']);
  assert.equal(validateCatalogSnapshot(snapshot).valid, true);
});

test('Catalog exporter rejects duplicate registrations and invalid semantic metadata', () => {
  assert.throws(() => exportCatalogSnapshot({
    sourceContractVersion: 1,
    host: { id: 'test', displayName: 'Test', version: '1' },
    supportedFormats: { manifest: [3], sourceComposition: [1], settingsUi: [1] },
    registrations: {
      stageTemplates: [{ id: 'test:duplicate', version: 1 }, { id: 'test:duplicate', version: 1 }],
      services: [],
      semantics: [{ id: 'test:missing-kind', version: 1 }],
      engineDrawProviders: [],
      capabilities: [],
      resourceFormats: []
    },
    limits: {}
  }), error => error.code === 'CATALOG_SOURCE_INVALID' && error.errors.some(item => item.code === 'duplicate'));
});

test('Catalog source contract rejects unknown top-level and host fields', () => {
  assert.throws(() => exportCatalogSnapshot({
    sourceContractVersion: 1,
    unexpected: true,
    host: {
      id: 'test', displayName: 'Test', version: '1', unexpected: 'nope'
    },
    supportedFormats: { manifest: [1], sourceComposition: [1], settingsUi: [1] },
    registrations: {},
    limits: {}
  }), error => error.code === 'CATALOG_SOURCE_INVALID' &&
    error.errors.filter(item => item.code === 'unknown-property').length === 2);
});

test('Catalog source contract rejects nested collection, format, and reference fields', () => {
  const base = sourceRegistrationFromSnapshot(bundledSnapshot());
  const invalid = {
    ...base,
    supportedFormats: { ...base.supportedFormats, future: [1] },
    registrations: {
      ...base.registrations,
      futureCollection: [],
      semantics: [{
        ...base.registrations.semantics[0],
        requiredServices: [{ id: 'dawnlight:frame_uniforms', version: 1, future: true }]
      }]
    }
  };
  assert.throws(() => exportCatalogSnapshot(invalid), error =>
    error.code === 'CATALOG_SOURCE_INVALID' &&
    error.errors.some(item => item.path === 'supportedFormats.future') &&
    error.errors.some(item => item.path === 'registrations.futureCollection') &&
    error.errors.some(item => item.path.endsWith('.future'))
  );
});

test('Catalog exporter uses the same canonical ordering as the TypeScript contract', () => {
  const source = {
    sourceContractVersion: 1,
    host: { id: 'test', displayName: 'Test', version: '1' },
    supportedFormats: { manifest: [1], sourceComposition: [1], settingsUi: [1] },
    registrations: {
      stageTemplates: [{ id: 'z:entry', version: 1 }, { id: 'a:entry', version: 1 }],
      services: [], semantics: [], engineDrawProviders: [], capabilities: [], resourceFormats: []
    },
    limits: {}
  };
  const exported = exportCatalogSnapshot(source);
  const contracts = require('../../packages/contracts/dist');
  assert.equal(exported.hash, contracts.computeCatalogSnapshotHash(exported));
});

test('Catalog Snapshot parser rejects nested unknown fields and duplicate format versions', () => {
  const snapshot = bundledSnapshot();
  const withUnknownHost = { ...snapshot, host: { ...snapshot.host, futureField: true } };
  withUnknownHost.hash = require('../../packages/contracts/dist').computeCatalogSnapshotHash(withUnknownHost);
  assert.throws(() => require('../../packages/contracts/dist').parseCatalogSnapshot(withUnknownHost), /not part of the contract/);

  const withDuplicateFormat = {
    ...snapshot,
    supportedFormats: { ...snapshot.supportedFormats, manifest: [3, 3] }
  };
  withDuplicateFormat.hash = require('../../packages/contracts/dist').computeCatalogSnapshotHash(withDuplicateFormat);
  assert.throws(() => require('../../packages/contracts/dist').parseCatalogSnapshot(withDuplicateFormat), /non-negative integers/);
});
