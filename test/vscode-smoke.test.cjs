const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

function fixtureUri(relativePath) {
  assert.ok(workspaceRoot, 'VS Code smoke test did not open a workspace.');
  return vscode.Uri.file(path.join(workspaceRoot, relativePath));
}

async function openFixture(relativePath) {
  return vscode.workspace.openTextDocument(fixtureUri(relativePath));
}

function errorsFor(uri) {
  return vscode.languages.getDiagnostics(uri)
    .filter(item => item.severity === vscode.DiagnosticSeverity.Error);
}

suite('Dawnlight declarative schema smoke test', () => {
  test('extension activates its language client and exposes contract versions', async () => {
    const extension = vscode.extensions.getExtension(
      'dawnlight-dev.dawnlight-shader-pack-tools'
    );
    assert.ok(extension, 'Dawnlight extension is not installed.');
    const api = await extension.activate();
    assert.deepEqual(api.getServerStatus(), {
      running: true,
      languageServerProtocolVersion: 1,
      schemaContractVersion: 1
    });
  });

  test('valid root fixture has no schema errors', async () => {
    const document = await openFixture('fixtures/valid/minimal/shaderpack.json');
    assert.equal(errorsFor(document.uri).length, 0,
      errorsFor(document.uri).map(item => item.message).join('; '));
  });

  test('pack snapshots and all supported fragment roles have no schema errors', async () => {
    const relativePaths = [
      'fixtures/valid/toonlab/shaderpack.json',
      'fixtures/valid/dawnlight-v3.1/shaderpack.json',
      'fixtures/valid/dawnlight-v3.1/manifest/options/clouds.json',
      'fixtures/valid/dawnlight-v3.1/manifest/resources/cubemap.json',
      'fixtures/valid/dawnlight-v3.1/manifest/programs/atmosphere-effects.json',
      'fixtures/valid/dawnlight-v3.1/manifest/passes/atmosphere-shaft.json',
      'fixtures/valid/dawnlight-v3.1/manifest/ui/settings.json',
      'fixtures/valid/minimal/manifest/options/basic.json',
      'fixtures/valid/minimal/manifest/resources/main.json',
      'fixtures/valid/minimal/manifest/programs/main.json',
      'fixtures/valid/minimal/manifest/passes/main.json',
      'fixtures/valid/minimal/manifest/ui/settings.json'
    ];
    for (const relativePath of relativePaths) {
      const document = await openFixture(relativePath);
      assert.equal(errorsFor(document.uri).length, 0,
        `${relativePath}: ${errorsFor(document.uri).map(item => item.message).join('; ')}`);
    }
  });

  test('invalid root fixture produces a schema diagnostic', async () => {
    const document = await openFixture('fixtures/invalid/wrong-type/shaderpack.json');
    assert.ok(errorsFor(document.uri).length > 0,
      'Expected at least one schema error for the wrong-type fixture.');
  });

  test('missing required root property produces a schema diagnostic', async () => {
    const document = await openFixture('fixtures/invalid/missing-required/shaderpack.json');
    assert.ok(errorsFor(document.uri).length > 0,
      'Expected at least one schema error for the missing-required fixture.');
  });

  test('Hover exposes schema descriptions', async () => {
    const document = await openFixture('fixtures/valid/minimal/shaderpack.json');
    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(2, 5)
    );
    const contents = (hovers || []).flatMap(hover => hover.contents || [])
      .map(content => typeof content === 'string' ? content : content.value || '')
      .join('\n');
    assert.match(contents, /Manifest format version/i);
  });

  test('root completion exposes Manifest fields', async () => {
    const uri = fixtureUri('fixtures/completion/shaderpack.json');
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit(edit => edit.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      '{\n  \n}\n'
    ));
    const items = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      uri,
      new vscode.Position(1, 2)
    );
    const labels = new Set((items?.items || []).map(item =>
      typeof item.label === 'string' ? item.label : item.label.label));
    assert.ok(labels.has('manifestVersion'), [...labels].join(', '));
    assert.ok(labels.has('fragments'), [...labels].join(', '));
  });

  test('packaged Schema exposes resource formats and every command type', async () => {
    const cases = [
      {
        relativePath: 'fixtures/completion/manifest/resources/main.json',
        source: '{\n  "resources": [{\n    "id": "example:resource",\n    "kind": "texture2D",\n    "lifetime": "persistent",\n    "size": {"mode": "viewport"},\n    "format": ""\n  }]\n}\n',
        position: new vscode.Position(6, 15),
        expected: ['rgba8', 'rgba16f', 'depth24']
      },
      {
        relativePath: 'fixtures/completion/manifest/passes/main.json',
        source: '{\n  "passes": [{\n    "id": "example:pass",\n    "programs": [],\n    "commands": [{"type": ""}]\n  }]\n}\n',
        position: new vscode.Position(4, 27),
        expected: ['fullscreen', 'compute', 'copy', 'clear', 'present', 'engineDraw', 'historyCommit']
      }
    ];
    for (const item of cases) {
      const uri = fixtureUri(item.relativePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit(edit => edit.replace(
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        item.source
      ));
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider', uri, item.position);
      const labels = new Set((completions?.items || []).map(completion => {
        const label = typeof completion.label === 'string' ? completion.label : completion.label.label;
        try {
          return JSON.parse(label);
        } catch {
          return label;
        }
      }));
      for (const expected of item.expected) {
        assert.ok(labels.has(expected), `${expected} missing from ${[...labels].join(', ')}`);
      }
    }
  });

  test('ordinary JSON is not assigned the Dawnlight root schema', async () => {
    const uri = fixtureUri('fixtures/acceptance/plain.json');
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit(edit => edit.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      '{\n  \n}\n'
    ));
    const items = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      uri,
      new vscode.Position(1, 2)
    );
    const labels = new Set((items?.items || []).map(item =>
      typeof item.label === 'string' ? item.label : item.label.label));
    assert.equal(errorsFor(uri).length, 0);
    assert.equal(labels.has('manifestVersion'), false, [...labels].join(', '));
  });
});
