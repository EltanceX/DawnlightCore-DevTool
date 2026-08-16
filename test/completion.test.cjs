const assert = require('node:assert/strict');
const test = require('node:test');
const { getLanguageService, TextDocument } = require('vscode-json-languageservice');
const { pathToFileURL, fileURLToPath } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const {
  root,
  readFixture,
  schemaUri,
  withCaret
} = require('./helpers.cjs');

function schemaRequestService(uri) {
  let filePath;
  try {
    filePath = uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
  } catch {
    // Relative $id values can be normalized to file:///name on Windows.
  }
  if (!filePath) {
    filePath = path.join(root, 'schemas', path.basename(uri));
  }
  return Promise.resolve(fs.readFileSync(filePath, 'utf8'));
}

function createLanguageService(schemaName, documentUri) {
  const service = getLanguageService({ schemaRequestService });
  service.configure({
    schemas: [{
      uri: schemaUri(schemaName),
      // The JSON language service's glob matcher expects path patterns;
      // exact file:// URIs are not treated as matches on Windows.
      fileMatch: ['**/*.json']
    }]
  });
  return service;
}

async function complete(schemaName, relativeUri, source) {
  const documentUri = pathToFileURL(path.join(root, relativeUri)).toString();
  const fixture = withCaret(source);
  const document = TextDocument.create(documentUri, 'jsonc', 1, fixture.text);
  const service = createLanguageService(schemaName, documentUri);
  const jsonDocument = service.parseJSONDocument(document);
  const result = await service.doComplete(document, {
    line: fixture.line,
    character: fixture.character
  }, jsonDocument);
  return result || { items: [] };
}

function labels(result) {
  return new Set(result.items.map(item => {
    const label = String(item.label);
    try {
      return JSON.parse(label);
    } catch {
      return label;
    }
  }));
}

test('root property completion exposes Manifest metadata', async () => {
  const result = await complete(
    'shaderpack-manifest-v3-root.schema.json',
    'fixtures/completion/shaderpack.json',
    '{\n  |\n}'
  );
  const values = labels(result);
  assert.ok(values.has('manifestVersion'), [...values].join(', '));
  assert.ok(values.has('id'), [...values].join(', '));
  assert.ok(values.has('fragments'), [...values].join(', '));
});

test('fragment const completion exposes resource kinds', async () => {
  const result = await complete(
    'shaderpack-manifest-v3-fragment.schema.json',
    'fixtures/completion/manifest/resources/main.json',
    '{\n  "resources": [{\n    "id": "example:resource",\n    "kind": "|"\n  }]\n}'
  );
  const values = labels(result);
  for (const expected of ['texture2D', 'textureCube', 'buffer']) {
    assert.ok(values.has(expected), `${expected} missing from ${[...values].join(', ')}`);
  }
});

test('fragment enum completion exposes option impacts through a $ref', async () => {
  const result = await complete(
    'shaderpack-manifest-v3-fragment.schema.json',
    'fixtures/completion/manifest/options/main.json',
    '{\n  "options": [{\n    "id": "example:option",\n    "type": "boolean",\n    "default": true,\n    "impact": ["|"]\n  }]\n}'
  );
  const values = labels(result);
  for (const expected of ['uniform', 'program', 'pipeline', 'resources']) {
    assert.ok(values.has(expected), `${expected} missing from ${[...values].join(', ')}`);
  }
});

test('settings widget completion exposes supported controls', async () => {
  const result = await complete(
    'shaderpack-settings-ui-v1.schema.json',
    'fixtures/completion/manifest/ui/settings.json',
    '{\n  "schemaVersion": 1,\n  "pages": [{\n    "id": "basic",\n    "title": "page.basic",\n    "groups": [{\n      "id": "main",\n      "title": "group.main",\n      "controls": [{\n        "id": "control",\n        "option": "example:option",\n        "widget": "|"\n      }]\n    }]\n  }]\n}'
  );
  const values = labels(result);
  for (const expected of ['toggle', 'choice', 'slider', 'number', 'text']) {
    assert.ok(values.has(expected), `${expected} missing from ${[...values].join(', ')}`);
  }
});

test('JSONC comments and trailing commas still receive completion', async () => {
  const result = await complete(
    'shaderpack-manifest-v3-root.schema.json',
    'fixtures/completion/shaderpack.json',
    '{\n  // authoring comment\n  "manifestVersion": 3,\n  |\n}'
  );
  assert.ok(labels(result).has('id'), [...labels(result)].join(', '));
});
