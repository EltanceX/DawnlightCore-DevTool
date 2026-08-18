const assert = require('node:assert/strict');
const Ajv = require('ajv');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const contracts = require('../../packages/contracts/dist');

const root = path.resolve(__dirname, '..', '..');
const hash = 'a'.repeat(64);

function graphPayload() {
  return {
    contractVersion: 1,
    variantFingerprint: hash,
    nodes: [
      { id: 'pass:main', kind: 'pass', label: 'Main pass', active: true, order: 0,
        provenance: [{ kind: 'fragment', file: 'manifest/passes/main.json', pointer: '/id' }] },
      { id: 'resource:color', kind: 'resource', label: 'Color', active: true }
    ],
    edges: [{ id: 'edge:main-color', kind: 'writes', from: 'pass:main', to: 'resource:color' }],
    executionOrder: ['pass:main', 'resource:color'],
    events: [{ id: 'event:write', kind: 'write', nodeId: 'pass:main', order: 0, resourceId: 'resource:color' }],
    resources: [{ id: 'resource:color', nodeId: 'resource:color', kind: 'texture',
      lifetime: { firstOrder: 0, lastOrder: 0, persistent: false, history: false } }],
    bindings: [],
    drawBuffers: [],
    hazards: []
  };
}

function graph() {
  const payload = graphPayload();
  return { ...payload, graphHash: contracts.computeRuntimeGraphHash(payload) };
}

function baseParams(extra = {}) {
  return {
    packRoot: 'C:/packs/example',
    catalogHash: hash,
    requestVersion: 7,
    overlays: [],
    clientSupportedVersions: [1],
    inputs: { options: {}, capabilities: {} },
    includeInactive: false,
    ...extra
  };
}

test('runtime graph and variant methods are independently versioned', () => {
  assert.equal(contracts.ANALYZER_METHODS.dumpGraph, 'dawnlight/dumpGraph');
  assert.equal(contracts.ANALYZER_METHODS.explainVariant, 'dawnlight/explainVariant');
  assert.equal(contracts.RUNTIME_GRAPH_CONTRACT_VERSION, 1);
  assert.equal(contracts.VARIANT_EXPLAIN_CONTRACT_VERSION, 1);
  assert.deepEqual(contracts.DEFAULT_RUNTIME_GRAPH_VERSIONS, [1]);
  assert.deepEqual(contracts.DEFAULT_VARIANT_EXPLAIN_VERSIONS, [1]);
});

test('dumpGraph parser validates refs, hashes, and stale-safe response envelope', () => {
  const parsedParams = contracts.parseDawnlightAnalyzerDumpGraphParams(baseParams());
  assert.equal(parsedParams.requestVersion, 7);
  const result = contracts.parseDawnlightAnalyzerDumpGraphResult({
    requestVersion: 7,
    catalogHash: hash,
    manifestHash: hash,
    compatible: true,
    success: true,
    serverSupportedVersions: [1],
    selectedVersion: 1,
    diagnostics: [],
    graph: graph()
  });
  assert.equal(result.graph.graphHash, graph().graphHash);
  assert.equal(contracts.verifyRuntimeGraphHash(result.graph), true);

  assert.throws(() => contracts.parseDawnlightAnalyzerDumpGraphResult({
    requestVersion: 7, catalogHash: hash, manifestHash: hash, compatible: true, success: true,
    serverSupportedVersions: [1], selectedVersion: 1, diagnostics: [],
    graph: { ...graph(), edges: [{ ...graph().edges[0], to: 'missing' }] }
  }), /unknown node|graphHash/);
  assert.throws(() => contracts.parseDawnlightAnalyzerDumpGraphResult({
    requestVersion: 7, catalogHash: hash, compatible: false, success: false,
    serverSupportedVersions: [1], selectedVersion: 1,
    diagnostics: [{ severity: 'error', code: 'DLGRAPH0001', message: 'incompatible' }]
  }), /compatible|selectedVersion/);
  assert.throws(() => contracts.parseDawnlightAnalyzerDumpGraphResult({
    requestVersion: 7, catalogHash: hash, compatible: false, success: false,
    serverSupportedVersions: [1], diagnostics: [{ severity: 'error', code: 'DLMAN0001', message: 'failed' }],
    explanation: {}
  }), /not part of the contract/);
});

test('variant explanation parser preserves input/define provenance and domain errors', () => {
  const params = contracts.parseDawnlightAnalyzerExplainVariantParams({
    ...baseParams(),
    programId: 'example:minimal/fullscreen'
  });
  assert.equal(params.programId, 'example:minimal/fullscreen');
  const explanation = {
    contractVersion: 1,
    programId: params.programId,
    kind: 'graphics',
    active: true,
    compileMode: 'legacyCustom',
    variantFingerprint: hash,
    sourceFiles: [{ stage: 'vertex', file: 'Fullscreen.vsh' }, { stage: 'fragment', file: 'Fullscreen.psh' }],
    inputs: {
      options: [{ id: 'example:minimal/enabled', value: true, source: 'request', provenance: { kind: 'fragment', file: 'manifest/programs/main.json', pointer: '/programs/0/defines/Enabled' } }],
      capabilities: []
    },
    defines: [{ name: 'Enabled', defined: true, value: '1', source: { kind: 'option', id: 'example:minimal/enabled', inputValue: true, mapped: true } }],
    includes: [{ file: 'common/Fullscreen.inc' }],
    graphNodeIds: ['program:example/minimal/fullscreen']
  };
  const result = contracts.parseDawnlightAnalyzerExplainVariantResult({
    requestVersion: 8, catalogHash: hash, manifestHash: hash, compatible: true, success: true,
    serverSupportedVersions: [1], selectedVersion: 1, diagnostics: [], explanation
  });
  assert.equal(result.explanation.defines[0].source.id, 'example:minimal/enabled');

  const domainFailure = contracts.parseDawnlightAnalyzerExplainVariantResult({
    requestVersion: 9, catalogHash: hash, compatible: true, success: false,
    serverSupportedVersions: [1], selectedVersion: 1,
    diagnostics: [{ severity: 'error', code: 'DLMAN0001', message: 'Program not found' }]
  });
  assert.equal(domainFailure.explanation, undefined);
  assert.throws(() => contracts.parseDawnlightAnalyzerExplainVariantResult({
    requestVersion: 9, catalogHash: hash, compatible: true, success: true,
    serverSupportedVersions: [1], selectedVersion: 1, manifestHash: hash, diagnostics: [], explanation: {
      ...explanation, includes: [{ file: '../escape.inc' }]
    }
  }), /traversal|pack-relative/);
});

test('runtime payload schemas reject unknown fields and accept minimal valid snapshots', () => {
  const graphSchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'dawnlight-runtime-graph-v1.schema.json'), 'utf8'));
  const variantSchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'dawnlight-variant-explain-v1.schema.json'), 'utf8'));
  const validateGraph = new Ajv({ allErrors: true, strict: false }).compile(graphSchema);
  assert.equal(validateGraph(graph()), true, JSON.stringify(validateGraph.errors));
  const invalid = { ...graph(), futureField: true };
  assert.equal(validateGraph(invalid), false);
  const validateVariant = new Ajv({ allErrors: true, strict: false }).compile(variantSchema);
  assert.equal(validateVariant({
    contractVersion: 1, programId: 'p', kind: 'compute', active: false, inactiveReason: 'condition',
    variantFingerprint: hash, sourceFiles: [], inputs: { options: [], capabilities: [] }, defines: [], includes: [], graphNodeIds: []
  }), true, JSON.stringify(validateVariant.errors));
});
