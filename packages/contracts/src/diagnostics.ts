export const DIAGNOSTIC_NAMESPACES = Object.freeze({
  json: 'DLJSON',
  schema: 'DLSCHEMA',
  symbol: 'DLSYMBOL',
  path: 'DLPATH',
  catalog: 'DLCAT',
  manifest: 'DLMAN',
  graph: 'DLGRAPH'
} as const);

export type DiagnosticNamespace = keyof typeof DIAGNOSTIC_NAMESPACES;
export type DiagnosticCodePrefix = (typeof DIAGNOSTIC_NAMESPACES)[DiagnosticNamespace];

export interface DawnlightDiagnosticData {
  namespace: DiagnosticNamespace;
  code: string;
  owner: 'schema' | 'language-server' | 'analyzer';
  projectGeneration?: number;
  documentVersion?: number;
}

export function createDiagnosticCode(namespace: DiagnosticNamespace, ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 9999) {
    throw new RangeError('Diagnostic ordinal must be an integer from 0 through 9999.');
  }
  return `${DIAGNOSTIC_NAMESPACES[namespace]}${String(ordinal).padStart(4, '0')}`;
}
