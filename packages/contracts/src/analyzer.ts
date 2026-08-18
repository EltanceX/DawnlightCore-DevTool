import { CONTRACT_VERSIONS } from './versions';
import {
  CatalogSnapshot,
  parseCatalogSnapshot,
  verifyCatalogSnapshotHash
} from './catalog';

export const ANALYZER_METHODS = Object.freeze({
  initialize: 'dawnlight/initialize',
  getCatalog: 'dawnlight/getCatalog',
  validatePack: 'dawnlight/validatePack',
  dumpGraph: 'dawnlight/dumpGraph',
  explainVariant: 'dawnlight/explainVariant',
  shutdown: 'dawnlight/shutdown'
} as const);

export type AnalyzerDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface DawnlightAnalyzerInitializeParams {
  protocolVersion: number;
  clientSupportedVersions: readonly number[];
  catalogHash?: string;
}

export interface DawnlightAnalyzerInitializeResult {
  protocolVersion: number;
  serverSupportedVersions: readonly number[];
  selectedVersion?: number;
  compatible: boolean;
  analyzerVersion?: string;
}

/**
 * Parameters for the optional Catalog export request.
 *
 * The list is intentionally independent from the Analyzer protocol version:
 * an Analyzer can speak protocol v1 while exporting a newer Catalog contract
 * (or vice versa).  `expectedCatalogHash` is an advisory value supplied by
 * the client so a sidecar cannot silently replace the active Catalog.
 */
export interface DawnlightAnalyzerGetCatalogParams {
  clientSupportedVersions?: readonly number[];
  expectedCatalogHash?: string;
}

/** Result returned by `dawnlight/getCatalog`. */
export interface DawnlightAnalyzerGetCatalogResult {
  snapshot: CatalogSnapshot;
  catalogHash: string;
  selectedVersion?: number;
  compatible: boolean;
  serverSupportedVersions?: readonly number[];
  analyzerVersion?: string;
}

export interface DawnlightAnalyzerOverlay {
  path: string;
  version: number;
  content: string;
}

export interface DawnlightAnalyzerValidatePackParams {
  packRoot: string;
  catalogHash: string;
  requestVersion: number;
  overlays: readonly DawnlightAnalyzerOverlay[];
}

export interface DawnlightAnalyzerRelatedInformation {
  file: string;
  pointer?: string;
  message: string;
}

export interface DawnlightAnalyzerDiagnostic {
  severity: AnalyzerDiagnosticSeverity;
  code: string;
  file: string;
  pointer?: string;
  message: string;
  related?: readonly DawnlightAnalyzerRelatedInformation[];
}

export interface DawnlightAnalyzerValidatePackResult {
  valid: boolean;
  requestVersion: number;
  manifestHash?: string;
  diagnostics: readonly DawnlightAnalyzerDiagnostic[];
}

export type DawnlightAnalyzerStatusKind = 'disabled' | 'starting' | 'ready' | 'validating' | 'offline';

export interface DawnlightAnalyzerStatus {
  state: DawnlightAnalyzerStatusKind;
  path?: string;
  restartCount: number;
  lastError?: string;
  protocolVersion?: number;
}

export const DEFAULT_ANALYZER_PROTOCOL_VERSIONS = Object.freeze([
  CONTRACT_VERSIONS.analyzerProtocol
]);

export const DEFAULT_CATALOG_SNAPSHOT_VERSIONS = Object.freeze([
  CONTRACT_VERSIONS.catalogSnapshot
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersionList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 0);
}

/**
 * Validate and normalize an Analyzer Catalog response at the contract
 * boundary.  Hash matching against the client's expected value is performed
 * by the Language Server client because it depends on request options.
 */
export function parseDawnlightAnalyzerGetCatalogResult(value: unknown): DawnlightAnalyzerGetCatalogResult {
  if (!isRecord(value)) throw new Error('Analyzer returned an invalid getCatalog result.');
  const snapshot = parseCatalogSnapshot(value.snapshot);
  if (!verifyCatalogSnapshotHash(snapshot)) {
    throw new Error('Analyzer returned a Catalog snapshot with an invalid canonical hash.');
  }
  if (typeof value.catalogHash !== 'string' || value.catalogHash.length === 0) {
    throw new Error('Analyzer getCatalog result must include a non-empty catalogHash.');
  }
  if (value.catalogHash.toLowerCase() !== snapshot.hash.toLowerCase()) {
    throw new Error('Analyzer getCatalog catalogHash does not match snapshot.hash.');
  }
  if (typeof value.compatible !== 'boolean') {
    throw new Error('Analyzer getCatalog result must include a compatible boolean.');
  }
  const selectedVersion = value.selectedVersion;
  if (selectedVersion !== undefined &&
    (!Number.isInteger(selectedVersion) || typeof selectedVersion !== 'number' || selectedVersion < 0)) {
    throw new Error('Analyzer getCatalog selectedVersion must be a non-negative integer.');
  }
  if (value.serverSupportedVersions !== undefined && !isVersionList(value.serverSupportedVersions)) {
    throw new Error('Analyzer getCatalog serverSupportedVersions must be an array of non-negative integers.');
  }
  if (value.analyzerVersion !== undefined && typeof value.analyzerVersion !== 'string') {
    throw new Error('Analyzer getCatalog analyzerVersion must be a string.');
  }
  if (value.compatible && selectedVersion !== snapshot.contractVersion) {
    throw new Error('Analyzer getCatalog selectedVersion does not match the Catalog contract version.');
  }
  return {
    snapshot,
    catalogHash: value.catalogHash,
    selectedVersion: selectedVersion as number | undefined,
    compatible: value.compatible,
    serverSupportedVersions: value.serverSupportedVersions as number[] | undefined,
    analyzerVersion: value.analyzerVersion as string | undefined
  };
}
