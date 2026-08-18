'use strict';

/**
 * Catalog source-registration exporter and parity checker.
 *
 * This file intentionally has no dependency on the language server.  The
 * Survivalcraft/ShaderTest side can therefore run the same tool (or consume
 * the JSON contract documented in docs/) before the VS Code package is built.
 * When the TypeScript contracts have been built we use their canonical hash
 * implementation; a byte-compatible local implementation is kept as a
 * fallback so the CLI remains useful from a clean checkout.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_REGISTRATION_CONTRACT_VERSION = 1;
const CATALOG_SNAPSHOT_CONTRACT_VERSION = 1;

const COLLECTIONS = Object.freeze([
  'stageTemplates',
  'services',
  'semantics',
  'engineDrawProviders',
  'capabilities',
  'resourceFormats'
]);

const ENTRY_FIELDS = Object.freeze({
  stageTemplates: Object.freeze(['id', 'version', 'description', 'since', 'deprecated', 'phase', 'targets', 'requiredCapabilities']),
  services: Object.freeze(['id', 'version', 'description', 'since', 'deprecated', 'valueKind', 'requiredServices']),
  semantics: Object.freeze(['id', 'version', 'description', 'since', 'deprecated', 'valueKind', 'requiredServices']),
  engineDrawProviders: Object.freeze(['id', 'version', 'description', 'since', 'deprecated', 'command', 'requiredServices', 'requiredCapabilities']),
  capabilities: Object.freeze(['id', 'version', 'description', 'since', 'deprecated', 'valueKind']),
  resourceFormats: Object.freeze(['id', 'version', 'description', 'since', 'deprecated', 'valueKind', 'components', 'bytesPerPixel', 'depth', 'filterable', 'renderable'])
});

const ARRAY_FIELDS = Object.freeze(new Set(['targets', 'requiredCapabilities', 'requiredServices']));
const FORMAT_FIELDS = Object.freeze(new Set(['manifest', 'sourceComposition', 'settingsUi']));
const REFERENCE_FIELDS = Object.freeze(new Set(['id', 'version']));
const SNAPSHOT_FIELDS = Object.freeze(new Set([
  'contractVersion',
  'host',
  'supportedFormats',
  ...COLLECTIONS,
  'limits',
  'hash'
]));
const SOURCE_FIELDS = Object.freeze(new Set([
  'sourceContractVersion',
  'sourceVersion',
  'host',
  'supportedFormats',
  'registrations',
  'limits',
  ...COLLECTIONS
]));
const HOST_FIELDS = Object.freeze(new Set(['id', 'displayName', 'version', 'build']));

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareStrings(left, right) {
  // Registration arrays are emitted in a locale-independent order.  This is
  // also the order used by the bundled snapshot files and keeps generated
  // diffs stable on Windows, Linux and macOS.
  return left < right ? -1 : left > right ? 1 : 0;
}

// The TypeScript Catalog contract currently uses localeCompare for its
// canonical hash. Keep a separate comparator for the hash payload so the
// exporter can preserve the stable file order above while remaining hash
// compatible with the Language Server implementation.
function compareCanonicalStrings(left, right) {
  return left.localeCompare(right) || 0;
}

function compareEntries(left, right) {
  return compareStrings(left.id, right.id) || left.version - right.version;
}

function addError(errors, pathName, message, code = 'invalid') {
  errors.push({ code, path: pathName, message });
}

function assertObject(value, pathName, errors) {
  if (!isRecord(value)) {
    addError(errors, pathName, 'must be an object.');
    return false;
  }
  return true;
}

function assertNonEmptyString(value, pathName, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    addError(errors, pathName, 'must be a non-empty string.');
    return false;
  }
  return true;
}

function assertVersion(value, pathName, errors) {
  if (!Number.isInteger(value) || value < 0) {
    addError(errors, pathName, 'must be a non-negative integer.');
    return false;
  }
  return true;
}

function normalizeReference(value, pathName, errors) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (!REFERENCE_FIELDS.has(key)) {
        addError(errors, `${pathName}.${key}`, 'is not part of the {id, version} reference.', 'unknown-property');
      }
    }
    if (typeof value.id === 'string' && value.id.length > 0 &&
      Number.isInteger(value.version) && value.version >= 0) {
      return `${value.id}@${value.version}`;
    }
  }
  addError(errors, pathName, 'must be a non-empty string or an {id, version} reference.');
  return undefined;
}

function normalizeStringArray(value, pathName, errors) {
  if (!Array.isArray(value)) {
    addError(errors, pathName, 'must be an array.');
    return [];
  }
  const result = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = normalizeReference(value[index], `${pathName}[${index}]`, errors);
    if (item === undefined) continue;
    if (seen.has(item)) addError(errors, `${pathName}[${index}]`, `contains duplicate '${item}'.`, 'duplicate');
    seen.add(item);
    result.push(item);
  }
  return result.sort(compareStrings);
}

function normalizeFormats(value, errors) {
  const result = {};
  if (!assertObject(value, 'supportedFormats', errors)) return result;
  for (const key of Object.keys(value)) {
    if (!FORMAT_FIELDS.has(key)) {
      addError(errors, `supportedFormats.${key}`, 'is not part of the source-registration contract.', 'unknown-property');
    }
  }
  for (const field of ['manifest', 'sourceComposition', 'settingsUi']) {
    const values = value[field];
    if (!Array.isArray(values)) {
      addError(errors, `supportedFormats.${field}`, 'must be an array of non-negative integers.');
      result[field] = [];
      continue;
    }
    const normalized = [];
    const seen = new Set();
    values.forEach((item, index) => {
      if (!assertVersion(item, `supportedFormats.${field}[${index}]`, errors)) return;
      if (seen.has(item)) addError(errors, `supportedFormats.${field}[${index}]`, `contains duplicate '${item}'.`, 'duplicate');
      seen.add(item);
      normalized.push(item);
    });
    result[field] = normalized.sort((a, b) => a - b);
  }
  return result;
}

function normalizeEntry(value, collection, index, errors) {
  const entryPath = `${collection}[${index}]`;
  if (!assertObject(value, entryPath, errors)) return undefined;
  const allowed = new Set(ENTRY_FIELDS[collection]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${entryPath}.${key}`, 'is not part of the source-registration contract.', 'unknown-property');
  }

  const result = {};
  if (!assertNonEmptyString(value.id, `${entryPath}.id`, errors)) return undefined;
  result.id = value.id;
  if (!assertVersion(value.version, `${entryPath}.version`, errors)) return undefined;
  result.version = value.version;

  for (const field of ['description', 'since']) {
    if (value[field] !== undefined) {
      if (assertNonEmptyString(value[field], `${entryPath}.${field}`, errors)) result[field] = value[field];
    }
  }
  if (value.deprecated !== undefined) {
    if (typeof value.deprecated !== 'boolean') addError(errors, `${entryPath}.deprecated`, 'must be boolean.');
    else result.deprecated = value.deprecated;
  }

  for (const field of ['phase', 'command']) {
    if (value[field] !== undefined) {
      if (assertNonEmptyString(value[field], `${entryPath}.${field}`, errors)) result[field] = value[field];
    }
  }
  if (value.valueKind !== undefined) {
    if (assertNonEmptyString(value.valueKind, `${entryPath}.valueKind`, errors)) result.valueKind = value.valueKind;
  }
  for (const field of ['components', 'bytesPerPixel']) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) addError(errors, `${entryPath}.${field}`, 'must be a finite number.');
      else result[field] = value[field];
    }
  }
  for (const field of ['depth', 'filterable', 'renderable']) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'boolean') addError(errors, `${entryPath}.${field}`, 'must be boolean.');
      else result[field] = value[field];
    }
  }
  for (const field of ARRAY_FIELDS) {
    if (value[field] !== undefined) {
      const normalized = normalizeStringArray(value[field], `${entryPath}.${field}`, errors);
      // Empty dependency/target metadata is equivalent to an omitted field in
      // Catalog Snapshot v1. Omitting it keeps engine exporters and the
      // hand-authored bundled snapshot structurally comparable.
      if (normalized.length > 0) result[field] = normalized;
    }
  }
  if (collection === 'semantics' && result.valueKind === undefined) {
    addError(errors, `${entryPath}.valueKind`, 'is required for semantic registrations.', 'missing-required');
  }
  return result;
}

function normalizeCollections(registrations, errors, strictKeys = true) {
  const result = {};
  if (strictKeys) {
    for (const key of Object.keys(registrations)) {
      if (!COLLECTIONS.includes(key)) {
        addError(errors, `registrations.${key}`, 'is not part of the source-registration contract.', 'unknown-property');
      }
    }
  }
  for (const collection of COLLECTIONS) {
    const values = registrations[collection] === undefined ? [] : registrations[collection];
    if (!Array.isArray(values)) {
      addError(errors, `registrations.${collection}`, 'must be an array.');
      result[collection] = [];
      continue;
    }
    const entries = [];
    const seen = new Set();
    values.forEach((value, index) => {
      const entry = normalizeEntry(value, collection, index, errors);
      if (!entry) return;
      const key = `${entry.id}\u0000${entry.version}`;
      if (seen.has(key)) addError(errors, `registrations.${collection}[${index}]`, `contains duplicate ${entry.id}@${entry.version}.`, 'duplicate');
      seen.add(key);
      entries.push(entry);
    });
    result[collection] = entries.sort(compareEntries);
  }
  return result;
}

function loadContracts() {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.resolve(__dirname, '..', '..', 'packages', 'contracts', 'dist'));
  } catch {
    return undefined;
  }
}

function canonicalValue(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const record = value;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`;
}

function canonicalPayload(snapshot) {
  const payload = {};
  for (const field of ['contractVersion', 'host', 'supportedFormats', ...COLLECTIONS, 'limits']) {
    payload[field] = clone(snapshot[field]);
  }
  for (const field of ['manifest', 'sourceComposition', 'settingsUi']) {
    payload.supportedFormats[field] = [...payload.supportedFormats[field]].sort((a, b) => a - b);
  }
  for (const collection of COLLECTIONS) {
    payload[collection] = [...payload[collection]].sort((left, right) =>
      compareCanonicalStrings(left.id, right.id) || left.version - right.version);
  }
  return payload;
}

function computeHash(snapshot) {
  const contracts = loadContracts();
  if (contracts && typeof contracts.computeCatalogSnapshotHash === 'function') {
    return contracts.computeCatalogSnapshotHash(snapshot);
  }
  return crypto.createHash('sha256').update(canonicalValue(canonicalPayload(snapshot)), 'utf8').digest('hex');
}

function validateSnapshotShape(snapshot, errors) {
  if (!assertObject(snapshot, 'snapshot', errors)) return;
  for (const key of Object.keys(snapshot)) {
    if (!SNAPSHOT_FIELDS.has(key)) addError(errors, `snapshot.${key}`, 'is not part of the Catalog Snapshot contract.', 'unknown-property');
  }
  if (snapshot.contractVersion !== CATALOG_SNAPSHOT_CONTRACT_VERSION) {
    addError(errors, 'snapshot.contractVersion', `must equal ${CATALOG_SNAPSHOT_CONTRACT_VERSION}.`, 'unsupported-version');
  }
  if (!assertObject(snapshot.host, 'snapshot.host', errors)) return;
  for (const field of ['id', 'displayName', 'version']) assertNonEmptyString(snapshot.host[field], `snapshot.host.${field}`, errors);
  if (snapshot.host.build !== undefined) assertNonEmptyString(snapshot.host.build, 'snapshot.host.build', errors);
  const formats = normalizeFormats(snapshot.supportedFormats, errors);
  // Normalize only for validation side effects; compare below to catch arrays
  // that are not valid, without changing caller-owned values.
  void formats;
  for (const collection of COLLECTIONS) {
    const values = snapshot[collection];
    if (!Array.isArray(values)) {
      addError(errors, `snapshot.${collection}`, 'must be an array.');
      continue;
    }
    const seen = new Set();
    values.forEach((entry, index) => {
      if (!assertObject(entry, `snapshot.${collection}[${index}]`, errors)) return;
      assertNonEmptyString(entry.id, `snapshot.${collection}[${index}].id`, errors);
      assertVersion(entry.version, `snapshot.${collection}[${index}].version`, errors);
      const key = `${entry.id}\u0000${entry.version}`;
      if (seen.has(key)) addError(errors, `snapshot.${collection}[${index}]`, `contains duplicate ${entry.id}@${entry.version}.`, 'duplicate');
      seen.add(key);
      for (const field of ['description', 'since']) if (entry[field] !== undefined) assertNonEmptyString(entry[field], `snapshot.${collection}[${index}].${field}`, errors);
      if (entry.deprecated !== undefined && typeof entry.deprecated !== 'boolean') addError(errors, `snapshot.${collection}[${index}].deprecated`, 'must be boolean.');
      for (const field of ARRAY_FIELDS) if (entry[field] !== undefined) normalizeStringArray(entry[field], `snapshot.${collection}[${index}].${field}`, errors);
      if (entry.valueKind !== undefined) assertNonEmptyString(entry.valueKind, `snapshot.${collection}[${index}].valueKind`, errors);
      for (const field of ['components', 'bytesPerPixel']) if (entry[field] !== undefined && (typeof entry[field] !== 'number' || !Number.isFinite(entry[field]))) addError(errors, `snapshot.${collection}[${index}].${field}`, 'must be a finite number.');
      for (const field of ['depth', 'filterable', 'renderable']) if (entry[field] !== undefined && typeof entry[field] !== 'boolean') addError(errors, `snapshot.${collection}[${index}].${field}`, 'must be boolean.');
      if (collection === 'semantics' && entry.valueKind === undefined) addError(errors, `snapshot.${collection}[${index}].valueKind`, 'is required for semantic registrations.', 'missing-required');
    });
  }
  if (!assertObject(snapshot.limits, 'snapshot.limits', errors)) return;
  if (typeof snapshot.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(snapshot.hash)) {
    addError(errors, 'snapshot.hash', 'must be a 64-character hexadecimal SHA-256 hash.');
  }
}

function validateCatalogSnapshot(snapshot) {
  const errors = [];
  validateSnapshotShape(snapshot, errors);
  const hashValid = errors.every(error => error.path !== 'snapshot.hash') && typeof snapshot?.hash === 'string'
    ? snapshot.hash.toLowerCase() === computeHash(snapshot)
    : false;
  if (errors.length === 0 && !hashValid) addError(errors, 'snapshot.hash', 'does not match the canonical snapshot payload.', 'hash-mismatch');
  // Delegate semantic checks to the shared contract when available. This keeps
  // the exporter honest if a future contract adds a required field.
  const contracts = loadContracts();
  if (errors.length === 0 && contracts && typeof contracts.parseCatalogSnapshot === 'function') {
    try {
      contracts.parseCatalogSnapshot(snapshot);
    } catch (error) {
      addError(errors, 'snapshot', error.message, 'contract');
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    hashValid,
    hash: typeof snapshot?.hash === 'string' ? snapshot.hash : undefined,
    errors: Object.freeze(errors)
  });
}

function normalizeSourceRegistration(source) {
  const errors = [];
  if (!assertObject(source, 'source', errors)) throwSourceErrors(errors);
  for (const key of Object.keys(source)) {
    if (!SOURCE_FIELDS.has(key)) {
      addError(errors, `source.${key}`, 'is not part of the source-registration contract.', 'unknown-property');
    }
  }
  const sourceVersion = source.sourceContractVersion ?? source.sourceVersion;
  if (source.sourceContractVersion !== undefined && source.sourceVersion !== undefined &&
    source.sourceContractVersion !== source.sourceVersion) {
    addError(errors, 'source.sourceVersion', 'must match sourceContractVersion when both are present.', 'conflict');
  }
  if (sourceVersion !== SOURCE_REGISTRATION_CONTRACT_VERSION) {
    addError(errors, 'source.sourceContractVersion', `must equal ${SOURCE_REGISTRATION_CONTRACT_VERSION}.`, 'unsupported-version');
  }
  if (!assertObject(source.host, 'source.host', errors)) {
    throwSourceErrors(errors);
  }
  for (const key of Object.keys(source.host)) {
    if (!HOST_FIELDS.has(key)) {
      addError(errors, `source.host.${key}`, 'is not part of the source-registration contract.', 'unknown-property');
    }
  }
  const host = {};
  for (const field of ['id', 'displayName', 'version']) {
    if (assertNonEmptyString(source.host[field], `source.host.${field}`, errors)) host[field] = source.host[field];
  }
  if (source.host.build !== undefined && assertNonEmptyString(source.host.build, 'source.host.build', errors)) host.build = source.host.build;
  const supportedFormats = normalizeFormats(source.supportedFormats, errors);
  const registrations = source.registrations === undefined ? source : source.registrations;
  if (!assertObject(registrations, 'source.registrations', errors)) throwSourceErrors(errors);
  const collections = normalizeCollections(registrations, errors, source.registrations !== undefined);
  const limits = source.limits === undefined ? {} : source.limits;
  if (!assertObject(limits, 'source.limits', errors)) {
    throwSourceErrors(errors);
  }
  const snapshot = {
    contractVersion: CATALOG_SNAPSHOT_CONTRACT_VERSION,
    host,
    supportedFormats,
    ...collections,
    limits: clone(limits)
  };
  if (errors.length > 0) throwSourceErrors(errors);
  return snapshot;
}

function throwSourceErrors(errors) {
  const error = new Error(`Invalid Catalog source-registration (${errors.length} error${errors.length === 1 ? '' : 's'}).`);
  error.code = 'CATALOG_SOURCE_INVALID';
  error.errors = errors;
  throw error;
}

function exportCatalogSnapshot(source) {
  const payload = normalizeSourceRegistration(source);
  const snapshot = { ...payload, hash: computeHash(payload) };
  const validation = validateCatalogSnapshot(snapshot);
  if (!validation.valid) {
    const error = new Error('Exporter produced an invalid Catalog Snapshot.');
    error.code = 'CATALOG_EXPORT_INVALID';
    error.errors = validation.errors;
    throw error;
  }
  return snapshot;
}

function snapshotFromInput(value) {
  if (isRecord(value) && value.hash !== undefined) {
    const report = validateCatalogSnapshot(value);
    if (!report.valid) {
      const error = new Error('Catalog Snapshot is invalid.');
      error.code = 'CATALOG_SNAPSHOT_INVALID';
      error.errors = report.errors;
      throw error;
    }
    return clone(value);
  }
  return exportCatalogSnapshot(value);
}

function entryMap(snapshot, collection) {
  return new Map(snapshot[collection].map(entry => [`${entry.id}@${entry.version}`, entry]));
}

function valuesEqual(left, right) {
  return canonicalValue(left) === canonicalValue(right);
}

function diffCatalogSnapshots(actualInput, expectedInput) {
  const actual = snapshotFromInput(actualInput);
  const expected = snapshotFromInput(expectedInput);
  const differences = [];
  if (actual.contractVersion !== expected.contractVersion) differences.push({ path: 'contractVersion', kind: 'changed', actual: actual.contractVersion, expected: expected.contractVersion });
  for (const field of ['host', 'supportedFormats', 'limits']) {
    if (!valuesEqual(actual[field], expected[field])) differences.push({ path: field, kind: 'changed', actual: actual[field], expected: expected[field] });
  }
  for (const collection of COLLECTIONS) {
    const actualMap = entryMap(actual, collection);
    const expectedMap = entryMap(expected, collection);
    for (const [key, expectedEntry] of expectedMap) {
      if (!actualMap.has(key)) differences.push({ path: `${collection}.${key}`, kind: 'missing', expected: expectedEntry });
      else if (!valuesEqual(actualMap.get(key), expectedEntry)) differences.push({ path: `${collection}.${key}`, kind: 'changed', actual: actualMap.get(key), expected: expectedEntry });
    }
    for (const [key, actualEntry] of actualMap) {
      if (!expectedMap.has(key)) differences.push({ path: `${collection}.${key}`, kind: 'unexpected', actual: actualEntry });
    }
  }
  const actualHash = computeHash(actual);
  const expectedHash = computeHash(expected);
  if (actual.hash.toLowerCase() !== actualHash) differences.push({ path: 'hash', kind: 'invalid', actual: actual.hash, expected: actualHash });
  if (expected.hash.toLowerCase() !== expectedHash) differences.push({ path: 'expected.hash', kind: 'invalid', actual: expected.hash, expected: expectedHash });
  return Object.freeze({
    equal: differences.length === 0,
    actualHash,
    expectedHash,
    differences: Object.freeze(differences)
  });
}

function readJson(filePath) {
  const absolutePath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printUsage() {
  process.stderr.write([
    'Usage:',
    '  node tools/catalog/catalog-tool.cjs export <source-registration.json> [snapshot.json]',
    '  node tools/catalog/catalog-tool.cjs validate <snapshot.json>',
    '  node tools/catalog/catalog-tool.cjs parity <source-registration-or-snapshot.json> <expected-snapshot.json>'
  ].join('\n') + '\n');
}

function main(argv) {
  const [command, first, second] = argv;
  if (!command || !first || (command === 'parity' && !second) || !['export', 'validate', 'parity'].includes(command)) {
    printUsage();
    return 2;
  }
  try {
    if (command === 'export') {
      const snapshot = exportCatalogSnapshot(readJson(first));
      if (second) writeJson(second, snapshot);
      else process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      return 0;
    }
    if (command === 'validate') {
      const value = readJson(first);
      const report = validateCatalogSnapshot(value);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return report.valid ? 0 : 1;
    }
    const report = diffCatalogSnapshots(readJson(first), readJson(second));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.equal ? 0 : 1;
  } catch (error) {
    const output = { error: error.message, code: error.code };
    if (error.errors) output.errors = error.errors;
    process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
    return 1;
  }
}

module.exports = {
  SOURCE_REGISTRATION_CONTRACT_VERSION,
  CATALOG_SOURCE_REGISTRATION_CONTRACT_VERSION: SOURCE_REGISTRATION_CONTRACT_VERSION,
  CATALOG_SNAPSHOT_CONTRACT_VERSION,
  COLLECTIONS,
  normalizeSourceRegistration,
  exportCatalogSnapshot,
  validateCatalogSnapshot,
  diffCatalogSnapshots,
  computeHash,
  canonicalPayload
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
