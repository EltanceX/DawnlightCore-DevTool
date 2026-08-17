const assert = require('node:assert/strict');
const test = require('node:test');
const { readJson } = require('./helpers.cjs');

test('package contributes exactly the MVP static JSON roles', () => {
  const packageJson = readJson('package.json');
  const validations = packageJson.contributes.jsonValidation;
  assert.equal(Array.isArray(validations), true);
  assert.equal(validations.length, 3);

  const patterns = validations.flatMap(entry => entry.fileMatch);
  assert.deepEqual(patterns, [
    '**/shaderpack.json',
    '**/manifest/options/*.json',
    '**/manifest/resources/*.json',
    '**/manifest/passes/*.json',
    '**/manifest/programs/*.json',
    '**/manifest/ui/settings.json'
  ]);
  assert.equal(patterns.includes('**/*.json'), false);
});

test('JSON and JSONC use the same snippet catalog', () => {
  const snippets = readJson('package.json').contributes.snippets;
  assert.deepEqual(snippets, [
    { language: 'json', path: './snippets/shaderpack.code-snippets' },
    { language: 'jsonc', path: './snippets/shaderpack.code-snippets' }
  ]);
});

test('external Catalog path is opt-in and defaults to bundled fallback', () => {
  const configuration = readJson('package.json').contributes.configuration;
  const catalogPath = configuration.properties['dawnlight.shaderPack.catalog.path'];
  assert.equal(catalogPath.type, 'string');
  assert.equal(catalogPath.default, '');
  assert.equal(catalogPath.scope, 'resource');
});

test('Analyzer validation is opt-in by executable path and exposes save/restart commands', () => {
  const packageJson = readJson('package.json');
  const properties = packageJson.contributes.configuration.properties;
  assert.equal(properties['dawnlight.shaderPack.analyzer.path'].default, '');
  assert.equal(properties['dawnlight.shaderPack.validation.onSave'].default, true);
  assert.ok(properties['dawnlight.shaderPack.validation.timeoutMs'].minimum >= 250);
  assert.ok(packageJson.contributes.commands.some(item => item.command === 'dawnlight.validateShaderPack'));
  assert.ok(packageJson.contributes.commands.some(item => item.command === 'dawnlight.restartAnalyzer'));
});
