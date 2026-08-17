const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { CONTRACT_VERSIONS, SERVER_CAPABILITIES } = require('../../packages/contracts/dist');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const serverPath = path.resolve(__dirname, '..', '..', 'dist', 'server.js');

test('language server initializes without a workspace and shuts down cleanly', async t => {
  const { harness, result } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });

  assert.deepEqual(result.capabilities.textDocumentSync, {
    openClose: true,
    change: 2,
    save: { includeText: false }
  }, 'Expected incremental document sync with save notifications.');
  assert.deepEqual(result.capabilities.experimental?.dawnlight, SERVER_CAPABILITIES);
  assert.deepEqual(result.serverInfo, {
    name: 'Dawnlight Shader Pack Language Server',
    version: '0.2.0'
  });

  await harness.shutdown();
  assert.equal(harness.hasExited(), true);
});
