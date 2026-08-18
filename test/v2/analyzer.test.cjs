const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { CONTRACT_VERSIONS, LSP_METHODS } = require('../../packages/contracts/dist');
const { DawnlightAnalyzerClient } = require('../../packages/language-server/dist/analyzerClient');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const root = path.resolve(__dirname, '..', '..');
const serverPath = path.join(root, 'dist', 'server.js');

function createFakeAnalyzer(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-analyzer-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, 'fake-analyzer.js');
  const mode = options.mode || 'normal';
  const script = String.raw`
let input = '';
const mode = ${JSON.stringify(mode)};
const catalog = ${JSON.stringify(options.catalog || null)};
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body);
}
function handle(message) {
  if (message.method === 'dawnlight/initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: 1, serverSupportedVersions: [1], selectedVersion: 1, compatible: true,
      analyzerVersion: 'fake'
    }});
    return;
  }
  if (message.method === 'dawnlight/getCatalog') {
    if (mode === 'unknown') {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    if (!catalog) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'dawnlight/getCatalog is not implemented' } });
      return;
    }
    const params = message.params || {};
    send({ jsonrpc: '2.0', id: message.id, result: {
      snapshot: catalog,
      catalogHash: catalog.hash,
      serverSupportedVersions: [1],
      selectedVersion: params.clientSupportedVersions && params.clientSupportedVersions.includes(1) ? 1 : undefined,
      compatible: Boolean(params.clientSupportedVersions && params.clientSupportedVersions.includes(1)),
      analyzerVersion: 'fake-catalog'
    }});
    return;
  }
  if (message.method === 'dawnlight/validatePack') {
    if (mode === 'crash') { process.exit(17); return; }
    const params = message.params || {};
    const delay = mode === 'slow' ? 250 : 5;
    setTimeout(() => send({ jsonrpc: '2.0', id: message.id, result: {
      valid: false,
      requestVersion: params.requestVersion,
      diagnostics: [{
        severity: 'error',
        code: 'DLMAN1' + String(params.requestVersion).padStart(3, '0'),
        file: 'fragment.json',
        pointer: '/passes/0/stage/template',
        message: '权威 Analyzer request ' + params.requestVersion + ' overlays=' + (params.overlays || []).length,
        related: [{ file: 'fragment.json', pointer: '/passes/0', message: 'Related Analyzer context' }]
      }]
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
    const lengthLine = header.split('\r\n').find(line => /^content-length:/i.test(line));
    const length = Number(lengthLine.slice(lengthLine.indexOf(':') + 1).trim());
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-analyzer-workspace-'));
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

function open(harness, file, languageId = 'jsonc') {
  harness.sendNotification('textDocument/didOpen', {
    textDocument: { uri: file.uri, languageId, version: 1, text: file.text }
  });
}

async function waitForDiagnostics(notifications, uri, predicate) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const params = [...notifications].reverse().find(item => item.uri === uri);
    if (params && predicate(params.diagnostics || [])) return params.diagnostics || [];
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return [...notifications].reverse().find(item => item.uri === uri)?.diagnostics || [];
}

test('Analyzer client negotiates stdio framing and degrades after timeout', async t => {
  const analyzerPath = createFakeAnalyzer(t, { mode: 'normal' });
  const client = new DawnlightAnalyzerClient({ analyzerPath, timeoutMs: 1000, restartLimit: 1 });
  const result = await client.validatePack({
    packRoot: 'C:/packs/example', catalogHash: 'hash', requestVersion: 4,
    overlays: [{ path: 'fragment.json', version: 2, content: '{ }' }]
  });
  assert.equal(result.requestVersion, 4);
  assert.equal(result.diagnostics[0].code, 'DLMAN1004');
  assert.equal(client.status.state, 'ready');
  await client.shutdown();

  const slowPath = createFakeAnalyzer(t, { mode: 'slow' });
  const timedOut = new DawnlightAnalyzerClient({ slowPath, analyzerPath: slowPath, timeoutMs: 40, restartLimit: 0 });
  const offline = await timedOut.validatePack({
    packRoot: 'C:/packs/example', catalogHash: 'hash', requestVersion: 1, overlays: []
  });
  assert.equal(offline, undefined);
  assert.equal(timedOut.status.state, 'offline');
  await timedOut.shutdown();
});

test('Analyzer getCatalog validates contract/hash and tolerates older sidecars', async t => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json'), 'utf8'));
  const analyzerPath = createFakeAnalyzer(t, { catalog });
  const client = new DawnlightAnalyzerClient({
    analyzerPath,
    catalogHash: catalog.hash,
    timeoutMs: 1000,
    restartLimit: 0
  });
  const result = await client.getCatalog({
    clientSupportedVersions: [1],
    expectedCatalogHash: catalog.hash
  });
  assert.ok(result);
  assert.equal(result.snapshot.contractVersion, 1);
  assert.equal(result.catalogHash, catalog.hash);
  assert.equal(result.selectedVersion, 1);
  assert.equal(result.compatible, true);
  assert.equal(client.status.state, 'ready');

  const mismatch = await client.getCatalog({ expectedCatalogHash: '0'.repeat(64) });
  assert.equal(mismatch, undefined);
  assert.equal(client.status.state, 'ready');
  await client.shutdown();

  const oldAnalyzerPath = createFakeAnalyzer(t, { mode: 'unknown' });
  const oldClient = new DawnlightAnalyzerClient({ analyzerPath: oldAnalyzerPath, timeoutMs: 1000, restartLimit: 0 });
  assert.equal(await oldClient.getCatalog(), undefined);
  assert.equal(oldClient.status.state, 'ready');
  await oldClient.shutdown();
});

test('save triggers authoritative diagnostics with overlays and drops stale responses', async t => {
  const analyzerPath = createFakeAnalyzer(t, { mode: 'slow' });
  const { workspace, write } = createWorkspace(t);
  const rootFile = write('shaderpack.json', {
    sourceFormatVersion: 1, manifestVersion: 3, id: 'example:analyzer',
    name: 'Analyzer', version: '0.1.0', fragments: ['fragment.json']
  });
  const fragment = write('fragment.json', {
    passes: [{
      id: 'example:pass',
      stage: { template: 'dawnlight:fullscreen', version: 1, target: 'world', phase: 'post' },
      programs: [], commands: []
    }]
  });
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
    catalogSnapshotVersions: [CONTRACT_VERSIONS.catalogSnapshot],
    analyzerPath,
    analyzerTimeoutMs: 2000,
    analyzerRestartLimit: 1,
    validationOnSave: true
  }, { workspaceFolders: [workspace] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });
  const notifications = [];
  harness.onNotification('textDocument/publishDiagnostics', params => notifications.push(params));
  open(harness, rootFile, 'json');
  open(harness, fragment);

  harness.sendNotification('textDocument/didSave', { textDocument: { uri: fragment.uri } });
  await new Promise(resolve => setTimeout(resolve, 30));
  const changed = fragment.text.replace('dawnlight:fullscreen', 'dawnlight:command_list');
  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragment.uri, version: 2 },
    contentChanges: [{ text: changed }]
  });
  harness.sendNotification('textDocument/didSave', { textDocument: { uri: fragment.uri } });

  const diagnostics = await waitForDiagnostics(notifications, fragment.uri, items =>
    items.some(item => item.source === 'dawnlight-analyzer' && item.code === 'DLMAN1002'));
  const analyzerItems = diagnostics.filter(item => item.source === 'dawnlight-analyzer');
  assert.equal(analyzerItems.length, 1);
  assert.equal(analyzerItems[0].code, 'DLMAN1002');
  assert.match(analyzerItems[0].message, /overlays=2/);
  assert.ok(analyzerItems[0].range.end.character > analyzerItems[0].range.start.character);
  assert.equal(analyzerItems[0].relatedInformation.length, 1);
  assert.equal(analyzerItems[0].relatedInformation[0].message, 'Related Analyzer context');
  assert.equal(analyzerItems.some(item => item.code === 'DLMAN1001'), false);

  const status = await harness.sendRequest(LSP_METHODS.analyzerStatus);
  assert.equal(status.state, 'ready');
  const explicit = await harness.sendRequest(LSP_METHODS.validatePack, { packRoot: workspace });
  assert.equal(explicit.accepted, true);
  await waitForDiagnostics(notifications, fragment.uri, items =>
    items.some(item => item.code === 'DLMAN1003'));
});

test('Analyzer crash remains non-fatal and leaves fast diagnostics available', async t => {
  const analyzerPath = createFakeAnalyzer(t, { mode: 'crash' });
  const client = new DawnlightAnalyzerClient({ analyzerPath, timeoutMs: 500, restartLimit: 0 });
  const result = await client.validatePack({
    packRoot: 'C:/packs/example', catalogHash: 'hash', requestVersion: 1, overlays: []
  });
  assert.equal(result, undefined);
  assert.equal(client.status.state, 'offline');
  await client.shutdown();
});
