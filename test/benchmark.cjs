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

const root = path.resolve(__dirname, '..');
const thresholds = {
  initialDiscoveryIndex: 1000,
  incrementalFragmentRebuild: 300,
  warmCompletionP95: 50,
  fastDiagnostics: 250,
  analyzerWarmResponse: 2000
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
      analyzerWarmResponse
    };
    console.log('Dawnlight V2 benchmark (temporary synthetic pack)');
    console.log(`initial discovery/index: ${measurements.initialDiscoveryIndex.toFixed(1)} ms`);
    console.log(`incremental fragment rebuild: ${measurements.incrementalFragmentRebuild.toFixed(1)} ms`);
    console.log(`warm completion p50/p95: ${measurements.warmCompletionP50.toFixed(1)} / ${measurements.warmCompletionP95.toFixed(1)} ms`);
    console.log(`fast diagnostics: ${measurements.fastDiagnostics.toFixed(1)} ms`);
    console.log(`Analyzer warm response: ${measurements.analyzerWarmResponse.toFixed(1)} ms`);

    const checks = [
      ['initialDiscoveryIndex', measurements.initialDiscoveryIndex, thresholds.initialDiscoveryIndex],
      ['incrementalFragmentRebuild', measurements.incrementalFragmentRebuild, thresholds.incrementalFragmentRebuild],
      ['warmCompletionP95', measurements.warmCompletionP95, thresholds.warmCompletionP95],
      ['fastDiagnostics', measurements.fastDiagnostics, thresholds.fastDiagnostics],
      ['analyzerWarmResponse', measurements.analyzerWarmResponse, thresholds.analyzerWarmResponse]
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
