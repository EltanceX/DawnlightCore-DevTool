import { CONTRACT_VERSIONS } from './versions';

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
