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
  test('valid root fixture has no schema errors', async () => {
    const document = await openFixture('fixtures/valid/minimal/shaderpack.json');
    assert.equal(errorsFor(document.uri).length, 0,
      errorsFor(document.uri).map(item => item.message).join('; '));
  });

  test('ToonLab and all supported fragment roles have no schema errors', async () => {
    const relativePaths = [
      'fixtures/valid/toonlab/shaderpack.json',
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
