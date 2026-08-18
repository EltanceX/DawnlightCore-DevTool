const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const engineRoot = process.env.DAWNLIGHT_ENGINE_REPO;

if (!engineRoot) {
  console.log('Engine Analyzer acceptance skipped; set DAWNLIGHT_ENGINE_REPO to the Survivalcraft repository.');
  process.exit(0);
}

const project = path.join(engineRoot, 'tools', 'ShaderPackAnalyzer', 'ShaderPackAnalyzer.csproj');
const sidecar = path.join(engineRoot, 'tools', 'ShaderPackAnalyzer', 'bin', 'Release', 'net10.0',
  'shaderpack-analyzer.dll');
const packRoot = process.env.DAWNLIGHT_ENGINE_TEST_PACK ||
  path.join(engineRoot, 'Survivalcraft', 'shaderpacks', 'Dawnlight_v3.1');
const catalogPath = process.env.DAWNLIGHT_CATALOG_PATH ||
  path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json');

for (const [label, target] of [['Analyzer project', project], ['test pack', packRoot], ['Catalog', catalogPath]]) {
  assert.ok(fs.existsSync(target), `${label} does not exist: ${target}`);
}

if (process.env.DAWNLIGHT_SKIP_ENGINE_BUILD !== '1') {
  execFileSync('dotnet', ['build', project, '-c', 'Release', '--nologo'], {
    cwd: engineRoot,
    stdio: 'inherit'
  });
}
assert.ok(fs.existsSync(sidecar), `Analyzer sidecar was not built: ${sidecar}`);

process.env.DAWNLIGHT_CATALOG_PATH = catalogPath;
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const { DawnlightAnalyzerClient } = require('../packages/language-server/dist/analyzerClient');

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const explainedProgramId = process.env.DAWNLIGHT_ENGINE_TEST_PROGRAM ||
  'dawnlight:post_process/final';

function runtimeParams(requestVersion, inputs = { options: {}, capabilities: {} }) {
  return {
    packRoot,
    catalogHash: catalog.hash,
    requestVersion,
    overlays: [],
    clientSupportedVersions: [1],
    inputs,
    includeInactive: true
  };
}

function assertSuccessfulRuntimeResult(result, payloadName) {
  assert.ok(result, `Production Analyzer did not return a ${payloadName} result.`);
  assert.equal(result.compatible, true);
  assert.equal(result.success, true);
  assert.equal(result.selectedVersion, 1);
  assert.equal(result.catalogHash, catalog.hash);
  assert.match(result.manifestHash || '', HASH_PATTERN);
  assert.ok(result[payloadName], `Production Analyzer omitted the ${payloadName} payload.`);
}

async function main() {
  const client = new DawnlightAnalyzerClient({
    analyzerPath: sidecar,
    catalogHash: catalog.hash,
    timeoutMs: 10000,
    restartLimit: 0,
    onStderr: text => process.stderr.write(text)
  });
  try {
    const exported = await client.getCatalog({
      clientSupportedVersions: [1],
      expectedCatalogHash: catalog.hash
    });
    assert.ok(exported, 'Production Analyzer did not return a valid Catalog.');
    assert.equal(exported.catalogHash, catalog.hash);
    assert.equal(exported.compatible, true);

    const valid = await client.validatePack({
      packRoot,
      catalogHash: catalog.hash,
      requestVersion: 1,
      overlays: []
    });
    assert.ok(valid, 'Production Analyzer did not return a validatePack result.');
    assert.equal(valid.valid, true);
    assert.match(valid.manifestHash || '', HASH_PATTERN);

    const invalid = await client.validatePack({
      packRoot,
      catalogHash: catalog.hash,
      requestVersion: 2,
      overlays: [{ path: 'shaderpack.json', version: 2, content: '{}' }]
    });
    assert.ok(invalid, 'Production Analyzer did not return the overlay result.');
    assert.equal(invalid.valid, false);
    assert.equal(invalid.diagnostics[0]?.code, 'DLMAN0001');
    assert.equal(invalid.diagnostics[0]?.pointer, '/manifestVersion');

    const firstGraph = await client.dumpGraph(runtimeParams(3));
    const secondGraph = await client.dumpGraph(runtimeParams(4));
    assertSuccessfulRuntimeResult(firstGraph, 'graph');
    assertSuccessfulRuntimeResult(secondGraph, 'graph');
    assert.match(firstGraph.graph.graphHash, HASH_PATTERN);
    assert.match(firstGraph.graph.variantFingerprint, HASH_PATTERN);
    assert.equal(secondGraph.graph.graphHash, firstGraph.graph.graphHash,
      'Identical production inputs must produce a stable graph hash.');
    assert.equal(secondGraph.graph.variantFingerprint, firstGraph.graph.variantFingerprint,
      'Identical production inputs must produce a stable graph variant fingerprint.');
    assert.ok(firstGraph.graph.nodes.length > 0, 'Production graph must contain nodes.');
    assert.ok(firstGraph.graph.edges.length > 0, 'Production graph must contain dependency edges.');
    assert.ok(firstGraph.graph.executionOrder.length > 0, 'Production graph must contain execution order.');
    assert.ok(firstGraph.graph.resources.length > 0, 'Production graph must contain resources.');
    assert.ok(firstGraph.graph.events.length > 0, 'Production graph must contain access events.');
    assert.ok(firstGraph.graph.nodes.some(node => node.kind === 'program'),
      'Production graph must project resolved programs.');
    assert.ok(firstGraph.graph.nodes.some(node => node.kind === 'command'),
      'Production graph must project resolved commands.');

    const firstVariant = await client.explainVariant({
      ...runtimeParams(5),
      programId: explainedProgramId
    });
    const secondVariant = await client.explainVariant({
      ...runtimeParams(6),
      programId: explainedProgramId
    });
    assertSuccessfulRuntimeResult(firstVariant, 'explanation');
    assertSuccessfulRuntimeResult(secondVariant, 'explanation');
    const explanation = firstVariant.explanation;
    assert.equal(explanation.programId, explainedProgramId);
    assert.match(explanation.variantFingerprint, HASH_PATTERN);
    assert.equal(secondVariant.explanation.variantFingerprint, explanation.variantFingerprint,
      'Identical production inputs must produce a stable program fingerprint.');
    assert.ok(explanation.sourceFiles.length >= 1, 'Variant explanation must contain shader sources.');
    assert.ok(explanation.defines.length > 0, 'Variant explanation must contain resolved defines.');
    assert.ok(explanation.defines.every(define => define.source && typeof define.source.kind === 'string'),
      'Every resolved define must report its source kind.');
    assert.ok(explanation.defines.some(define =>
      define.source.kind === 'option' && define.source.id === 'dawnlight:post/tone_mapping'),
    'The production option-backed define must preserve option provenance.');
    assert.ok(explanation.inputs.options.some(input =>
      input.id === 'dawnlight:post/tone_mapping' && input.source === 'default'),
    'Default option resolution must be visible in the explanation.');

    const changedInputs = {
      options: { 'dawnlight:post/tone_mapping': 'vivid' },
      capabilities: {}
    };
    const changedGraph = await client.dumpGraph(runtimeParams(7, changedInputs));
    assertSuccessfulRuntimeResult(changedGraph, 'graph');
    assert.notEqual(changedGraph.graph.graphHash, firstGraph.graph.graphHash,
      'A graph-affecting option override must change the graph snapshot hash.');
    assert.notEqual(changedGraph.graph.variantFingerprint, firstGraph.graph.variantFingerprint,
      'A graph-affecting option override must change the graph variant fingerprint.');

    const changedVariant = await client.explainVariant({
      ...runtimeParams(8, changedInputs),
      programId: explainedProgramId
    });
    assertSuccessfulRuntimeResult(changedVariant, 'explanation');
    assert.notEqual(changedVariant.explanation.variantFingerprint, explanation.variantFingerprint,
      'An option-backed define change must change the program fingerprint.');
    assert.ok(changedVariant.explanation.inputs.options.some(input =>
      input.id === 'dawnlight:post/tone_mapping' && input.value === 'vivid' && input.source === 'request'),
    'The changed option must report request provenance.');

    const missingProgram = await client.explainVariant({
      ...runtimeParams(9),
      programId: 'dawnlight:acceptance/missing-program'
    });
    assert.ok(missingProgram, 'Production Analyzer did not return the missing-program domain failure.');
    assert.equal(missingProgram.compatible, true);
    assert.equal(missingProgram.success, false);
    assert.equal(missingProgram.explanation, undefined);
    assert.equal(missingProgram.diagnostics[0]?.code, 'DLGRAPH0003');
    assert.equal(client.status.state, 'ready', 'A domain failure must keep the Analyzer usable.');

    // Keep one production analysis in flight so the second request reaches the
    // sidecar and waits on its serialized resolver gate before cancellation.
    const gateGraph = client.dumpGraph(runtimeParams(10));
    const cancellation = new AbortController();
    const cancelledGraph = client.dumpGraph(runtimeParams(11), cancellation.signal);
    await new Promise(resolve => setImmediate(resolve));
    cancellation.abort();
    assert.equal(await cancelledGraph, undefined,
      'A cancelled production graph request must be discarded by the client.');
    const completedGateGraph = await gateGraph;
    assertSuccessfulRuntimeResult(completedGateGraph, 'graph');

    const recoveryGraph = await client.dumpGraph(runtimeParams(12));
    assertSuccessfulRuntimeResult(recoveryGraph, 'graph');
    assert.equal(recoveryGraph.graph.graphHash, firstGraph.graph.graphHash,
      'The Analyzer must recover cleanly after domain failure and cancellation.');

    console.log(
      `Engine Analyzer acceptance passed: catalog=${exported.catalogHash} ` +
      `graph=${firstGraph.graph.graphHash} program=${explainedProgramId} ` +
      `variant=${explanation.variantFingerprint}`
    );
  } finally {
    await client.shutdown();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
