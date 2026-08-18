const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  CONTRACT_VERSIONS,
  LSP_METHODS,
  computeRuntimeGraphHash
} = require('../../packages/contracts/dist');
const {
  DawnlightAnalyzerClient,
  DawnlightAnalyzerRequestCancelledError
} = require('../../packages/language-server/dist/analyzerClient');
const { RuntimeSnapshotCache } = require('../../packages/language-server/dist/runtimeAnalysis');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const root = path.resolve(__dirname, '..', '..');
const serverPath = path.join(root, 'dist', 'server.js');

function createGraph() {
  const payload = {
    contractVersion: 1,
    variantFingerprint: 'a'.repeat(64),
    nodes: [
      { id: 'pass:main', kind: 'pass', label: 'Main pass', active: true, order: 0,
        provenance: [{ kind: 'fragment', file: 'fragment.json', pointer: '/passes/0' }] },
      { id: 'program:main', kind: 'program', label: 'Main program', active: true, order: 1,
        declaredId: 'example:main' },
      { id: 'resource:color', kind: 'resource', label: 'Color', active: true, order: 2 }
    ],
    edges: [
      { id: 'edge:pass-program', kind: 'invokes', from: 'pass:main', to: 'program:main' },
      { id: 'edge:program-resource', kind: 'writes', from: 'program:main', to: 'resource:color' }
    ],
    executionOrder: ['pass:main', 'program:main', 'resource:color'],
    events: [{ id: 'event:write', kind: 'write', nodeId: 'program:main', order: 0, resourceId: 'resource:color' }],
    resources: [{ id: 'resource:color', nodeId: 'resource:color', kind: 'texture',
      lifetime: { firstOrder: 0, lastOrder: 0, persistent: false, history: false } }],
    bindings: [],
    drawBuffers: [],
    hazards: [{ severity: 'warning', code: 'DLGRAPH0001', message: 'Color write is ordered after the pass.',
      nodeIds: ['pass:main', 'program:main'], provenance: { kind: 'fragment', file: 'fragment.json', pointer: '/passes/0' } }]
  };
  return { ...payload, graphHash: computeRuntimeGraphHash(payload) };
}

function createExplanation(programId = 'example:main') {
  return {
    contractVersion: 1,
    programId,
    kind: 'graphics',
    active: true,
    compileMode: 'legacyCustom',
    variantFingerprint: 'b'.repeat(64),
    sourceFiles: [
      { stage: 'vertex', file: 'main.vsh', provenance: { kind: 'shader', file: 'main.vsh' } },
      { stage: 'fragment', file: 'main.psh', provenance: { kind: 'shader', file: 'main.psh' } }
    ],
    inputs: {
      options: [{ id: 'example:enabled', value: true, source: 'request', provenance: { kind: 'fragment', file: 'fragment.json', pointer: '/programs/0' } }],
      capabilities: []
    },
    defines: [{ name: 'EXAMPLE_ENABLED', defined: true, value: '1',
      source: { kind: 'option', id: 'example:enabled', inputValue: true, mapped: true } }],
    includes: [],
    graphNodeIds: ['program:main']
  };
}

function createFakeAnalyzer(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-runtime-analyzer-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'fake-analyzer.js');
  const script = String.raw`
let input = '';
const catalog = ${JSON.stringify(options.catalog)};
const graph = ${JSON.stringify(options.graph)};
const explanation = ${JSON.stringify(options.explanation)};
const variantDiagnostics = ${JSON.stringify(options.variantDiagnostics || [])};
const delay = ${Number(options.delay || 0)};
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body);
}
function handle(message) {
  if (message.method === 'dawnlight/initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: 1, serverSupportedVersions: [1], selectedVersion: 1, compatible: true,
      analyzerVersion: 'fake-runtime'
    }});
    return;
  }
  if (message.method === 'dawnlight/getCatalog') {
    const params = message.params || {};
    const compatible = !params.clientSupportedVersions || params.clientSupportedVersions.includes(1);
    send({ jsonrpc: '2.0', id: message.id, result: {
      snapshot: catalog, catalogHash: catalog.hash, serverSupportedVersions: [1],
      selectedVersion: compatible ? 1 : undefined, compatible, analyzerVersion: 'fake-runtime'
    }});
    return;
  }
  if (message.method === '$/cancelRequest') return;
  if (message.method === 'dawnlight/dumpGraph') {
    const params = message.params || {};
    setTimeout(() => send({ jsonrpc: '2.0', id: message.id, result: {
      requestVersion: params.requestVersion, catalogHash: params.catalogHash,
      manifestHash: 'c'.repeat(64), compatible: true, success: true,
      serverSupportedVersions: [1], selectedVersion: 1,
      diagnostics: [], graph
    }}), delay);
    return;
  }
  if (message.method === 'dawnlight/explainVariant') {
    const params = message.params || {};
    setTimeout(() => send({ jsonrpc: '2.0', id: message.id, result: {
      requestVersion: params.requestVersion, catalogHash: params.catalogHash,
      manifestHash: 'c'.repeat(64), compatible: true, success: true,
      serverSupportedVersions: [1], selectedVersion: 1,
      diagnostics: variantDiagnostics, explanation: { ...explanation, programId: params.programId }
    }}), delay);
    return;
  }
  if (message.method === 'dawnlight/shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    setTimeout(() => process.exit(0), 5);
  }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  while (true) {
    const separator = input.indexOf('\r\n\r\n');
    if (separator < 0) return;
    const header = input.slice(0, separator);
    const line = header.split('\r\n').find(item => /^content-length:/i.test(item));
    const length = Number(line.slice(line.indexOf(':') + 1).trim());
    const start = separator + 4;
    if (input.length - start < length) return;
    const body = input.slice(start, start + length);
    input = input.slice(start + length);
    handle(JSON.parse(body));
  }
});
`;
  fs.writeFileSync(scriptPath, script);
  return scriptPath;
}

function createWorkspace(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-runtime-workspace-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const write = (relativePath, value) => {
    const target = path.join(workspace, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(target, text);
    return { path: target, uri: pathToFileURL(target).toString(), text };
  };
  return { workspace, write };
}

function open(harness, file, version = 1) {
  harness.sendNotification('textDocument/didOpen', {
    textDocument: { uri: file.uri, languageId: 'jsonc', version, text: file.text }
  });
}

test('runtime snapshot cache is bounded and uses least-recently-used eviction', () => {
  const cache = new RuntimeSnapshotCache(2);
  const entry = uri => ({
    uri, operation: 'graph', packRoot: 'C:/packs/example', fingerprint: uri,
    content: uri, result: {}
  });
  cache.set(entry('dawnlight-graph:/one'));
  cache.set(entry('dawnlight-graph:/two'));
  assert.ok(cache.get('dawnlight-graph:/one'));
  cache.set(entry('dawnlight-graph:/three'));
  assert.equal(cache.has('dawnlight-graph:/two'), false);
  assert.equal(cache.has('dawnlight-graph:/one'), true);
  assert.equal(cache.size, 2);
});

function positionFor(text, value) {
  const offset = text.indexOf(`"${value}"`);
  assert.notEqual(offset, -1);
  const before = text.slice(0, offset + 1).split('\n');
  return { line: before.length - 1, character: before.at(-1).length };
}

test('Analyzer client negotiates and validates graph/variant snapshots, including cancellation', async t => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json'), 'utf8'));
  const analyzerPath = createFakeAnalyzer(t, {
    catalog,
    graph: createGraph(),
    explanation: createExplanation(),
    variantDiagnostics: [{
      severity: 'warning', code: 'DLGRAPH0099', message: 'Variant uses a fallback define.',
      provenance: { kind: 'fragment', file: 'fragment.json', pointer: '/programs/0' }
    }]
  });
  const client = new DawnlightAnalyzerClient({ analyzerPath, catalogHash: catalog.hash, timeoutMs: 1000, restartLimit: 0 });
  const base = {
    packRoot: 'C:/packs/example', catalogHash: catalog.hash, requestVersion: 1, overlays: [],
    clientSupportedVersions: [1], inputs: { options: {}, capabilities: {} }, includeInactive: true
  };
  const graph = await client.dumpGraph(base);
  assert.equal(graph.graph.graphHash, createGraph().graphHash);
  const explanation = await client.explainVariant({ ...base, programId: 'example:main' });
  assert.equal(explanation.explanation.programId, 'example:main');
  const controller = new AbortController();
  const cancelled = client.dumpGraph({ ...base, requestVersion: 2 }, controller.signal);
  controller.abort();
  assert.equal(await cancelled, undefined);
  assert.equal(client.status.state, 'ready');
  await client.shutdown();
  assert.ok(DawnlightAnalyzerRequestCancelledError);
});

test('Language Server exposes immutable graph/variant documents and isolated graph diagnostics', async t => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json'), 'utf8'));
  const analyzerPath = createFakeAnalyzer(t, {
    catalog,
    graph: createGraph(),
    explanation: createExplanation(),
    variantDiagnostics: [{
      severity: 'warning', code: 'DLGRAPH0099', message: 'Variant uses a fallback define.',
      provenance: { kind: 'fragment', file: 'fragment.json', pointer: '/programs/0' }
    }]
  });
  const { workspace, write } = createWorkspace(t);
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:runtime', name: 'Runtime', version: '1',
    fragments: ['fragment.json']
  });
  const fragment = write('fragment.json', {
    options: [{ id: 'example:enabled', type: 'boolean', default: true }],
    programs: [
      { id: 'example:main', kind: 'graphics', vertex: 'main.vsh', fragment: 'main.psh' },
      { id: 'example:other', kind: 'graphics', vertex: 'main.vsh', fragment: 'main.psh' }
    ],
    passes: [{ id: 'example:pass', stage: { template: 'dawnlight:fullscreen', version: 1, target: 'world', phase: 'post' }, programs: ['example:main'], commands: [] }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [CONTRACT_VERSIONS.catalogSnapshot], analyzerPath,
    analyzerTimeoutMs: 1000, analyzerRestartLimit: 0, validationOnSave: false
  }, { workspaceFolders: [workspace] });
  t.after(async () => { if (!harness.hasExited()) await harness.shutdown(); });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile);
  open(harness, fragment);

  const graphView = await harness.sendRequest(LSP_METHODS.dumpGraph, { documentUri: rootFile.uri });
  assert.match(graphView.documentUri, /^dawnlight-graph:/);
  const graphText = await harness.sendRequest(LSP_METHODS.graphDocument, { uri: graphView.documentUri });
  assert.match(graphText, /# Dawnlight Runtime Graph/);
  assert.match(graphText, /digraph dawnlight_runtime/);
  const graphDiagnostics = notifications.flatMap(item => item.diagnostics || [])
    .filter(item => item.source === 'dawnlight-analyzer-graph');
  assert.ok(graphDiagnostics.length > 0);
  const programPosition = positionFor(fragment.text, 'example:main');
  const definitions = await harness.sendRequest('textDocument/definition', {
    textDocument: { uri: fragment.uri }, position: programPosition
  });
  assert.ok(definitions.some(location => location.uri.startsWith('dawnlight-graph:')));
  const hover = await harness.sendRequest('textDocument/hover', {
    textDocument: { uri: fragment.uri }, position: programPosition
  });
  assert.match(JSON.stringify(hover), /Runtime graph node/);
  const activeOnlyGraph = await harness.sendRequest(LSP_METHODS.dumpGraph, {
    documentUri: rootFile.uri, includeInactive: false
  });
  assert.notEqual(activeOnlyGraph.documentUri, graphView.documentUri);
  const restoredDefaultGraph = await harness.sendRequest(LSP_METHODS.dumpGraph, {
    documentUri: rootFile.uri
  });
  assert.equal(restoredDefaultGraph.documentUri, graphView.documentUri);

  const candidates = await harness.sendRequest(LSP_METHODS.explainVariant, { documentUri: rootFile.uri });
  assert.equal(candidates.documentUri, undefined);
  assert.equal(candidates.candidates.length, 2);
  const variantView = await harness.sendRequest(LSP_METHODS.explainVariant, {
    documentUri: rootFile.uri, programId: 'example:main'
  });
  assert.match(variantView.documentUri, /^dawnlight-variant:/);
  const variantText = await harness.sendRequest(LSP_METHODS.variantDocument, { uri: variantView.documentUri });
  assert.match(variantText, /# Dawnlight Program Variant/);
  assert.match(variantText, /EXAMPLE_ENABLED/);
  assert.match(variantText, /DLGRAPH0099/);
  const latestFragmentDiagnostics = notifications.filter(item => item.uri === fragment.uri).at(-1)?.diagnostics ?? [];
  assert.ok(latestFragmentDiagnostics.some(item => item.code === 'DLGRAPH0001'));
  assert.ok(!latestFragmentDiagnostics.some(item => item.code === 'DLGRAPH0099'));

  const changed = fragment.text.replace('example:other', 'example:changed');
  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragment.uri, version: 2 }, contentChanges: [{ text: changed }]
  });
  const refreshed = await harness.sendRequest(LSP_METHODS.dumpGraph, { documentUri: rootFile.uri });
  assert.notEqual(refreshed.documentUri, graphView.documentUri);
  assert.equal(await harness.sendRequest(LSP_METHODS.graphDocument, { uri: graphView.documentUri }), null);
});
