import { createHash } from 'node:crypto';

export const CATALOG_SNAPSHOT_CONTRACT_VERSION = 1 as const;

export type CatalogValueKind =
  | 'boolean'
  | 'float'
  | 'int'
  | 'uint'
  | 'intVector3'
  | 'integer'
  | 'number'
  | 'string'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'vector2'
  | 'vector3'
  | 'vector4'
  | 'matrix3'
  | 'matrix4'
  | 'color'
  | 'texture'
  | 'buffer'
  | 'sampler'
  | 'unknown'
  | (string & {});

export interface CatalogHost {
  id: string;
  displayName: string;
  version: string;
  build?: string;
}

export interface CatalogSupportedFormats {
  manifest: readonly number[];
  sourceComposition: readonly number[];
  settingsUi: readonly number[];
}

export interface CatalogEntryBase {
  id: string;
  version: number;
  description?: string;
  since?: string;
  deprecated?: boolean;
}

export interface CatalogStageTemplate extends CatalogEntryBase {
  phase?: string;
  targets?: readonly string[];
  requiredCapabilities?: readonly string[];
}

export interface CatalogService extends CatalogEntryBase {
  valueKind?: CatalogValueKind;
  requiredServices?: readonly string[];
}

export interface CatalogSemantic extends CatalogEntryBase {
  valueKind: CatalogValueKind;
  requiredServices?: readonly string[];
}

export interface CatalogEngineDrawProvider extends CatalogEntryBase {
  command?: string;
  requiredServices?: readonly string[];
  requiredCapabilities?: readonly string[];
}

export interface CatalogCapability extends CatalogEntryBase {
  valueKind?: CatalogValueKind;
}

export interface CatalogResourceFormat extends CatalogEntryBase {
  valueKind?: CatalogValueKind;
  components?: number;
  bytesPerPixel?: number;
  depth?: boolean;
  filterable?: boolean;
  renderable?: boolean;
}

export interface CatalogSnapshotPayload {
  contractVersion: typeof CATALOG_SNAPSHOT_CONTRACT_VERSION;
  host: CatalogHost;
  supportedFormats: CatalogSupportedFormats;
  stageTemplates: readonly CatalogStageTemplate[];
  services: readonly CatalogService[];
  semantics: readonly CatalogSemantic[];
  engineDrawProviders: readonly CatalogEngineDrawProvider[];
  capabilities: readonly CatalogCapability[];
  resourceFormats: readonly CatalogResourceFormat[];
  limits: Readonly<Record<string, unknown>>;
}

export interface CatalogSnapshot extends CatalogSnapshotPayload {
  hash: string;
}

export interface CatalogSnapshotInfo {
  source: 'bundled' | 'external';
  path: string;
  hash: string;
  hashValid: boolean;
  snapshot: CatalogSnapshot;
}

export interface CatalogVersionNegotiation {
  clientSupportedVersions: readonly number[];
  serverSupportedVersions: readonly number[];
  selectedVersion?: number;
  compatible: boolean;
}

export interface CatalogSnapshotState extends CatalogSnapshotInfo {
  requestedPath?: string;
  fallbackReason?: string;
  negotiation: CatalogVersionNegotiation;
}

const ENTRY_COLLECTIONS = [
  'stageTemplates',
  'services',
  'semantics',
  'engineDrawProviders',
  'capabilities',
  'resourceFormats'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Catalog ${field} must be a non-empty string.`);
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Catalog ${field} must be a finite number.`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`Catalog ${field} must be an array of strings.`);
  }
}

function validateEntries(value: unknown, collection: string): void {
  if (!Array.isArray(value)) throw new Error(`Catalog ${collection} must be an array.`);
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) throw new Error(`Catalog ${collection} contains a non-object entry.`);
    assertString(entry.id, `${collection}.id`);
    assertNumber(entry.version, `${collection}.version`);
    if (!Number.isInteger(entry.version) || entry.version < 0) {
      throw new Error(`Catalog ${collection}.version must be a non-negative integer.`);
    }
    const key = `${entry.id}\u0000${entry.version}`;
    if (seen.has(key)) throw new Error(`Catalog ${collection} contains duplicate ${entry.id}@${entry.version}.`);
    seen.add(key);
    for (const field of ['description', 'since']) {
      if (entry[field] !== undefined) assertString(entry[field], `${collection}.${field}`);
    }
    if (entry.deprecated !== undefined && typeof entry.deprecated !== 'boolean') {
      throw new Error(`Catalog ${collection}.deprecated must be boolean.`);
    }
    for (const field of ['targets', 'requiredCapabilities', 'requiredServices']) {
      if (entry[field] !== undefined) assertStringArray(entry[field], `${collection}.${field}`);
    }
    if (entry.valueKind !== undefined) assertString(entry.valueKind, `${collection}.valueKind`);
    for (const field of ['components', 'bytesPerPixel']) {
      if (entry[field] !== undefined) assertNumber(entry[field], `${collection}.${field}`);
    }
    for (const field of ['depth', 'filterable', 'renderable']) {
      if (entry[field] !== undefined && typeof entry[field] !== 'boolean') {
        throw new Error(`Catalog ${collection}.${field} must be boolean.`);
      }
    }
    if (collection === 'semantics' && entry.valueKind === undefined) {
      throw new Error('Catalog semantics.valueKind is required.');
    }
  }
}

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  if (!isRecord(value)) throw new Error('Catalog snapshot must be an object.');
  if (value.contractVersion !== CATALOG_SNAPSHOT_CONTRACT_VERSION) {
    throw new Error(`Unsupported Catalog snapshot contract version: ${String(value.contractVersion)}.`);
  }
  if (!isRecord(value.host)) throw new Error('Catalog host must be an object.');
  assertString(value.host.id, 'host.id');
  assertString(value.host.displayName, 'host.displayName');
  assertString(value.host.version, 'host.version');
  if (value.host.build !== undefined) assertString(value.host.build, 'host.build');
  if (!isRecord(value.supportedFormats)) throw new Error('Catalog supportedFormats must be an object.');
  for (const field of ['manifest', 'sourceComposition', 'settingsUi']) {
    const formats = value.supportedFormats[field];
    if (!Array.isArray(formats) || formats.some(item => !Number.isInteger(item) || item < 0)) {
      throw new Error(`Catalog supportedFormats.${field} must be an array of non-negative integers.`);
    }
  }
  for (const collection of ENTRY_COLLECTIONS) validateEntries(value[collection], collection);
  if (!isRecord(value.limits)) throw new Error('Catalog limits must be an object.');
  assertString(value.hash, 'hash');
  return value as unknown as CatalogSnapshot;
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`;
}

export function catalogSnapshotPayload(snapshot: CatalogSnapshot | CatalogSnapshotPayload): CatalogSnapshotPayload {
  const { hash: _hash, ...payload } = snapshot as CatalogSnapshot;
  return payload as CatalogSnapshotPayload;
}

export function canonicalizeCatalogSnapshot(snapshot: CatalogSnapshot | CatalogSnapshotPayload): string {
  const payload = catalogSnapshotPayload(snapshot);
  const normalized = {
    ...payload,
    supportedFormats: {
      manifest: [...payload.supportedFormats.manifest].sort((a, b) => a - b),
      sourceComposition: [...payload.supportedFormats.sourceComposition].sort((a, b) => a - b),
      settingsUi: [...payload.supportedFormats.settingsUi].sort((a, b) => a - b)
    }
  } as Record<string, unknown>;
  for (const collection of ENTRY_COLLECTIONS) {
    normalized[collection] = [...payload[collection]].sort((left, right) =>
      left.id.localeCompare(right.id) || left.version - right.version);
  }
  return canonicalValue(normalized);
}

export function computeCatalogSnapshotHash(snapshot: CatalogSnapshot | CatalogSnapshotPayload): string {
  return createHash('sha256').update(canonicalizeCatalogSnapshot(snapshot), 'utf8').digest('hex');
}

export function verifyCatalogSnapshotHash(snapshot: CatalogSnapshot): boolean {
  return snapshot.hash.toLowerCase() === computeCatalogSnapshotHash(snapshot);
}
