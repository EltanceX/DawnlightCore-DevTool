const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { WorkspacePackDiscovery } = require('../packages/language-server/dist/workspaceDiscovery');
const { JsoncDocumentStore } = require('../packages/language-server/dist/jsoncDocuments');
const { WorkspaceCompositionManager } = require('../packages/language-server/dist/composition');
const { WorkspaceSymbolIndexManager } = require('../packages/language-server/dist/symbols');
const { DawnlightCompletionService } = require('../packages/language-server/dist/completion');
const { DawnlightFastDiagnosticService } = require('../packages/language-server/dist/diagnostics');
const { resolveCatalogSnapshot } = require('../packages/language-server/dist/catalog');
const { DawnlightAnalyzerClient } = require('../packages/language-server/dist/analyzerClient');
const {
  RuntimeSnapshotCache,
  runtimeInputFingerprint,
  renderRuntimeGraph,
  renderVariantExplanation
} = require('../packages/language-server/dist/runtimeAnalysis');

const root = path.resolve(__dirname, '..');
const thresholds = {
  initialDiscoveryIndex: 1000,
  incrementalFragmentRebuild: 300,
  warmCompletionP95: 50,
  fastDiagnostics: 250,
  analyzerWarmResponse: 2000,
  runtimeFingerprintP95: 15,
  runtimeGraphRenderP95: 100,
  runtimeVariantRenderP95: 25,
  runtimeCacheWarmP95: 1
};

function writeJson(workspace, relativePath, value) {
  const target = path.join(workspace, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function measure(iterations, operation) {
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    operation(index);
    values.push(performance.now() - start);
  }
  return values;
}

function createRuntimeBenchmarkData(workspace) {
  const nodeCount = 240;
  const resourceCount = 80;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `command:benchmark:pass:${index}`,
    kind: index % 12 === 0 ? 'program' : 'command',
    label: `Benchmark node ${index}`,
    active: true,
    order: index,
    provenance: [{
      kind: 'fragment',
      file: 'manifest/pipeline.json',
      pointer: `/passes/${index % 24}`
    }],
    properties: [{ name: 'index', value: index }]
  }));
  const resources = Array.from({ length: resourceCount }, (_, index) => ({
    id: `example:resource-${index}`,
    nodeId: nodes[index].id,
    kind: index % 4 === 0 ? 'buffer' : 'texture',
    lifetime: { firstOrder: index, lastOrder: index + 80, persistent: false, history: false },
    provenance: [{ kind: 'fragment', file: 'manifest/pipeline.json', pointer: `/resources/${index}` }]
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge:${index}`,
    kind: 'sequence',
    from: nodes[index].id,
    to: node.id,
    order: index
  }));
  const events = nodes.map((node, index) => ({
    id: `event:${index}`,
    kind: index % 3 === 0 ? 'write' : 'read',
    nodeId: node.id,
    resourceId: resources[index % resourceCount].id,
    order: index,
    provenance: [{ kind: 'runtime', description: 'benchmark access' }]
  }));
  const graphResult = {
    catalogHash: 'c'.repeat(64),
    manifestHash: 'd'.repeat(64),
    graph: {
      contractVersion: 1,
      graphHash: 'a'.repeat(64),
      variantFingerprint: 'b'.repeat(64),
      nodes,
      edges,
      executionOrder: nodes.map(node => node.id),
      events,
      resources,
      bindings: [],
      drawBuffers: [],
      hazards: []
    }
  };
  const variantResult = {
    catalogHash: 'c'.repeat(64),
    manifestHash: 'd'.repeat(64),
    explanation: {
      contractVersion: 1,
      programId: 'example:main',
      kind: 'graphics',
      active: true,
      compileMode: 'legacyCustom',
      variantFingerprint: 'e'.repeat(64),
      sourceFiles: [
        { stage: 'vertex', file: 'shaders/main.vsh', provenance: { kind: 'shader', file: 'shaders/main.vsh' } },
        { stage: 'fragment', file: 'shaders/main.psh', provenance: { kind: 'shader', file: 'shaders/main.psh' } }
      ],
      inputs: {
        options: Array.from({ length: 48 }, (_, index) => ({
          id: `example:option-${index}`,
          value: index,
          source: 'default',
          provenance: { kind: 'fragment', file: 'manifest/pipeline.json', pointer: `/options/${index}` }
        })),
        capabilities: []
      },
      defines: Array.from({ length: 72 }, (_, index) => ({
        name: `BENCHMARK_${index}`,
        defined: true,
        value: index,
        source: { kind: 'option', id: `example:option-${index % 48}`, inputValue: index }
      })),
      includes: Array.from({ length: 24 }, (_, index) => ({
        file: `shaders/include/benchmark-${index}.glsl`,
        includedBy: 'shaders/main.psh',
        provenance: { kind: 'shader', file: `shaders/include/benchmark-${index}.glsl` }
      })),
      graphNodeIds: nodes.slice(0, 24).map(node => node.id)
    }
  };
  const project = {
    documents: Array.from({ length: 32 }, (_, index) => ({
      absolutePath: path.join(workspace, 'manifest', `runtime-${index}.json`),
      source: index % 4 === 0 ? 'overlay' : 'disk',
      version: index,
      text: `${JSON.stringify({ index, values: Array.from({ length: 64 }, (_, value) => value) })}\n`
    }))
  };
  return { graphResult, variantResult, project };
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-benchmark-'));
  try {
    const optionCount = 96;
    const options = Array.from({ length: optionCount }, (_, index) => ({
      id: `example:option-${String(index).padStart(3, '0')}`,
      type: index % 2 === 0 ? 'boolean' : 'number',
      default: index % 2 === 0 ? false : index
    }));
    const resources = Array.from({ length: 48 }, (_, index) => ({
      id: `example:resource-${String(index).padStart(3, '0')}`,
      kind: 'texture2D',
      format: 'rgba8'
    }));
    const manifestPath = writeJson(workspace, 'shaderpack.json', {
      sourceFormatVersion: 1,
      manifestVersion: 3,
      id: 'example:benchmark',
      name: 'Benchmark Pack',
      version: '3.1.0',
      fragments: ['manifest/pipeline.json'],
      settings: 'manifest/ui/settings.json',
      shaderRoot: 'shaders'
    });
    const fragmentPath = writeJson(workspace, 'manifest/pipeline.json', {
      options,
      resources,
      programs: [{ id: 'example:main', kind: 'graphics' }],
      passes: [{ id: 'example:main-pass', programs: ['example:main'], commands: [] }]
    });
    const settingsPath = writeJson(workspace, 'manifest/ui/settings.json', {
      schemaVersion: 1,
      pages: [{ id: 'main', controls: [{ id: 'control-0', option: '' }] }]
    });
    writeJson(workspace, 'shaders/main.glsl', { placeholder: true });

    const discovery = new WorkspacePackDiscovery([workspace]);
    const documents = new JsoncDocumentStore();
    const composition = new WorkspaceCompositionManager(documents);
    const symbols = new WorkspaceSymbolIndexManager();

    const initialStart = performance.now();
    let discoverySnapshot = discovery.refresh();
    let compositionResult = await composition.rebuild(discoverySnapshot);
    let symbolResult = await symbols.rebuild(compositionResult.snapshot, discoverySnapshot);
    const initialDiscoveryIndex = performance.now() - initialStart;

    const catalog = resolveCatalogSnapshot(path.join(root, 'catalogs'));
    const completion = new DawnlightCompletionService(documents, {
      discovery,
      composition,
      symbols,
      catalog: () => catalog
    });
    const settings = documents.getByPath(settingsPath);
    if (!settings) throw new Error('Benchmark settings document was not loaded.');
    const optionOffset = settings.text.indexOf('"option": ""') + '"option": "'.length;
    const optionPosition = settings.textDocument.positionAt(optionOffset);
    const warmCompletion = [];
    for (let index = 0; index < 60; index += 1) {
      const start = performance.now();
      completion.complete(settings.textDocument, optionPosition);
      warmCompletion.push(performance.now() - start);
    }

    const diagnosticService = new DawnlightFastDiagnosticService();
    const diagnosticStart = performance.now();
    diagnosticService.compute(discoverySnapshot, compositionResult.snapshot, symbolResult.snapshot, catalog);
    const fastDiagnostics = performance.now() - diagnosticStart;

    const analyzerPath = path.join(workspace, 'benchmark-analyzer.js');
    fs.writeFileSync(analyzerPath, `
let input = '';
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
}
function handle(message) {
  if (message.method === 'dawnlight/initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, serverSupportedVersions: [1], selectedVersion: 1, compatible: true } });
  } else if (message.method === 'dawnlight/validatePack') {
    send({ jsonrpc: '2.0', id: message.id, result: { valid: true, requestVersion: message.params.requestVersion, diagnostics: [] } });
  } else if (message.method === 'dawnlight/shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    setTimeout(() => process.exit(0), 5);
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  while (true) {
    const separator = input.indexOf('\\r\\n\\r\\n');
    if (separator < 0) return;
    const header = input.slice(0, separator);
    const lengthLine = header.split('\\r\\n').find(line => /^content-length:/i.test(line));
    if (!lengthLine) return;
    const length = Number(lengthLine.slice(lengthLine.indexOf(':') + 1).trim());
    const start = separator + 4;
    if (input.length - start < length) return;
    const body = input.slice(start, start + length);
    input = input.slice(start + length);
    handle(JSON.parse(body));
  }
});
`);
    const analyzer = new DawnlightAnalyzerClient({ analyzerPath, timeoutMs: 5000, restartLimit: 0 });
    const analyzerParams = {
      packRoot: workspace,
      catalogHash: catalog.hash,
      requestVersion: 1,
      overlays: []
    };
    await analyzer.validatePack(analyzerParams);
    const analyzerStart = performance.now();
    await analyzer.validatePack({ ...analyzerParams, requestVersion: 2 });
    const analyzerWarmResponse = performance.now() - analyzerStart;
    await analyzer.shutdown();

    const runtimeData = createRuntimeBenchmarkData(workspace);
    const fingerprintOperation = index => runtimeInputFingerprint(
      workspace,
      catalog.hash,
      index % 2 === 0 ? 'graph' : 'variant',
      index % 2 === 0 ? undefined : 'example:main',
      { options: { 'example:option-0': index % 3 }, capabilities: {} },
      runtimeData.project
    );
    fingerprintOperation(0);
    renderRuntimeGraph(runtimeData.graphResult, workspace);
    renderVariantExplanation(runtimeData.variantResult, workspace);
    const runtimeFingerprint = measure(80, fingerprintOperation);
    const runtimeGraphRender = measure(30,
      () => renderRuntimeGraph(runtimeData.graphResult, workspace));
    const runtimeVariantRender = measure(60,
      () => renderVariantExplanation(runtimeData.variantResult, workspace));
    const runtimeCache = new RuntimeSnapshotCache(64);
    const runtimeCacheUri = 'dawnlight-graph:/benchmark.md?key=benchmark';
    runtimeCache.set({
      uri: runtimeCacheUri,
      operation: 'graph',
      packRoot: workspace,
      fingerprint: 'f'.repeat(64),
      content: renderRuntimeGraph(runtimeData.graphResult, workspace),
      result: runtimeData.graphResult
    });
    const runtimeCacheWarm = measure(2000, () => {
      if (!runtimeCache.get(runtimeCacheUri)) throw new Error('Runtime cache lost its warm entry.');
    });

    const updatedFragment = {
      options: [...options, { id: 'example:option-096', type: 'boolean', default: true }],
      resources,
      programs: [{ id: 'example:main', kind: 'graphics' }],
      passes: [{ id: 'example:main-pass', programs: ['example:main'], commands: [] }]
    };
    const incrementalStart = performance.now();
    writeJson(workspace, 'manifest/pipeline.json', updatedFragment);
    documents.invalidate(fragmentPath);
    discoverySnapshot = discovery.handleFileEvents([fragmentPath]);
    compositionResult = await composition.rebuild(discoverySnapshot);
    symbolResult = await symbols.rebuild(compositionResult.snapshot, discoverySnapshot, [fragmentPath]);
    const incrementalFragmentRebuild = performance.now() - incrementalStart;

    const measurements = {
      initialDiscoveryIndex,
      incrementalFragmentRebuild,
      warmCompletionP50: percentile(warmCompletion, 0.50),
      warmCompletionP95: percentile(warmCompletion, 0.95),
      fastDiagnostics,
      analyzerWarmResponse,
      runtimeFingerprintP95: percentile(runtimeFingerprint, 0.95),
      runtimeGraphRenderP95: percentile(runtimeGraphRender, 0.95),
      runtimeVariantRenderP95: percentile(runtimeVariantRender, 0.95),
      runtimeCacheWarmP95: percentile(runtimeCacheWarm, 0.95)
    };
    console.log('Dawnlight V3-1 benchmark (temporary synthetic pack)');
    console.log(`initial discovery/index: ${measurements.initialDiscoveryIndex.toFixed(1)} ms`);
    console.log(`incremental fragment rebuild: ${measurements.incrementalFragmentRebuild.toFixed(1)} ms`);
    console.log(`warm completion p50/p95: ${measurements.warmCompletionP50.toFixed(1)} / ${measurements.warmCompletionP95.toFixed(1)} ms`);
    console.log(`fast diagnostics: ${measurements.fastDiagnostics.toFixed(1)} ms`);
    console.log(`Analyzer warm response: ${measurements.analyzerWarmResponse.toFixed(1)} ms`);
    console.log(`runtime input fingerprint p95: ${measurements.runtimeFingerprintP95.toFixed(1)} ms`);
    console.log(`runtime graph Markdown render p95: ${measurements.runtimeGraphRenderP95.toFixed(1)} ms`);
    console.log(`runtime variant Markdown render p95: ${measurements.runtimeVariantRenderP95.toFixed(1)} ms`);
    console.log(`runtime snapshot cache warm get p95: ${measurements.runtimeCacheWarmP95.toFixed(3)} ms`);

    const checks = [
      ['initialDiscoveryIndex', measurements.initialDiscoveryIndex, thresholds.initialDiscoveryIndex],
      ['incrementalFragmentRebuild', measurements.incrementalFragmentRebuild, thresholds.incrementalFragmentRebuild],
      ['warmCompletionP95', measurements.warmCompletionP95, thresholds.warmCompletionP95],
      ['fastDiagnostics', measurements.fastDiagnostics, thresholds.fastDiagnostics],
      ['analyzerWarmResponse', measurements.analyzerWarmResponse, thresholds.analyzerWarmResponse],
      ['runtimeFingerprintP95', measurements.runtimeFingerprintP95, thresholds.runtimeFingerprintP95],
      ['runtimeGraphRenderP95', measurements.runtimeGraphRenderP95, thresholds.runtimeGraphRenderP95],
      ['runtimeVariantRenderP95', measurements.runtimeVariantRenderP95, thresholds.runtimeVariantRenderP95],
      ['runtimeCacheWarmP95', measurements.runtimeCacheWarmP95, thresholds.runtimeCacheWarmP95]
    ];
    const failures = checks.filter(([, actual, limit]) => actual > limit);
    if (failures.length > 0) {
      console.warn(`Benchmark thresholds exceeded: ${failures.map(([name, actual, limit]) => `${name}=${actual.toFixed(1)}ms>${limit}ms`).join(', ')}`);
      if (process.env.DAWNLIGHT_BENCHMARK_STRICT === '1') process.exitCode = 1;
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
