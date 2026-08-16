export const LSP_METHODS = Object.freeze({
  workspaceSnapshot: 'dawnlight/workspaceSnapshot',
  compositionSnapshot: 'dawnlight/compositionSnapshot'
} as const);

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
