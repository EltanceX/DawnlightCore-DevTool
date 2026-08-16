const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTRACT_VERSIONS,
  DIAGNOSTIC_NAMESPACES,
  SERVER_CAPABILITIES,
  createDiagnosticCode
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
    schemaContractVersion: CONTRACT_VERSIONS.schemaContract,
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

test('diagnostic code creation rejects unstable ordinals', () => {
  for (const value of [-1, 1.5, 10000, Number.NaN]) {
    assert.throws(() => createDiagnosticCode('schema', value), RangeError);
  }
});
