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

function completionLabels(items) {
  return new Set((items?.items || []).map(item => {
    const label = typeof item.label === 'string' ? item.label : item.label.label;
    try {
      return JSON.parse(label);
    } catch {
      return label;
    }
  }));
}

function positionForString(document, value, occurrence = 0) {
  const text = document.getText();
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = text.indexOf(`"${value}"`, offset + 1);
  }
  assert.notEqual(offset, -1, `Expected ${value} in ${document.uri.fsPath}.`);
  return document.positionAt(offset + 1);
}

async function executeUntil(command, args, predicate) {
  let result;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    result = await vscode.commands.executeCommand(command, ...args);
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return result;
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

  test('pack-local Definition, References, and semantic Hover work across fragments', async () => {
    const definitionDocument = await openFixture(
      'fixtures/valid/minimal/manifest/options/basic.json'
    );
    const usageDocument = await openFixture(
      'fixtures/valid/minimal/manifest/programs/main.json'
    );
    const usagePosition = positionForString(usageDocument, 'example:minimal/enabled');
    const definitions = await executeUntil(
      'vscode.executeDefinitionProvider', [usageDocument.uri, usagePosition],
      value => Array.isArray(value) && value.length > 0
    );
    assert.equal(definitions?.length, 1);
    assert.equal(definitions[0].uri.fsPath, definitionDocument.uri.fsPath);

    const references = await vscode.commands.executeCommand(
      'vscode.executeReferenceProvider',
      definitionDocument.uri,
      positionForString(definitionDocument, 'example:minimal/enabled')
    );
    assert.ok(references?.some(location => location.uri.fsPath === usageDocument.uri.fsPath));

    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider', usageDocument.uri, usagePosition
    );
    const contents = (hovers || []).flatMap(hover => hover.contents || [])
      .map(content => typeof content === 'string' ? content : content.value || '')
      .join('\n');
    assert.match(contents, /Option.*example:minimal\/enabled/s);
    assert.match(contents, /Default.*true/s);
    assert.match(contents, /manifest\/options\/basic\.json/);
  });

  test('Catalog Hover and readonly Definition documents work through VS Code', async () => {
    const document = await openFixture(
      'fixtures/valid/dawnlight-v3.1/manifest/passes/atmosphere-shaft.json'
    );
    const position = positionForString(document, 'dawnlight:fullscreen');
    const hovers = await executeUntil(
      'vscode.executeHoverProvider', [document.uri, position],
      value => (value || []).some(hover => (hover.contents || []).some(content =>
        String(typeof content === 'string' ? content : content.value || '').includes('Catalog hash')))
    );
    const hoverText = (hovers || []).flatMap(hover => hover.contents || [])
      .map(content => typeof content === 'string' ? content : content.value || '')
      .join('\n');
    assert.match(hoverText, /Stage Template.*dawnlight:fullscreen/s);
    assert.match(hoverText, /Source.*bundled/s);

    const definitions = await executeUntil(
      'vscode.executeDefinitionProvider', [document.uri, position],
      value => Array.isArray(value) && value.some(location => location.uri.scheme === 'dawnlight-catalog')
    );
    const location = definitions.find(item => item.uri.scheme === 'dawnlight-catalog');
    assert.ok(location, 'Expected a dawnlight-catalog Definition URI.');
    const catalogDocument = await vscode.workspace.openTextDocument(location.uri);
    assert.match(catalogDocument.getText(), /^#Stage Template `dawnlight:fullscreen`/);
    assert.match(catalogDocument.getText(), /Catalog hash: `[0-9a-f]{64}`/);
  });

  test('runtime graph and variant commands expose readonly virtual documents', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    assert.ok(commands.has('dawnlight.openRuntimeGraph'));
    assert.ok(commands.has('dawnlight.explainProgramVariant'));

    const cases = [
      {
        uri: vscode.Uri.parse('dawnlight-graph:/missing-smoke-snapshot.md'),
        expected: /graph snapshot is no longer available/i
      },
      {
        uri: vscode.Uri.parse('dawnlight-variant:/missing-smoke-snapshot.md'),
        expected: /variant snapshot is no longer available/i
      }
    ];
    for (const item of cases) {
      const document = await vscode.workspace.openTextDocument(item.uri);
      assert.equal(document.languageId, 'markdown');
      assert.match(document.getText(), item.expected);
      assert.equal(document.isDirty, false);
    }
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

  test('discovered arbitrary fragment and settings paths receive their schemas', async () => {
    const cases = [
      {
        relativePath: 'fixtures/workspace/arbitrary-fragment-path/config/pipeline.json',
        expected: ['options', 'resources', 'programs', 'passes']
      },
      {
        relativePath: 'fixtures/workspace/arbitrary-fragment-path/authoring/settings-ui.json',
        expected: ['schemaVersion', 'pages']
      }
    ];
    for (const item of cases) {
      const uri = fixtureUri(item.relativePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      await editor.edit(edit => edit.replace(
        new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
        '{\n  \n}\n'
      ));
      const completions = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider', uri, new vscode.Position(1, 2)
      );
      const labels = completionLabels(completions);
      for (const expected of item.expected) {
        assert.ok(labels.has(expected), `${item.relativePath}: ${[...labels].join(', ')}`);
      }
    }
  });

  test('untracked JSON inside a pack does not receive a Dawnlight fragment schema', async () => {
    const uri = fixtureUri(
      'fixtures/workspace/arbitrary-fragment-path/untracked/ordinary.json'
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit(edit => edit.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      '{\n  \n}\n'
    ));
    const completions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider', uri, new vscode.Position(1, 2)
    );
    const labels = completionLabels(completions);
    assert.equal(labels.has('resources'), false, [...labels].join(', '));
    assert.equal(labels.has('schemaVersion'), false, [...labels].join(', '));
  });
});
