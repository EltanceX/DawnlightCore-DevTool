import { createHash } from 'node:crypto';
import type {
  DawnlightAnalyzerOverlay
} from './analyzer';

/** Independent versions for the runtime graph and program-variant payloads. */
export const RUNTIME_GRAPH_CONTRACT_VERSION = 1 as const;
export const VARIANT_EXPLAIN_CONTRACT_VERSION = 1 as const;

export const DEFAULT_RUNTIME_GRAPH_VERSIONS = Object.freeze([
  RUNTIME_GRAPH_CONTRACT_VERSION
]);
export const DEFAULT_VARIANT_EXPLAIN_VERSIONS = Object.freeze([
  VARIANT_EXPLAIN_CONTRACT_VERSION
]);

export type DawnlightRuntimeScalar = string | number | boolean | null;

export type DawnlightRuntimeProvenanceKind =
  | 'manifest'
  | 'fragment'
  | 'shader'
  | 'catalog'
  | 'generated'
  | 'runtime';

export interface DawnlightRuntimeProvenance {
  kind: DawnlightRuntimeProvenanceKind;
  /** Pack-relative, slash-normalized path. */
  file?: string;
  /** RFC 6901 JSON Pointer into `file`. */
  pointer?: string;
  /** Optional stable symbol/id when a source file is not sufficient. */
  symbol?: string;
  description?: string;
}

export interface DawnlightRuntimeProperty {
  name: string;
  value: DawnlightRuntimeScalar;
}

export interface DawnlightRuntimeRelatedInformation {
  message: string;
  provenance?: DawnlightRuntimeProvenance;
}

/** A graph/variant diagnostic is deliberately independent from LSP Diagnostic. */
export interface DawnlightRuntimeDiagnostic {
  severity: 'error' | 'warning' | 'information' | 'hint';
  /** Graph/variant diagnostics use stable DLMAN#### or DLGRAPH#### codes. */
  code: string;
  message: string;
  provenance?: DawnlightRuntimeProvenance;
  related?: readonly DawnlightRuntimeRelatedInformation[];
  /** Nodes involved in a hazard; all IDs must exist in the graph payload. */
  nodeIds?: readonly string[];
}

export interface DawnlightRuntimeInputs {
  options: Readonly<Record<string, DawnlightRuntimeScalar>>;
  capabilities: Readonly<Record<string, DawnlightRuntimeScalar>>;
}

export interface DawnlightRuntimeGraphRequestBase {
  packRoot: string;
  catalogHash: string;
  requestVersion: number;
  overlays: readonly DawnlightAnalyzerOverlay[];
  clientSupportedVersions: readonly number[];
  expectedManifestHash?: string;
  inputs: DawnlightRuntimeInputs;
}

export interface DawnlightAnalyzerDumpGraphParams extends DawnlightRuntimeGraphRequestBase {
  includeInactive: boolean;
}

export interface DawnlightAnalyzerExplainVariantParams extends DawnlightRuntimeGraphRequestBase {
  programId: string;
  /** Reserved for parity with dumpGraph; controls whether inactive graph links are included. */
  includeInactive?: boolean;
}

export type DawnlightRuntimeGraphNodeKind =
  | 'pass'
  | 'command'
  | 'program'
  | 'resource'
  | 'stage'
  | 'service'
  | 'drawProvider'
  | 'barrier'
  | 'external';

export interface DawnlightRuntimeGraphNode {
  id: string;
  kind: DawnlightRuntimeGraphNodeKind;
  label: string;
  active: boolean;
  order?: number;
  declaredId?: string;
  stage?: DawnlightRuntimeStage;
  phase?: string;
  provenance?: readonly DawnlightRuntimeProvenance[];
  properties?: readonly DawnlightRuntimeProperty[];
}

export type DawnlightRuntimeGraphEdgeKind =
  | 'sequence'
  | 'dependsOn'
  | 'invokes'
  | 'reads'
  | 'writes'
  | 'readWrites'
  | 'binds'
  | 'provides'
  | 'requires'
  | 'transitions'
  | 'commitsHistory'
  | 'targets';

export interface DawnlightRuntimeGraphEdge {
  id: string;
  kind: DawnlightRuntimeGraphEdgeKind;
  from: string;
  to: string;
  order?: number;
  label?: string;
  provenance?: readonly DawnlightRuntimeProvenance[];
}

export type DawnlightRuntimeGraphEventKind =
  | 'command'
  | 'read'
  | 'write'
  | 'readWrite'
  | 'clear'
  | 'bind'
  | 'drawBuffer'
  | 'historyCommit'
  | 'barrier'
  | 'dispatch'
  | 'draw';

export interface DawnlightRuntimeGraphEvent {
  id: string;
  kind: DawnlightRuntimeGraphEventKind;
  nodeId: string;
  order: number;
  resourceId?: string;
  bindingId?: string;
  drawBufferId?: string;
  provenance?: readonly DawnlightRuntimeProvenance[];
}

export type DawnlightRuntimeResourceKind =
  | 'texture'
  | 'buffer'
  | 'renderbuffer'
  | 'sampler'
  | 'image'
  | 'external';

export interface DawnlightRuntimeResourceLifetime {
  firstOrder?: number;
  lastOrder?: number;
  persistent: boolean;
  history: boolean;
}

export interface DawnlightRuntimeGraphResource {
  id: string;
  nodeId?: string;
  kind: DawnlightRuntimeResourceKind;
  lifetime: DawnlightRuntimeResourceLifetime;
  provenance?: readonly DawnlightRuntimeProvenance[];
}

export type DawnlightRuntimeBindingKind =
  | 'texture'
  | 'image'
  | 'buffer'
  | 'sampler'
  | 'uniform'
  | 'storage';

export type DawnlightRuntimeAccess = 'read' | 'write' | 'readWrite';
export type DawnlightRuntimeStage =
  | 'vertex'
  | 'fragment'
  | 'geometry'
  | 'compute'
  | 'task'
  | 'mesh'
  | 'service'
  | 'host'
  | 'unknown';

export interface DawnlightRuntimeGraphBinding {
  id: string;
  nodeId: string;
  resourceId?: string;
  kind: DawnlightRuntimeBindingKind;
  slot: string | number;
  access: DawnlightRuntimeAccess;
  stage?: DawnlightRuntimeStage;
  semantic?: string;
  provenance?: readonly DawnlightRuntimeProvenance[];
}

export interface DawnlightRuntimeGraphDrawBuffer {
  id: string;
  nodeId: string;
  location: number;
  resourceId?: string;
  semantic?: string;
  enabled: boolean;
  provenance?: readonly DawnlightRuntimeProvenance[];
}

export interface DawnlightRuntimeGraphHazard extends DawnlightRuntimeDiagnostic {
  code: string;
  nodeIds: readonly string[];
}

export interface DawnlightRuntimeGraphSnapshotPayload {
  contractVersion: typeof RUNTIME_GRAPH_CONTRACT_VERSION;
  /** Fingerprint of the resolved input set used for this graph. */
  variantFingerprint: string;
  nodes: readonly DawnlightRuntimeGraphNode[];
  edges: readonly DawnlightRuntimeGraphEdge[];
  executionOrder: readonly string[];
  events: readonly DawnlightRuntimeGraphEvent[];
  resources: readonly DawnlightRuntimeGraphResource[];
  bindings: readonly DawnlightRuntimeGraphBinding[];
  drawBuffers: readonly DawnlightRuntimeGraphDrawBuffer[];
  hazards: readonly DawnlightRuntimeGraphHazard[];
}

export interface DawnlightRuntimeGraphSnapshot extends DawnlightRuntimeGraphSnapshotPayload {
  /** SHA-256 of the canonical payload with `graphHash` omitted. */
  graphHash: string;
}

export interface DawnlightRuntimeResponseBase {
  requestVersion: number;
  /** Expected Catalog hash echoed by the Analyzer. */
  catalogHash: string;
  /** Manifest hash is present after a pack has been resolved. */
  manifestHash?: string;
  compatible: boolean;
  success: boolean;
  serverSupportedVersions: readonly number[];
  selectedVersion?: number;
  analyzerVersion?: string;
  diagnostics: readonly DawnlightRuntimeDiagnostic[];
}

export interface DawnlightAnalyzerDumpGraphResult extends DawnlightRuntimeResponseBase {
  graph?: DawnlightRuntimeGraphSnapshot;
}

export interface DawnlightVariantResolvedInput {
  id: string;
  value: DawnlightRuntimeScalar;
  source: 'request' | 'default' | 'catalog' | 'runtime';
  provenance?: DawnlightRuntimeProvenance;
}

export interface DawnlightVariantDefineSource {
  kind: 'literal' | 'option' | 'capability' | 'engineDefault' | 'runtime';
  id?: string;
  inputValue?: DawnlightRuntimeScalar;
  mapped?: boolean;
  provenance?: DawnlightRuntimeProvenance;
}

export interface DawnlightVariantDefine {
  name: string;
  defined: boolean;
  value?: DawnlightRuntimeScalar;
  source: DawnlightVariantDefineSource;
  reason?: string;
  provenance?: DawnlightRuntimeProvenance;
}

export interface DawnlightVariantSourceFile {
  stage: DawnlightRuntimeStage;
  file: string;
  entryPoint?: string;
  provenance?: DawnlightRuntimeProvenance;
}

export interface DawnlightVariantInclude {
  file: string;
  includedBy?: string;
  provenance?: DawnlightRuntimeProvenance;
}

export interface DawnlightVariantExplanationPayload {
  contractVersion: typeof VARIANT_EXPLAIN_CONTRACT_VERSION;
  programId: string;
  kind: 'graphics' | 'compute';
  active: boolean;
  inactiveReason?: string;
  compileMode?: string;
  /** SHA-256 fingerprint of program + resolved inputs + defines + sources. */
  variantFingerprint: string;
  sourceFiles: readonly DawnlightVariantSourceFile[];
  inputs: {
    options: readonly DawnlightVariantResolvedInput[];
    capabilities: readonly DawnlightVariantResolvedInput[];
  };
  defines: readonly DawnlightVariantDefine[];
  includes: readonly DawnlightVariantInclude[];
  graphNodeIds: readonly string[];
}

export interface DawnlightAnalyzerExplainVariantResult extends DawnlightRuntimeResponseBase {
  explanation?: DawnlightVariantExplanationPayload;
}

const HEX_HASH = /^[0-9a-f]{64}$/i;
const POINTER_ESCAPE = /~(?![01])/;
const GRAPH_DIAGNOSTIC = /^DLGRAPH\d{4}$/;
const MANIFEST_DIAGNOSTIC = /^DLMAN\d{4}$/;
const FILE_SEGMENT = /^[^\\/]+$/;

const NODE_KINDS = new Set<DawnlightRuntimeGraphNodeKind>([
  'pass', 'command', 'program', 'resource', 'stage', 'service', 'drawProvider', 'barrier', 'external'
]);
const EDGE_KINDS = new Set<DawnlightRuntimeGraphEdgeKind>([
  'sequence', 'dependsOn', 'invokes', 'reads', 'writes', 'readWrites', 'binds', 'provides',
  'requires', 'transitions', 'commitsHistory', 'targets'
]);
const EVENT_KINDS = new Set<DawnlightRuntimeGraphEventKind>([
  'command', 'read', 'write', 'readWrite', 'clear', 'bind', 'drawBuffer', 'historyCommit',
  'barrier', 'dispatch', 'draw'
]);
const RESOURCE_KINDS = new Set<DawnlightRuntimeResourceKind>([
  'texture', 'buffer', 'renderbuffer', 'sampler', 'image', 'external'
]);
const BINDING_KINDS = new Set<DawnlightRuntimeBindingKind>([
  'texture', 'image', 'buffer', 'sampler', 'uniform', 'storage'
]);
const STAGES = new Set<DawnlightRuntimeStage>([
  'vertex', 'fragment', 'geometry', 'compute', 'task', 'mesh', 'service', 'host', 'unknown'
]);
const PROVENANCE_KINDS = new Set<DawnlightRuntimeProvenanceKind>([
  'manifest', 'fragment', 'shader', 'catalog', 'generated', 'runtime'
]);
const INPUT_SOURCES = new Set(['request', 'default', 'catalog', 'runtime']);
const DEFINE_SOURCE_KINDS = new Set(['literal', 'option', 'capability', 'engineDefault', 'runtime']);
const SEVERITIES = new Set(['error', 'warning', 'information', 'hint']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Runtime ${field} must be an object.`);
}

function assertKnown(value: Record<string, unknown>, fields: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`Runtime ${field}.${key} is not part of the contract.`);
  }
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Runtime ${field} must be a non-empty string.`);
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined) assertString(value, field);
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Runtime ${field} must be a non-negative integer.`);
  }
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Runtime ${field} must be finite.`);
}

function isRuntimeScalar(value: unknown): value is DawnlightRuntimeScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
}

function assertScalar(value: unknown, field: string): asserts value is DawnlightRuntimeScalar {
  if (!isRuntimeScalar(value)) throw new Error(`Runtime ${field} must be a string, number, boolean, or null.`);
}

function assertHash(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (!HEX_HASH.test(value)) throw new Error(`Runtime ${field} must be a 64-character hexadecimal SHA-256 value.`);
}

function assertPointer(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (value !== '' && (!value.startsWith('/') || POINTER_ESCAPE.test(value))) {
    throw new Error(`Runtime ${field} must be an RFC 6901 JSON Pointer.`);
  }
}

function assertPackRelativeFile(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Runtime ${field} must be a pack-relative slash-normalized path.`);
  }
  const segments = value.split('/');
  if (segments.some(segment => !FILE_SEGMENT.test(segment) || segment === '.' || segment === '..')) {
    throw new Error(`Runtime ${field} must not contain traversal or empty path segments.`);
  }
}

function assertVersionList(value: unknown, field: string): asserts value is number[] {
  if (!Array.isArray(value) || value.some(item => !Number.isInteger(item) || item < 0) ||
    new Set(value).size !== value.length) {
    throw new Error(`Runtime ${field} must contain unique non-negative integer versions.`);
  }
}

function assertEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): asserts value is T {
  assertString(value, field);
  if (!allowed.has(value as T)) throw new Error(`Runtime ${field} has unsupported value '${value}'.`);
}

function parseProvenance(value: unknown, field: string): DawnlightRuntimeProvenance {
  assertRecord(value, field);
  assertKnown(value, new Set(['kind', 'file', 'pointer', 'symbol', 'description']), field);
  assertEnum(value.kind, PROVENANCE_KINDS, `${field}.kind`);
  if (value.file !== undefined) assertPackRelativeFile(value.file, `${field}.file`);
  if (value.pointer !== undefined) assertPointer(value.pointer, `${field}.pointer`);
  if (value.symbol !== undefined) assertString(value.symbol, `${field}.symbol`);
  if (value.description !== undefined) assertString(value.description, `${field}.description`);
  return value as unknown as DawnlightRuntimeProvenance;
}

function parseProvenanceList(value: unknown, field: string): readonly DawnlightRuntimeProvenance[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Runtime ${field} must be a non-empty array.`);
  return value.map((item, index) => parseProvenance(item, `${field}[${index}]`));
}

function parseScalarRecord(value: unknown, field: string): Readonly<Record<string, DawnlightRuntimeScalar>> {
  assertRecord(value, field);
  const result: Record<string, DawnlightRuntimeScalar> = {};
  for (const [key, item] of Object.entries(value)) {
    assertString(key, `${field} key`);
    assertScalar(item, `${field}.${key}`);
    result[key] = item;
  }
  return result;
}

function parseInputs(value: unknown, field: string): DawnlightRuntimeInputs {
  assertRecord(value, field);
  assertKnown(value, new Set(['options', 'capabilities']), field);
  return {
    options: parseScalarRecord(value.options, `${field}.options`),
    capabilities: parseScalarRecord(value.capabilities, `${field}.capabilities`)
  };
}

function parseOverlayList(value: unknown, field: string): readonly DawnlightAnalyzerOverlay[] {
  if (!Array.isArray(value)) throw new Error(`Runtime ${field} must be an array.`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const entryField = `${field}[${index}]`;
    assertRecord(item, entryField);
    assertKnown(item, new Set(['path', 'version', 'content']), entryField);
    assertPackRelativeFile(item.path, `${entryField}.path`);
    assertInteger(item.version, `${entryField}.version`);
    if (typeof item.content !== 'string') throw new Error(`Runtime ${entryField}.content must be a string.`);
    if (seen.has(item.path)) throw new Error(`Runtime ${field} contains duplicate path '${item.path}'.`);
    seen.add(item.path);
    return item as unknown as DawnlightAnalyzerOverlay;
  });
}

function parseRequestBase(value: unknown, field: string): DawnlightRuntimeGraphRequestBase {
  assertRecord(value, field);
  assertString(value.packRoot, `${field}.packRoot`);
  assertHash(value.catalogHash, `${field}.catalogHash`);
  assertInteger(value.requestVersion, `${field}.requestVersion`);
  const overlays = parseOverlayList(value.overlays, `${field}.overlays`);
  assertVersionList(value.clientSupportedVersions, `${field}.clientSupportedVersions`);
  if (value.clientSupportedVersions.length === 0) {
    throw new Error(`Runtime ${field}.clientSupportedVersions must not be empty.`);
  }
  if (value.expectedManifestHash !== undefined) assertHash(value.expectedManifestHash, `${field}.expectedManifestHash`);
  return {
    packRoot: value.packRoot,
    catalogHash: value.catalogHash,
    requestVersion: value.requestVersion,
    overlays,
    clientSupportedVersions: value.clientSupportedVersions,
    expectedManifestHash: value.expectedManifestHash as string | undefined,
    inputs: parseInputs(value.inputs, `${field}.inputs`)
  };
}

export function parseDawnlightAnalyzerDumpGraphParams(value: unknown): DawnlightAnalyzerDumpGraphParams {
  const base = parseRequestBase(value, 'dumpGraph params');
  const record = value as Record<string, unknown>;
  assertKnown(record, new Set([
    'packRoot', 'catalogHash', 'requestVersion', 'overlays', 'clientSupportedVersions',
    'expectedManifestHash', 'inputs', 'includeInactive'
  ]), 'dumpGraph params');
  if (typeof record.includeInactive !== 'boolean') throw new Error('Runtime dumpGraph params.includeInactive must be boolean.');
  return { ...base, includeInactive: record.includeInactive };
}

export function parseDawnlightAnalyzerExplainVariantParams(value: unknown): DawnlightAnalyzerExplainVariantParams {
  const base = parseRequestBase(value, 'explainVariant params');
  const record = value as Record<string, unknown>;
  assertKnown(record, new Set([
    'packRoot', 'catalogHash', 'requestVersion', 'overlays', 'clientSupportedVersions',
    'expectedManifestHash', 'inputs', 'programId', 'includeInactive'
  ]), 'explainVariant params');
  assertString(record.programId, 'explainVariant params.programId');
  if (record.includeInactive !== undefined && typeof record.includeInactive !== 'boolean') {
    throw new Error('Runtime explainVariant params.includeInactive must be boolean.');
  }
  return { ...base, programId: record.programId, includeInactive: record.includeInactive as boolean | undefined };
}

function parseProperty(value: unknown, field: string): DawnlightRuntimeProperty {
  assertRecord(value, field);
  assertKnown(value, new Set(['name', 'value']), field);
  assertString(value.name, `${field}.name`);
  assertScalar(value.value, `${field}.value`);
  return value as unknown as DawnlightRuntimeProperty;
}

function parseNode(value: unknown, field: string): DawnlightRuntimeGraphNode {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'kind', 'label', 'active', 'order', 'declaredId', 'stage', 'phase', 'provenance', 'properties']), field);
  assertString(value.id, `${field}.id`);
  assertEnum(value.kind, NODE_KINDS, `${field}.kind`);
  assertString(value.label, `${field}.label`);
  if (typeof value.active !== 'boolean') throw new Error(`Runtime ${field}.active must be boolean.`);
  if (value.order !== undefined) assertInteger(value.order, `${field}.order`);
  if (value.declaredId !== undefined) assertString(value.declaredId, `${field}.declaredId`);
  if (value.stage !== undefined) assertEnum(value.stage, STAGES, `${field}.stage`);
  if (value.phase !== undefined) assertString(value.phase, `${field}.phase`);
  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) throw new Error(`Runtime ${field}.provenance must be an array.`);
    value.provenance.forEach((item, index) => parseProvenance(item, `${field}.provenance[${index}]`));
  }
  if (value.properties !== undefined) {
    if (!Array.isArray(value.properties)) throw new Error(`Runtime ${field}.properties must be an array.`);
    const names = new Set<string>();
    value.properties.forEach((item, index) => {
      const property = parseProperty(item, `${field}.properties[${index}]`);
      if (names.has(property.name)) throw new Error(`Runtime ${field}.properties contains duplicate '${property.name}'.`);
      names.add(property.name);
    });
  }
  return value as unknown as DawnlightRuntimeGraphNode;
}

function parseEdge(value: unknown, field: string): DawnlightRuntimeGraphEdge {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'kind', 'from', 'to', 'order', 'label', 'provenance']), field);
  assertString(value.id, `${field}.id`);
  assertEnum(value.kind, EDGE_KINDS, `${field}.kind`);
  assertString(value.from, `${field}.from`);
  assertString(value.to, `${field}.to`);
  if (value.order !== undefined) assertInteger(value.order, `${field}.order`);
  if (value.label !== undefined) assertString(value.label, `${field}.label`);
  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) throw new Error(`Runtime ${field}.provenance must be an array.`);
    value.provenance.forEach((item, index) => parseProvenance(item, `${field}.provenance[${index}]`));
  }
  return value as unknown as DawnlightRuntimeGraphEdge;
}

function parseEvent(value: unknown, field: string): DawnlightRuntimeGraphEvent {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'kind', 'nodeId', 'order', 'resourceId', 'bindingId', 'drawBufferId', 'provenance']), field);
  assertString(value.id, `${field}.id`);
  assertEnum(value.kind, EVENT_KINDS, `${field}.kind`);
  assertString(value.nodeId, `${field}.nodeId`);
  assertInteger(value.order, `${field}.order`);
  for (const key of ['resourceId', 'bindingId', 'drawBufferId']) {
    if (value[key] !== undefined) assertString(value[key], `${field}.${key}`);
  }
  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) throw new Error(`Runtime ${field}.provenance must be an array.`);
    value.provenance.forEach((item, index) => parseProvenance(item, `${field}.provenance[${index}]`));
  }
  return value as unknown as DawnlightRuntimeGraphEvent;
}

function parseResource(value: unknown, field: string): DawnlightRuntimeGraphResource {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'nodeId', 'kind', 'lifetime', 'provenance']), field);
  assertString(value.id, `${field}.id`);
  if (value.nodeId !== undefined) assertString(value.nodeId, `${field}.nodeId`);
  assertEnum(value.kind, RESOURCE_KINDS, `${field}.kind`);
  assertRecord(value.lifetime, `${field}.lifetime`);
  assertKnown(value.lifetime, new Set(['firstOrder', 'lastOrder', 'persistent', 'history']), `${field}.lifetime`);
  if (value.lifetime.firstOrder !== undefined) assertInteger(value.lifetime.firstOrder, `${field}.lifetime.firstOrder`);
  if (value.lifetime.lastOrder !== undefined) assertInteger(value.lifetime.lastOrder, `${field}.lifetime.lastOrder`);
  if (value.lifetime.firstOrder !== undefined && value.lifetime.lastOrder !== undefined &&
    value.lifetime.firstOrder > value.lifetime.lastOrder) {
    throw new Error(`Runtime ${field}.lifetime.firstOrder cannot exceed lastOrder.`);
  }
  if (typeof value.lifetime.persistent !== 'boolean' || typeof value.lifetime.history !== 'boolean') {
    throw new Error(`Runtime ${field}.lifetime.persistent/history must be boolean.`);
  }
  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) throw new Error(`Runtime ${field}.provenance must be an array.`);
    value.provenance.forEach((item, index) => parseProvenance(item, `${field}.provenance[${index}]`));
  }
  return value as unknown as DawnlightRuntimeGraphResource;
}

function parseBinding(value: unknown, field: string): DawnlightRuntimeGraphBinding {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'nodeId', 'resourceId', 'kind', 'slot', 'access', 'stage', 'semantic', 'provenance']), field);
  assertString(value.id, `${field}.id`);
  assertString(value.nodeId, `${field}.nodeId`);
  if (value.resourceId !== undefined) assertString(value.resourceId, `${field}.resourceId`);
  assertEnum(value.kind, BINDING_KINDS, `${field}.kind`);
  if (!(typeof value.slot === 'string' || (typeof value.slot === 'number' && Number.isInteger(value.slot) && value.slot >= 0))) {
    throw new Error(`Runtime ${field}.slot must be a non-negative integer or string.`);
  }
  assertEnum(value.access, new Set<DawnlightRuntimeAccess>(['read', 'write', 'readWrite']), `${field}.access`);
  if (value.stage !== undefined) assertEnum(value.stage, STAGES, `${field}.stage`);
  if (value.semantic !== undefined) assertString(value.semantic, `${field}.semantic`);
  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) throw new Error(`Runtime ${field}.provenance must be an array.`);
    value.provenance.forEach((item, index) => parseProvenance(item, `${field}.provenance[${index}]`));
  }
  return value as unknown as DawnlightRuntimeGraphBinding;
}

function parseDrawBuffer(value: unknown, field: string): DawnlightRuntimeGraphDrawBuffer {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'nodeId', 'location', 'resourceId', 'semantic', 'enabled', 'provenance']), field);
  assertString(value.id, `${field}.id`);
  assertString(value.nodeId, `${field}.nodeId`);
  assertInteger(value.location, `${field}.location`);
  if (value.resourceId !== undefined) assertString(value.resourceId, `${field}.resourceId`);
  if (value.semantic !== undefined) assertString(value.semantic, `${field}.semantic`);
  if (typeof value.enabled !== 'boolean') throw new Error(`Runtime ${field}.enabled must be boolean.`);
  if (value.provenance !== undefined) {
    if (!Array.isArray(value.provenance)) throw new Error(`Runtime ${field}.provenance must be an array.`);
    value.provenance.forEach((item, index) => parseProvenance(item, `${field}.provenance[${index}]`));
  }
  return value as unknown as DawnlightRuntimeGraphDrawBuffer;
}

function parseDiagnostic(value: unknown, field: string, graphOnly = false): DawnlightRuntimeDiagnostic {
  assertRecord(value, field);
  assertKnown(value, new Set(['severity', 'code', 'message', 'provenance', 'related', 'nodeIds']), field);
  assertEnum(value.severity, SEVERITIES, `${field}.severity`);
  assertString(value.code, `${field}.code`);
  if (!(graphOnly ? GRAPH_DIAGNOSTIC.test(value.code) :
    (GRAPH_DIAGNOSTIC.test(value.code) || MANIFEST_DIAGNOSTIC.test(value.code)))) {
    throw new Error(`Runtime ${field}.code must be a stable graph/manifest diagnostic code.`);
  }
  assertString(value.message, `${field}.message`);
  if (value.provenance !== undefined) parseProvenance(value.provenance, `${field}.provenance`);
  if (value.related !== undefined) {
    if (!Array.isArray(value.related)) throw new Error(`Runtime ${field}.related must be an array.`);
    value.related.forEach((item, index) => {
      const relatedField = `${field}.related[${index}]`;
      assertRecord(item, relatedField);
      assertKnown(item, new Set(['message', 'provenance']), relatedField);
      assertString(item.message, `${relatedField}.message`);
      if (item.provenance !== undefined) parseProvenance(item.provenance, `${relatedField}.provenance`);
    });
  }
  if (value.nodeIds !== undefined) {
    if (!Array.isArray(value.nodeIds) || value.nodeIds.some(item => typeof item !== 'string' || item.length === 0) ||
      new Set(value.nodeIds).size !== value.nodeIds.length) {
      throw new Error(`Runtime ${field}.nodeIds must contain unique non-empty IDs.`);
    }
  }
  return value as unknown as DawnlightRuntimeDiagnostic;
}

function parseGraphSnapshot(value: unknown): DawnlightRuntimeGraphSnapshot {
  assertRecord(value, 'graph');
  assertKnown(value, new Set([
    'contractVersion', 'graphHash', 'variantFingerprint', 'nodes', 'edges', 'executionOrder',
    'events', 'resources', 'bindings', 'drawBuffers', 'hazards'
  ]), 'graph');
  if (value.contractVersion !== RUNTIME_GRAPH_CONTRACT_VERSION) {
    throw new Error(`Unsupported runtime graph contract version: ${String(value.contractVersion)}.`);
  }
  assertHash(value.graphHash, 'graph.graphHash');
  assertHash(value.variantFingerprint, 'graph.variantFingerprint');
  const nodes = Array.isArray(value.nodes) ? value.nodes.map((item, index) => parseNode(item, `graph.nodes[${index}]`)) :
    (() => { throw new Error('Runtime graph.nodes must be an array.'); })();
  const edges = Array.isArray(value.edges) ? value.edges.map((item, index) => parseEdge(item, `graph.edges[${index}]`)) :
    (() => { throw new Error('Runtime graph.edges must be an array.'); })();
  const executionOrder = value.executionOrder;
  if (!Array.isArray(executionOrder) || executionOrder.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error('Runtime graph.executionOrder must be an array of IDs.');
  }
  const events = Array.isArray(value.events) ? value.events.map((item, index) => parseEvent(item, `graph.events[${index}]`)) :
    (() => { throw new Error('Runtime graph.events must be an array.'); })();
  const resources = Array.isArray(value.resources) ? value.resources.map((item, index) => parseResource(item, `graph.resources[${index}]`)) :
    (() => { throw new Error('Runtime graph.resources must be an array.'); })();
  const bindings = Array.isArray(value.bindings) ? value.bindings.map((item, index) => parseBinding(item, `graph.bindings[${index}]`)) :
    (() => { throw new Error('Runtime graph.bindings must be an array.'); })();
  const drawBuffers = Array.isArray(value.drawBuffers) ? value.drawBuffers.map((item, index) => parseDrawBuffer(item, `graph.drawBuffers[${index}]`)) :
    (() => { throw new Error('Runtime graph.drawBuffers must be an array.'); })();
  const hazards = Array.isArray(value.hazards) ? value.hazards.map((item, index) => {
    const hazard = parseDiagnostic(item, `graph.hazards[${index}]`, true);
    if (!hazard.nodeIds || hazard.nodeIds.length === 0) throw new Error(`Runtime graph.hazards[${index}].nodeIds is required.`);
    return hazard as DawnlightRuntimeGraphHazard;
  }) : (() => { throw new Error('Runtime graph.hazards must be an array.'); })();
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Runtime graph contains duplicate node '${node.id}'.`);
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Runtime graph contains duplicate edge '${edge.id}'.`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Runtime graph edge '${edge.id}' references an unknown node.`);
  }
  const orderIds = new Set<string>();
  for (const id of executionOrder) {
    if (orderIds.has(id) || !nodeIds.has(id)) throw new Error(`Runtime graph.executionOrder references an invalid or duplicate node '${id}'.`);
    orderIds.add(id);
  }
  const resourceIds = new Set<string>();
  for (const resource of resources) {
    if (resourceIds.has(resource.id)) throw new Error(`Runtime graph contains duplicate resource '${resource.id}'.`);
    resourceIds.add(resource.id);
    if (resource.nodeId !== undefined && !nodeIds.has(resource.nodeId)) throw new Error(`Runtime resource '${resource.id}' references an unknown node.`);
  }
  const bindingIds = new Set<string>();
  for (const binding of bindings) {
    if (bindingIds.has(binding.id)) throw new Error(`Runtime graph contains duplicate binding '${binding.id}'.`);
    bindingIds.add(binding.id);
    if (!nodeIds.has(binding.nodeId)) throw new Error(`Runtime binding '${binding.id}' references an unknown node.`);
    if (binding.resourceId !== undefined && !resourceIds.has(binding.resourceId)) throw new Error(`Runtime binding '${binding.id}' references an unknown resource.`);
  }
  const drawBufferIds = new Set<string>();
  for (const drawBuffer of drawBuffers) {
    if (drawBufferIds.has(drawBuffer.id)) throw new Error(`Runtime graph contains duplicate draw buffer '${drawBuffer.id}'.`);
    drawBufferIds.add(drawBuffer.id);
    if (!nodeIds.has(drawBuffer.nodeId)) throw new Error(`Runtime draw buffer '${drawBuffer.id}' references an unknown node.`);
    if (drawBuffer.resourceId !== undefined && !resourceIds.has(drawBuffer.resourceId)) throw new Error(`Runtime draw buffer '${drawBuffer.id}' references an unknown resource.`);
  }
  const eventIds = new Set<string>();
  for (const event of events) {
    if (eventIds.has(event.id)) throw new Error(`Runtime graph contains duplicate event '${event.id}'.`);
    eventIds.add(event.id);
    if (!nodeIds.has(event.nodeId)) throw new Error(`Runtime event '${event.id}' references an unknown node.`);
    if (event.resourceId !== undefined && !resourceIds.has(event.resourceId)) throw new Error(`Runtime event '${event.id}' references an unknown resource.`);
    if (event.bindingId !== undefined && !bindingIds.has(event.bindingId)) throw new Error(`Runtime event '${event.id}' references an unknown binding.`);
    if (event.drawBufferId !== undefined && !drawBufferIds.has(event.drawBufferId)) throw new Error(`Runtime event '${event.id}' references an unknown draw buffer.`);
  }
  for (const hazard of hazards) {
    if (hazard.nodeIds.some(id => !nodeIds.has(id))) throw new Error('Runtime graph hazard references an unknown node.');
  }
  const payload = { ...value } as unknown as DawnlightRuntimeGraphSnapshotPayload;
  if (computeRuntimeGraphHash(payload) !== String(value.graphHash).toLowerCase()) {
    throw new Error('Runtime graph.graphHash does not match the canonical graph payload.');
  }
  return value as unknown as DawnlightRuntimeGraphSnapshot;
}

function parseVariantResolvedInput(value: unknown, field: string): DawnlightVariantResolvedInput {
  assertRecord(value, field);
  assertKnown(value, new Set(['id', 'value', 'source', 'provenance']), field);
  assertString(value.id, `${field}.id`);
  assertScalar(value.value, `${field}.value`);
  assertString(value.source, `${field}.source`);
  if (!INPUT_SOURCES.has(value.source)) throw new Error(`Runtime ${field}.source is unsupported.`);
  if (value.provenance !== undefined) parseProvenance(value.provenance, `${field}.provenance`);
  return value as unknown as DawnlightVariantResolvedInput;
}

function parseDefineSource(value: unknown, field: string): DawnlightVariantDefineSource {
  assertRecord(value, field);
  assertKnown(value, new Set(['kind', 'id', 'inputValue', 'mapped', 'provenance']), field);
  assertString(value.kind, `${field}.kind`);
  if (!DEFINE_SOURCE_KINDS.has(value.kind)) throw new Error(`Runtime ${field}.kind is unsupported.`);
  if (value.id !== undefined) assertString(value.id, `${field}.id`);
  if (value.inputValue !== undefined) assertScalar(value.inputValue, `${field}.inputValue`);
  if (value.mapped !== undefined && typeof value.mapped !== 'boolean') throw new Error(`Runtime ${field}.mapped must be boolean.`);
  if (value.provenance !== undefined) parseProvenance(value.provenance, `${field}.provenance`);
  return value as unknown as DawnlightVariantDefineSource;
}

function parseVariantDefine(value: unknown, field: string): DawnlightVariantDefine {
  assertRecord(value, field);
  assertKnown(value, new Set(['name', 'defined', 'value', 'source', 'reason', 'provenance']), field);
  assertString(value.name, `${field}.name`);
  if (typeof value.defined !== 'boolean') throw new Error(`Runtime ${field}.defined must be boolean.`);
  if (value.value !== undefined) assertScalar(value.value, `${field}.value`);
  if (value.defined && value.value === undefined) throw new Error(`Runtime ${field}.value is required when defined.`);
  if (value.reason !== undefined) assertString(value.reason, `${field}.reason`);
  parseDefineSource(value.source, `${field}.source`);
  if (value.provenance !== undefined) parseProvenance(value.provenance, `${field}.provenance`);
  return value as unknown as DawnlightVariantDefine;
}

function parseExplanation(value: unknown): DawnlightVariantExplanationPayload {
  assertRecord(value, 'explanation');
  assertKnown(value, new Set([
    'contractVersion', 'programId', 'kind', 'active', 'inactiveReason', 'compileMode',
    'variantFingerprint', 'sourceFiles', 'inputs', 'defines', 'includes', 'graphNodeIds'
  ]), 'explanation');
  if (value.contractVersion !== VARIANT_EXPLAIN_CONTRACT_VERSION) throw new Error(`Unsupported variant explain contract version: ${String(value.contractVersion)}.`);
  assertString(value.programId, 'explanation.programId');
  if (value.kind !== 'graphics' && value.kind !== 'compute') throw new Error('Runtime explanation.kind is unsupported.');
  if (typeof value.active !== 'boolean') throw new Error('Runtime explanation.active must be boolean.');
  if (!value.active && value.inactiveReason === undefined) throw new Error('Runtime explanation.inactiveReason is required when inactive.');
  if (value.inactiveReason !== undefined) assertString(value.inactiveReason, 'explanation.inactiveReason');
  if (value.compileMode !== undefined) assertString(value.compileMode, 'explanation.compileMode');
  assertHash(value.variantFingerprint, 'explanation.variantFingerprint');
  if (!Array.isArray(value.sourceFiles)) throw new Error('Runtime explanation.sourceFiles must be an array.');
  value.sourceFiles.forEach((item, index) => {
    const field = `explanation.sourceFiles[${index}]`;
    assertRecord(item, field);
    assertKnown(item, new Set(['stage', 'file', 'entryPoint', 'provenance']), field);
    assertEnum(item.stage, STAGES, `${field}.stage`);
    assertPackRelativeFile(item.file, `${field}.file`);
    if (item.entryPoint !== undefined) assertString(item.entryPoint, `${field}.entryPoint`);
    if (item.provenance !== undefined) parseProvenance(item.provenance, `${field}.provenance`);
  });
  assertRecord(value.inputs, 'explanation.inputs');
  assertKnown(value.inputs, new Set(['options', 'capabilities']), 'explanation.inputs');
  for (const key of ['options', 'capabilities']) {
    if (!Array.isArray(value.inputs[key])) throw new Error(`Runtime explanation.inputs.${key} must be an array.`);
    const ids = new Set<string>();
    value.inputs[key].forEach((item, index) => {
      const parsed = parseVariantResolvedInput(item, `explanation.inputs.${key}[${index}]`);
      if (ids.has(parsed.id)) throw new Error(`Runtime explanation.inputs.${key} contains duplicate '${parsed.id}'.`);
      ids.add(parsed.id);
    });
  }
  if (!Array.isArray(value.defines)) throw new Error('Runtime explanation.defines must be an array.');
  const defineNames = new Set<string>();
  value.defines.forEach((item, index) => {
    const parsed = parseVariantDefine(item, `explanation.defines[${index}]`);
    if (defineNames.has(parsed.name)) throw new Error(`Runtime explanation.defines contains duplicate '${parsed.name}'.`);
    defineNames.add(parsed.name);
  });
  if (!Array.isArray(value.includes)) throw new Error('Runtime explanation.includes must be an array.');
  const includeFiles = new Set<string>();
  value.includes.forEach((item, index) => {
    const field = `explanation.includes[${index}]`;
    assertRecord(item, field);
    assertKnown(item, new Set(['file', 'includedBy', 'provenance']), field);
    assertPackRelativeFile(item.file, `${field}.file`);
    if (item.includedBy !== undefined) assertPackRelativeFile(item.includedBy, `${field}.includedBy`);
    if (item.provenance !== undefined) parseProvenance(item.provenance, `${field}.provenance`);
    if (includeFiles.has(item.file)) throw new Error(`Runtime explanation.includes contains duplicate '${item.file}'.`);
    includeFiles.add(item.file);
  });
  if (!Array.isArray(value.graphNodeIds) || value.graphNodeIds.some(item => typeof item !== 'string' || item.length === 0) ||
    new Set(value.graphNodeIds).size !== value.graphNodeIds.length) {
    throw new Error('Runtime explanation.graphNodeIds must contain unique IDs.');
  }
  return value as unknown as DawnlightVariantExplanationPayload;
}

function parseRuntimeResponseBase(
  value: unknown,
  field: string,
  payloadField: 'graph' | 'explanation'
): DawnlightRuntimeResponseBase {
  assertRecord(value, field);
  assertKnown(value, new Set([
    'requestVersion', 'catalogHash', 'manifestHash', 'compatible', 'success',
    'serverSupportedVersions', 'selectedVersion', 'analyzerVersion', 'diagnostics', payloadField
  ]), field);
  assertInteger(value.requestVersion, `${field}.requestVersion`);
  assertHash(value.catalogHash, `${field}.catalogHash`);
  if (value.manifestHash !== undefined) assertHash(value.manifestHash, `${field}.manifestHash`);
  if (typeof value.compatible !== 'boolean' || typeof value.success !== 'boolean') throw new Error(`Runtime ${field}.compatible/success must be boolean.`);
  assertVersionList(value.serverSupportedVersions, `${field}.serverSupportedVersions`);
  if (value.selectedVersion !== undefined) assertInteger(value.selectedVersion, `${field}.selectedVersion`);
  if (value.serverSupportedVersions.length === 0) throw new Error(`Runtime ${field}.serverSupportedVersions must not be empty.`);
  if (value.selectedVersion !== undefined && !value.serverSupportedVersions.includes(value.selectedVersion)) {
    throw new Error(`Runtime ${field}.selectedVersion must be advertised by serverSupportedVersions.`);
  }
  if (value.compatible !== (value.selectedVersion !== undefined)) {
    throw new Error(`Runtime ${field}.compatible must agree with selectedVersion presence.`);
  }
  if (value.analyzerVersion !== undefined) assertString(value.analyzerVersion, `${field}.analyzerVersion`);
  if (!Array.isArray(value.diagnostics)) throw new Error(`Runtime ${field}.diagnostics must be an array.`);
  const diagnostics = value.diagnostics.map((item, index) => parseDiagnostic(item, `${field}.diagnostics[${index}]`));
  if (!value.success && diagnostics.length === 0) throw new Error(`Runtime ${field}.diagnostics is required for unsuccessful responses.`);
  if (value.success && diagnostics.some(item => item.severity === 'error')) throw new Error(`Runtime ${field}.success cannot contain error diagnostics.`);
  return {
    requestVersion: value.requestVersion,
    catalogHash: value.catalogHash,
    manifestHash: value.manifestHash as string | undefined,
    compatible: value.compatible,
    success: value.success,
    serverSupportedVersions: value.serverSupportedVersions,
    selectedVersion: value.selectedVersion as number | undefined,
    analyzerVersion: value.analyzerVersion as string | undefined,
    diagnostics
  };
}

function assertResponseNegotiation(base: DawnlightRuntimeResponseBase, contractVersion: number, payload: unknown, field: string): void {
  if (base.compatible && base.selectedVersion !== contractVersion) {
    throw new Error(`Runtime ${field}.selectedVersion does not match payload contract version.`);
  }
  if (base.compatible && base.success && base.manifestHash === undefined) {
    throw new Error(`Runtime ${field}.manifestHash is required for a successful response.`);
  }
  if (base.success !== (payload !== undefined)) {
    throw new Error(`Runtime ${field}.success must agree with payload presence.`);
  }
  if (!base.compatible && payload !== undefined) throw new Error(`Runtime ${field} must omit payload when incompatible.`);
  if (!base.compatible && base.selectedVersion !== undefined) throw new Error(`Runtime ${field} must omit selectedVersion when incompatible.`);
}

export function parseDawnlightAnalyzerDumpGraphResult(value: unknown): DawnlightAnalyzerDumpGraphResult {
  const base = parseRuntimeResponseBase(value, 'dumpGraph result', 'graph');
  const record = value as Record<string, unknown>;
  const graph = record.graph === undefined ? undefined : parseGraphSnapshot(record.graph);
  assertResponseNegotiation(base, RUNTIME_GRAPH_CONTRACT_VERSION, graph, 'dumpGraph result');
  return { ...base, graph };
}

export function parseDawnlightAnalyzerExplainVariantResult(value: unknown): DawnlightAnalyzerExplainVariantResult {
  const base = parseRuntimeResponseBase(value, 'explainVariant result', 'explanation');
  const record = value as Record<string, unknown>;
  const explanation = record.explanation === undefined ? undefined : parseExplanation(record.explanation);
  assertResponseNegotiation(base, VARIANT_EXPLAIN_CONTRACT_VERSION, explanation, 'explainVariant result');
  return { ...base, explanation };
}

function canonicalRuntimeValue(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRuntimeValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalRuntimeValue(record[key])}`).join(',')}}`;
}

export function runtimeGraphPayload(snapshot: DawnlightRuntimeGraphSnapshot | DawnlightRuntimeGraphSnapshotPayload): DawnlightRuntimeGraphSnapshotPayload {
  const { graphHash: _graphHash, ...payload } = snapshot as DawnlightRuntimeGraphSnapshot;
  return payload as DawnlightRuntimeGraphSnapshotPayload;
}

export function canonicalizeRuntimeGraph(snapshot: DawnlightRuntimeGraphSnapshot | DawnlightRuntimeGraphSnapshotPayload): string {
  return canonicalRuntimeValue(runtimeGraphPayload(snapshot));
}

export function computeRuntimeGraphHash(snapshot: DawnlightRuntimeGraphSnapshot | DawnlightRuntimeGraphSnapshotPayload): string {
  return createHash('sha256').update(canonicalizeRuntimeGraph(snapshot), 'utf8').digest('hex');
}

export function verifyRuntimeGraphHash(snapshot: DawnlightRuntimeGraphSnapshot): boolean {
  return snapshot.graphHash.toLowerCase() === computeRuntimeGraphHash(snapshot);
}
