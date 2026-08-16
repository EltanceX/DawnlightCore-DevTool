export const LSP_METHODS = Object.freeze({
  workspaceSnapshot: 'dawnlight/workspaceSnapshot'
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
