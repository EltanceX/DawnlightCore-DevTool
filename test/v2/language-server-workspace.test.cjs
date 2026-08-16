const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { CONTRACT_VERSIONS, LSP_METHODS } = require('../../packages/contracts/dist');
const { LspTestHarness } = require('../../packages/test-utils/dist');

const root = path.resolve(__dirname, '..', '..');
const serverPath = path.join(root, 'dist', 'server.js');
const fixtureRoot = path.join(root, 'fixtures', 'workspace', 'arbitrary-fragment-path');

function completionLabels(result) {
  return new Set((result?.items || []).map(item => {
    try {
      return JSON.parse(item.label);
    } catch {
      return item.label;
    }
  }));
}

async function waitForComposition(harness, predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = await harness.sendRequest(LSP_METHODS.compositionSnapshot);
    if (predicate(snapshot)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return harness.sendRequest(LSP_METHODS.compositionSnapshot);
}

test('language server discovers a workspace and associates arbitrary schema paths', async t => {
  const { harness } = await LspTestHarness.start(serverPath, {
    clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
  }, { workspaceFolders: [fixtureRoot] });
  t.after(async () => {
    if (!harness.hasExited()) await harness.shutdown();
  });

  const snapshot = await harness.sendRequest(LSP_METHODS.workspaceSnapshot);
  assert.equal(snapshot.packs.length, 1);
  assert.equal(snapshot.packs[0].id, 'example:arbitrary_paths');
  assert.deepEqual(snapshot.packs[0].fragments.map(item => item.path), ['config/pipeline.json']);
  assert.equal(snapshot.packs[0].settings.path, 'authoring/settings-ui.json');

  const initialComposition = await waitForComposition(harness, value =>
    value.generation > 0 && value.projects.length === 1);
  assert.equal(initialComposition.projects[0].documents.length, 3);

  const fragmentPath = path.join(fixtureRoot, 'config', 'pipeline.json');
  const fragmentUri = pathToFileURL(fragmentPath).toString();
  harness.sendNotification('textDocument/didOpen', {
    textDocument: {
      uri: fragmentUri,
      languageId: 'jsonc',
      version: 1,
      text: '{\n  \n}\n'
    }
  });
  const fragmentCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: fragmentUri },
    position: { line: 1, character: 2 }
  });
  const fragmentLabels = completionLabels(fragmentCompletion);
  assert.ok(fragmentLabels.has('options'), [...fragmentLabels].join(', '));
  assert.ok(fragmentLabels.has('resources'), [...fragmentLabels].join(', '));

  harness.sendNotification('textDocument/didChange', {
    textDocument: { uri: fragmentUri, version: 2 },
    contentChanges: [{
      text: '// unsaved\n{\n  "options": [{"id": "example:unsaved"}],\n}\n'
    }]
  });
  const overlayComposition = await waitForComposition(harness, value =>
    value.projects[0]?.definitions.options.some(item => item.id === 'example:unsaved'));
  assert.equal(overlayComposition.projects[0].documents.find(document =>
    document.uri === fragmentUri).version, 2);

  const settingsPath = path.join(fixtureRoot, 'authoring', 'settings-ui.json');
  const settingsUri = pathToFileURL(settingsPath).toString();
  harness.sendNotification('textDocument/didOpen', {
    textDocument: {
      uri: settingsUri,
      languageId: 'json',
      version: 1,
      text: '{\n  \n}\n'
    }
  });
  const settingsCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: settingsUri },
    position: { line: 1, character: 2 }
  });
  const settingsLabels = completionLabels(settingsCompletion);
  assert.ok(settingsLabels.has('schemaVersion'), [...settingsLabels].join(', '));
  assert.ok(settingsLabels.has('pages'), [...settingsLabels].join(', '));

  const ordinaryPath = path.join(fixtureRoot, 'untracked', 'ordinary.json');
  const ordinaryUri = pathToFileURL(ordinaryPath).toString();
  harness.sendNotification('textDocument/didOpen', {
    textDocument: {
      uri: ordinaryUri,
      languageId: 'json',
      version: 1,
      text: fs.readFileSync(ordinaryPath, 'utf8')
    }
  });
  const ordinaryCompletion = await harness.sendRequest('textDocument/completion', {
    textDocument: { uri: ordinaryUri },
    position: { line: 1, character: 2 }
  });
  assert.equal(ordinaryCompletion, null);

  const firstGeneration = snapshot.generation;
  harness.sendNotification('workspace/didChangeWatchedFiles', {
    changes: [{ uri: fragmentUri, type: 2 }]
  });
  const refreshed = await harness.sendRequest(LSP_METHODS.workspaceSnapshot);
  assert.equal(refreshed.generation, firstGeneration + 1);

  harness.sendNotification('workspace/didChangeWorkspaceFolders', {
    event: {
      added: [],
      removed: [{ uri: pathToFileURL(fixtureRoot).toString(), name: 'workspace-1' }]
    }
  });
  const withoutWorkspace = await harness.sendRequest(LSP_METHODS.workspaceSnapshot);
  assert.equal(withoutWorkspace.packs.length, 0);
  assert.equal(withoutWorkspace.generation, refreshed.generation + 1);

  await harness.shutdown();
});
