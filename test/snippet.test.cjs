const assert = require('node:assert/strict');
const test = require('node:test');
const { createAjv, readJson } = require('./helpers.cjs');

const requiredPrefixes = [
  'dawnlight-root-single',
  'dawnlight-root-composed',
  'dawnlight-options-fragment',
  'dawnlight-resources-fragment',
  'dawnlight-programs-fragment',
  'dawnlight-passes-fragment',
  'dawnlight-option-boolean',
  'dawnlight-option-number',
  'dawnlight-option-choice',
  'dawnlight-texture2d',
  'dawnlight-texturecube',
  'dawnlight-buffer',
  'dawnlight-graphics-program',
  'dawnlight-compute-program',
  'dawnlight-fullscreen-command',
  'dawnlight-compute-command',
  'dawnlight-copy-command',
  'dawnlight-clear-command',
  'dawnlight-present-command',
  'dawnlight-history-commit-command',
  'dawnlight-settings-page',
  'dawnlight-settings-group',
  'dawnlight-toggle-control',
  'dawnlight-choice-control',
  'dawnlight-slider-control'
];

const snippets = readJson('snippets/shaderpack.code-snippets');
const snippetsByPrefix = new Map(Object.values(snippets).map(snippet => [snippet.prefix, snippet]));

function expand(prefix, finalTabStop = '') {
  const snippet = snippetsByPrefix.get(prefix);
  assert.ok(snippet, `Missing snippet ${prefix}`);
  return snippet.body.join('\n')
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{0\}/g, finalTabStop);
}

function parseExpanded(prefix, finalTabStop) {
  const source = expand(prefix, finalTabStop);
  assert.doesNotThrow(() => JSON.parse(source), `${prefix}: ${source}`);
  return JSON.parse(source);
}

function assertValid(ajv, schemaName, value, prefix) {
  const schema = readJson(`schemas/${schemaName}`);
  const validate = ajv.getSchema(schema.$id);
  assert.ok(validate, `${schemaName} is not registered`);
  assert.equal(validate(value), true, `${prefix}: ${JSON.stringify(validate.errors)}`);
}

function settingsWithControl(control) {
  return {
    schemaVersion: 1,
    pages: [{
      id: 'basic',
      title: 'page.basic',
      groups: [{ id: 'visual', title: 'group.visual', controls: [control] }]
    }]
  };
}

test('snippet catalog contains every required MVP prefix', () => {
  assert.deepEqual(
    requiredPrefixes.filter(prefix => !snippetsByPrefix.has(prefix)),
    []
  );
  assert.equal(snippetsByPrefix.size, Object.keys(snippets).length, 'Snippet prefixes must be unique.');
});

test('root and fragment snippets expand to schema-valid JSON', () => {
  const ajv = createAjv();
  for (const prefix of ['dawnlight-root-single', 'dawnlight-root-composed']) {
    assertValid(ajv, 'shaderpack-manifest-v3-root.schema.json', parseExpanded(prefix), prefix);
  }
  for (const prefix of [
    'dawnlight-options-fragment',
    'dawnlight-resources-fragment',
    'dawnlight-programs-fragment',
    'dawnlight-passes-fragment'
  ]) {
    assertValid(ajv, 'shaderpack-manifest-v3-fragment.schema.json', parseExpanded(prefix), prefix);
  }
});

test('definition snippets expand to schema-valid fragment members', () => {
  const ajv = createAjv();
  const groups = [
    [['dawnlight-option-boolean', 'dawnlight-option-number', 'dawnlight-option-choice'], 'options'],
    [['dawnlight-texture2d', 'dawnlight-texturecube', 'dawnlight-buffer'], 'resources'],
    [['dawnlight-graphics-program', 'dawnlight-compute-program'], 'programs']
  ];
  for (const [prefixes, property] of groups) {
    for (const prefix of prefixes) {
      assertValid(
        ajv,
        'shaderpack-manifest-v3-fragment.schema.json',
        { [property]: [parseExpanded(prefix)] },
        prefix
      );
    }
  }
});

test('command snippets expand to schema-valid pass commands', () => {
  const ajv = createAjv();
  const prefixes = requiredPrefixes.filter(prefix => prefix.endsWith('-command'));
  for (const prefix of prefixes) {
    const fragment = {
      passes: [{ id: 'example:pass', programs: [], commands: [parseExpanded(prefix)] }]
    };
    assertValid(ajv, 'shaderpack-manifest-v3-fragment.schema.json', fragment, prefix);
  }
});

test('Settings UI snippets expand to schema-valid nested objects', () => {
  const ajv = createAjv();
  const toggle = parseExpanded('dawnlight-toggle-control');
  const group = parseExpanded('dawnlight-settings-group', JSON.stringify(toggle));
  const page = parseExpanded('dawnlight-settings-page', JSON.stringify(group));
  assertValid(ajv, 'shaderpack-settings-ui-v1.schema.json', { schemaVersion: 1, pages: [page] }, 'page');

  for (const prefix of [
    'dawnlight-toggle-control', 'dawnlight-choice-control', 'dawnlight-slider-control'
  ]) {
    assertValid(
      ajv,
      'shaderpack-settings-ui-v1.schema.json',
      settingsWithControl(parseExpanded(prefix)),
      prefix
    );
  }
});
