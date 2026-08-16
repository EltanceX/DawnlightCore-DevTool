const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

function fixtureUri(relativePath) {
  assert.ok(workspaceRoot, 'VS Code smoke test did not open a workspace.');
  return vscode.Uri.file(path.join(workspaceRoot, relativePath));
}

suite('Dawnlight declarative schema smoke test', () => {
  test('valid root fixture has no schema errors', async () => {
    const document = await vscode.workspace.openTextDocument(
      fixtureUri('fixtures/valid/minimal/shaderpack.json')
    );
    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter(item => item.source === 'JSON Language Server' || item.source === 'json');
    assert.equal(diagnostics.filter(item => item.severity === vscode.DiagnosticSeverity.Error).length, 0,
      diagnostics.map(item => item.message).join('; '));
  });

  test('invalid root fixture produces a schema diagnostic', async () => {
    const document = await vscode.workspace.openTextDocument(
      fixtureUri('fixtures/invalid/wrong-type/shaderpack.json')
    );
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    assert.ok(diagnostics.some(item => item.severity === vscode.DiagnosticSeverity.Error),
      'Expected at least one schema error for the wrong-type fixture.');
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
});
