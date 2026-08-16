const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  root,
  readJson,
  createAjv,
  validateWithSchema
} = require('./helpers.cjs');

test('valid MVP fixtures pass their assigned schemas', () => {
  const ajv = createAjv();
  const cases = [
    ['shaderpack-manifest-v3-root.schema.json', 'fixtures/valid/minimal/shaderpack.json'],
    ['shaderpack-manifest-v3-root.schema.json', 'fixtures/valid/dawnlight-v3.1/shaderpack.json'],
    ['shaderpack-manifest-v3-root.schema.json', 'fixtures/valid/toonlab/shaderpack.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/minimal/manifest/options/basic.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/minimal/manifest/resources/main.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/minimal/manifest/programs/main.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/minimal/manifest/passes/main.json'],
    ['shaderpack-settings-ui-v1.schema.json', 'fixtures/valid/minimal/manifest/ui/settings.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/dawnlight-v3.1/manifest/options/clouds.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/dawnlight-v3.1/manifest/resources/cubemap.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/dawnlight-v3.1/manifest/programs/atmosphere-effects.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/valid/dawnlight-v3.1/manifest/passes/atmosphere-shaft.json'],
    ['shaderpack-settings-ui-v1.schema.json', 'fixtures/valid/dawnlight-v3.1/manifest/ui/settings.json']
  ];

  for (const [schema, fixture] of cases) {
    const result = validateWithSchema(ajv, schema, fixture);
    assert.equal(result.valid, true, `${fixture}: ${JSON.stringify(result.errors)}`);
  }
});

test('invalid MVP fixtures are rejected', () => {
  const ajv = createAjv();
  const cases = [
    ['shaderpack-manifest-v3-root.schema.json', 'fixtures/invalid/wrong-type/shaderpack.json'],
    ['shaderpack-manifest-v3-root.schema.json', 'fixtures/invalid/missing-required/shaderpack.json'],
    ['shaderpack-manifest-v3-root.schema.json', 'fixtures/invalid/unknown-property/shaderpack.json'],
    ['shaderpack-manifest-v3-fragment.schema.json', 'fixtures/invalid/invalid-enum/manifest/resources/main.json']
  ];

  for (const [schema, fixture] of cases) {
    const result = validateWithSchema(ajv, schema, fixture);
    assert.equal(result.valid, false, `${fixture} unexpectedly passed`);
    assert.ok(result.errors.length > 0, `${fixture} did not return diagnostics`);
  }
});

test('schemas and snippets are valid JSON documents', () => {
  const jsonFiles = [
    'schemas/shaderpack-common.schema.json',
    'schemas/shaderpack-manifest-v3-fragment.schema.json',
    'schemas/shaderpack-manifest-v3-root.schema.json',
    'schemas/shaderpack-settings-ui-v1.schema.json',
    'package.json'
  ];
  for (const relativePath of jsonFiles) {
    assert.doesNotThrow(() => readJson(relativePath), relativePath);
  }

  const snippets = readJson('snippets/shaderpack.code-snippets');
  assert.ok(Object.keys(snippets).length >= 10, 'snippet catalog is unexpectedly small');
  for (const [name, snippet] of Object.entries(snippets)) {
    assert.equal(typeof snippet.prefix, 'string', `${name} has no prefix`);
    assert.ok(Array.isArray(snippet.body), `${name} body must be an array`);
  }
});

test('fixture inventory contains the documented MVP categories', () => {
  const expected = [
    'fixtures/valid/minimal/shaderpack.json',
    'fixtures/valid/dawnlight-v3.1/shaderpack.json',
    'fixtures/valid/toonlab/shaderpack.json',
    'fixtures/invalid/missing-required/shaderpack.json',
    'fixtures/invalid/wrong-type/shaderpack.json',
    'fixtures/invalid/unknown-property/shaderpack.json',
    'fixtures/invalid/invalid-enum/manifest/resources/main.json'
  ];
  for (const relativePath of expected) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), true, relativePath);
  }
});
