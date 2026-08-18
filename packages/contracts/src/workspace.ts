export const LSP_METHODS = Object.freeze({
  workspaceSnapshot: 'dawnlight/workspaceSnapshot',
  compositionSnapshot: 'dawnlight/compositionSnapshot',
  symbolSnapshot: 'dawnlight/symbolSnapshot',
  catalogSnapshot: 'dawnlight/catalogSnapshot',
  catalogDocument: 'dawnlight/catalogDocument',
  analyzerCatalog: 'dawnlight/analyzerCatalog',
  validatePack: 'dawnlight/validatePack',
  analyzerStatus: 'dawnlight/analyzerStatus',
  restartAnalyzer: 'dawnlight/restartAnalyzer'
} as const);

export interface DawnlightCatalogDocumentParams {
  uri: string;
}

export type DawnlightPackDocumentRole = 'fragment' | 'settings' | 'shaderRoot';

export interface DawnlightPackReferenceSnapshot {
  role: DawnlightPackDocumentRole;
  path: string;
  uri: string;
  exists: boolean;
  valid: boolean;
}

export interface DawnlightWorkspaceDiagnosticSnapshot {
  code: string;
  message: string;
  path?: string;
}

export interface DawnlightPackSnapshot {
  rootUri: string;
  manifestUri: string;
  id?: string;
  valid: boolean;
  generation: number;
  fragments: readonly DawnlightPackReferenceSnapshot[];
  settings?: DawnlightPackReferenceSnapshot;
  shaderRoot?: DawnlightPackReferenceSnapshot;
  diagnostics: readonly DawnlightWorkspaceDiagnosticSnapshot[];
}

export interface DawnlightWorkspaceSnapshot {
  generation: number;
  packs: readonly DawnlightPackSnapshot[];
  ambiguousDocumentUris: readonly string[];
}

export interface DawnlightPosition {
  line: number;
  character: number;
}

export interface DawnlightRange {
  start: DawnlightPosition;
  end: DawnlightPosition;
}

export interface DawnlightCompositionDefinitionSnapshot {
  id: string;
  kind: 'option' | 'resource' | 'program' | 'pass';
  uri: string;
  range: DawnlightRange;
  selectionRange: DawnlightRange;
  fragmentOrder: number;
  localOrder: number;
}

export interface DawnlightCompositionDocumentSnapshot {
  uri: string;
  version: number;
  source: 'disk' | 'overlay';
  parseErrorCount: number;
}

export interface DawnlightCompositionDiagnosticSnapshot {
  code: string;
  message: string;
  uri: string;
  range?: DawnlightRange;
}

export interface DawnlightPackCompositionSnapshot {
  rootUri: string;
  discoveryGeneration: number;
  documents: readonly DawnlightCompositionDocumentSnapshot[];
  definitions: Readonly<{
    options: readonly DawnlightCompositionDefinitionSnapshot[];
    resources: readonly DawnlightCompositionDefinitionSnapshot[];
    programs: readonly DawnlightCompositionDefinitionSnapshot[];
    passes: readonly DawnlightCompositionDefinitionSnapshot[];
  }>;
  diagnostics: readonly DawnlightCompositionDiagnosticSnapshot[];
}

export interface DawnlightWorkspaceCompositionSnapshot {
  generation: number;
  projects: readonly DawnlightPackCompositionSnapshot[];
}

export type DawnlightSymbolKind =
  | 'option'
  | 'resource'
  | 'program'
  | 'pass'
  | 'settingsPage'
  | 'settingsGroup'
  | 'settingsControl'
  | 'file';

export type DawnlightReferenceKind =
  | 'option'
  | 'resource'
  | 'program'
  | 'pass'
  | 'path'
  | 'shader'
  | 'asset';

export type DawnlightJsonPathSegment = string | number;

export interface DawnlightSymbolSnapshot {
  id: string;
  canonicalId: string;
  kind: DawnlightSymbolKind;
  uri: string;
  path: readonly DawnlightJsonPathSegment[];
  range: DawnlightRange;
  selectionRange: DawnlightRange;
}

export interface DawnlightReferenceSnapshot {
  kind: DawnlightReferenceKind;
  targetId?: string;
  targetKind?: DawnlightSymbolKind;
  targetPath?: string;
  targetUri?: string;
  uri: string;
  path: readonly DawnlightJsonPathSegment[];
  range: DawnlightRange;
  resolved: boolean;
  ambiguous: boolean;
}

export interface DawnlightSymbolDiagnosticSnapshot {
  code: string;
  message: string;
  uri: string;
  range?: DawnlightRange;
}

export interface DawnlightDuplicateSymbolSnapshot {
  canonicalId: string;
  definitions: readonly DawnlightSymbolSnapshot[];
}

export interface DawnlightPackSymbolIndexSnapshot {
  rootUri: string;
  compositionGeneration: number;
  documents: readonly DawnlightCompositionDocumentSnapshot[];
  symbols: readonly DawnlightSymbolSnapshot[];
  references: readonly DawnlightReferenceSnapshot[];
  duplicates: readonly DawnlightDuplicateSymbolSnapshot[];
  diagnostics: readonly DawnlightSymbolDiagnosticSnapshot[];
}

export interface DawnlightWorkspaceSymbolIndexSnapshot {
  generation: number;
  projects: readonly DawnlightPackSymbolIndexSnapshot[];
}
