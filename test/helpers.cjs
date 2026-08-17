const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Ajv = require('ajv');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function schemaPath(name) {
  return path.join(root, 'schemas', name);
}

function schemaUri(name) {
  return pathToFileURL(schemaPath(name)).toString();
}

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const name of [
    'shaderpack-common.schema.json',
    'shaderpack-manifest-v3-fragment.schema.json',
    'shaderpack-manifest-v3-root.schema.json',
    'shaderpack-settings-ui-v1.schema.json',
    'shaderpack-catalog-snapshot-v1.schema.json'
  ]) {
    ajv.addSchema(readJson(`schemas/${name}`));
  }
  return ajv;
}

function validateWithSchema(ajv, schemaName, relativePath) {
  const schema = readJson(`schemas/${schemaName}`);
  const validate = ajv.getSchema(schema.$id);
  if (!validate) {
    throw new Error(`Schema '${schemaName}' was not registered.`);
  }
  const valid = validate(readJson(relativePath));
  return { valid, errors: validate.errors || [] };
}

function withCaret(source) {
  const marker = '|';
  const offset = source.indexOf(marker);
  if (offset < 0) {
    throw new Error('Completion fixture does not contain a caret marker.');
  }
  const text = source.slice(0, offset) + source.slice(offset + marker.length);
  const beforeCaret = text.slice(0, offset);
  const lines = beforeCaret.split(/\r?\n/);
  return {
    text,
    line: lines.length - 1,
    character: lines[lines.length - 1].length
  };
}

function readFixture(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

module.exports = {
  root,
  readJson,
  readFixture,
  schemaPath,
  schemaUri,
  createAjv,
  validateWithSchema,
  withCaret
};
