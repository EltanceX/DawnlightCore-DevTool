const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTRACT_VERSIONS,
  ANALYZER_METHODS,
  DEFAULT_ANALYZER_PROTOCOL_VERSIONS,
  DIAGNOSTIC_NAMESPACES,
  LSP_METHODS,
  SERVER_CAPABILITIES,
  createDiagnosticCode,
  computeCatalogSnapshotHash,
  parseCatalogSnapshot,
  verifyCatalogSnapshotHash
} = require('../../packages/contracts/dist');

test('contract versions are explicit and independent from the extension version', () => {
  assert.deepEqual(CONTRACT_VERSIONS, {
    languageServerProtocol: 1,
    analyzerProtocol: 1,
    catalogSnapshot: 1,
    schemaContract: 1,
    manifest: 3,
    sourceComposition: 1,
    settingsUi: 1
  });
  assert.equal(typeof CONTRACT_VERSIONS.languageServerProtocol, 'number');
  assert.notEqual(CONTRACT_VERSIONS.languageServerProtocol, '0.1.0');
});

test('server capabilities advertise every authoring contract supported by V2-0', () => {
  assert.deepEqual(SERVER_CAPABILITIES, {
    languageServerProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    analyzerProtocolVersions: [CONTRACT_VERSIONS.analyzerProtocol],
    schemaContractVersion: CONTRACT_VERSIONS.schemaContract,
    catalogSnapshotVersions: [CONTRACT_VERSIONS.catalogSnapshot],
    manifestVersions: [CONTRACT_VERSIONS.manifest],
    sourceCompositionVersions: [CONTRACT_VERSIONS.sourceComposition],
    settingsUiVersions: [CONTRACT_VERSIONS.settingsUi]
  });
  assert.equal(Object.isFrozen(SERVER_CAPABILITIES), true);
  assert.equal(Object.isFrozen(SERVER_CAPABILITIES.manifestVersions), true);
});

test('diagnostic namespaces and stable four-digit codes are reserved', () => {
  assert.deepEqual(DIAGNOSTIC_NAMESPACES, {
    json: 'DLJSON',
    schema: 'DLSCHEMA',
    symbol: 'DLSYMBOL',
    path: 'DLPATH',
    catalog: 'DLCAT',
    manifest: 'DLMAN',
    graph: 'DLGRAPH'
  });
  assert.equal(createDiagnosticCode('json', 0), 'DLJSON0000');
  assert.equal(createDiagnosticCode('manifest', 37), 'DLMAN0037');
  assert.equal(createDiagnosticCode('graph', 9999), 'DLGRAPH9999');
});

test('Analyzer protocol methods and Language Server control methods are stable', () => {
  assert.deepEqual(ANALYZER_METHODS, {
    initialize: 'dawnlight/initialize',
    getCatalog: 'dawnlight/getCatalog',
    validatePack: 'dawnlight/validatePack',
    dumpGraph: 'dawnlight/dumpGraph',
    explainVariant: 'dawnlight/explainVariant',
    shutdown: 'dawnlight/shutdown'
  });
  assert.deepEqual(DEFAULT_ANALYZER_PROTOCOL_VERSIONS, [CONTRACT_VERSIONS.analyzerProtocol]);
  assert.equal(LSP_METHODS.validatePack, 'dawnlight/validatePack');
  assert.equal(LSP_METHODS.analyzerStatus, 'dawnlight/analyzerStatus');
  assert.equal(LSP_METHODS.restartAnalyzer, 'dawnlight/restartAnalyzer');
});

test('diagnostic code creation rejects unstable ordinals', () => {
  for (const value of [-1, 1.5, 10000, Number.NaN]) {
    assert.throws(() => createDiagnosticCode('schema', value), RangeError);
  }
});

test('Catalog Snapshot v1 has a stable hash independent of object key order', () => {
  const payload = {
    contractVersion: 1,
    host: { version: '3.1', id: 'dawnlight', displayName: 'Dawnlight' },
    supportedFormats: { settingsUi: [1], manifest: [3], sourceComposition: [1] },
    stageTemplates: [],
    services: [],
    semantics: [],
    engineDrawProviders: [],
    capabilities: [],
    resourceFormats: [],
    limits: {}
  };
  const snapshot = { ...payload, hash: computeCatalogSnapshotHash(payload) };
  assert.equal(verifyCatalogSnapshotHash(parseCatalogSnapshot(snapshot)), true);
  assert.equal(computeCatalogSnapshotHash({ ...payload, host: { ...payload.host } }), snapshot.hash);
  assert.equal(computeCatalogSnapshotHash({
    ...payload,
    semantics: [
      { id: 'dawnlight:z', version: 1, valueKind: 'number' },
      { id: 'dawnlight:a', version: 2, valueKind: 'number' }
    ]
  }), computeCatalogSnapshotHash({
    ...payload,
    semantics: [
      { id: 'dawnlight:a', version: 2, valueKind: 'number' },
      { id: 'dawnlight:z', version: 1, valueKind: 'number' }
    ]
  }));
});

test('Catalog Snapshot v1 rejects duplicate ID/version entries', () => {
  assert.throws(() => parseCatalogSnapshot({
    contractVersion: 1,
    host: { id: 'dawnlight', displayName: 'Dawnlight', version: '3.1' },
    supportedFormats: { manifest: [3], sourceComposition: [1], settingsUi: [1] },
    stageTemplates: [],
    services: [{ id: 'dawnlight:test', version: 1 }, { id: 'dawnlight:test', version: 1 }],
    semantics: [],
    engineDrawProviders: [],
    capabilities: [],
    resourceFormats: [],
    limits: {},
    hash: 'deadbeef'
  }), /duplicate/);
});
