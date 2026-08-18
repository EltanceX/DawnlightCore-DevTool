import {
  createConnection,
  CancellationToken,
  DidChangeWatchedFilesParams,
  DidChangeWorkspaceFoldersParams,
  Diagnostic,
  DiagnosticSeverity,
  ErrorCodes,
  InitializeResult,
  Location,
  MarkupKind,
  ProposedFeatures,
  Range,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONTRACT_VERSIONS,
  createDiagnosticCode,
  DawnlightWorkspaceCompositionSnapshot,
  DawnlightWorkspaceSnapshot,
  DawnlightInitializeOptions,
  DawnlightAnalyzerCatalogParityState,
  DawnlightAnalyzerCatalogStatus,
  LSP_METHODS,
  SERVER_CAPABILITIES
} from '@dawnlight/contracts';
import {
  DawnlightAnalyzerDiagnostic,
  DawnlightAnalyzerGetCatalogResult,
  DawnlightAnalyzerOverlay,
  DawnlightAnalyzerStatus,
  DawnlightAnalyzerValidatePackResult
} from '@dawnlight/contracts';
import {
  DawnlightAnalyzerDumpGraphParams,
  DawnlightAnalyzerDumpGraphResult,
  DawnlightAnalyzerExplainVariantParams,
  DawnlightAnalyzerExplainVariantResult,
  DawnlightRuntimeDiagnostic,
  DawnlightRuntimeGraphSnapshot,
  DawnlightRuntimeViewCandidate,
  DawnlightRuntimeViewRequest,
  DawnlightRuntimeViewResult
} from '@dawnlight/contracts';
import { DawnlightSchemaService, DynamicSchemaRole } from './schemaService';
import { JsoncDocumentStore } from './jsoncDocuments';
import { PackComposition, WorkspaceCompositionManager } from './composition';
import { WorkspaceSymbolIndexManager } from './symbols';
import { DawnlightCompletionService, mergeCompletionResults } from './completion';
import {
  DawnlightFastDiagnosticService,
  FAST_DIAGNOSTIC_SOURCES,
  FastDiagnosticSource
} from './diagnostics';
import {
  DawnlightNavigationService,
  DawnlightRenameError,
  mergeHover
} from './navigation';
import {
  PackPathReference,
  ShaderPackProject,
  WorkspacePackDiscovery
} from './workspaceDiscovery';
import { resolveCatalogSnapshot } from './catalog';
import { DawnlightCatalogNavigationService } from './catalogNavigation';
import { DawnlightAnalyzerClient } from './analyzerClient';
import {
  decodeRuntimeDocumentUri,
  encodeRuntimeDocumentUri,
  renderRuntimeGraph,
  renderVariantExplanation,
  RuntimeSnapshotCache,
  runtimeInputFingerprint,
  RuntimeDocumentLike,
  sha256
} from './runtimeAnalysis';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const discovery = new WorkspacePackDiscovery([]);
const schemaService = new DawnlightSchemaService(path.resolve(__dirname, '..', 'schemas'));
const bundledCatalogDirectory = path.resolve(__dirname, '..', 'catalogs');
let catalogState = resolveCatalogSnapshot(bundledCatalogDirectory);
const documentStore = new JsoncDocumentStore();
const composition = new WorkspaceCompositionManager(documentStore);
const symbolIndex = new WorkspaceSymbolIndexManager();
const dynamicCompletion = new DawnlightCompletionService(documentStore, {
  discovery,
  composition,
  symbols: symbolIndex,
  catalog: () => catalogState
});
const navigation = new DawnlightNavigationService(documentStore, composition, symbolIndex);
const catalogNavigation = new DawnlightCatalogNavigationService(documentStore, () => catalogState);
const fastDiagnosticService = new DawnlightFastDiagnosticService();
const schemaDiagnostics = new Map<string, readonly Diagnostic[]>();
const analyzerDiagnostics = new Map<string, readonly Diagnostic[]>();
const runtimeDiagnostics = new Map<string, readonly Diagnostic[]>();
const fastDiagnostics = new Map<FastDiagnosticSource, ReadonlyMap<string, readonly Diagnostic[]>>();
const knownDiagnosticUris = new Set<string>();
let fastDiagnosticTimer: NodeJS.Timeout | undefined;
let fastDiagnosticRequest = 0;
let initializedWorkspaceFolders: string[] = [];
let validationOnSave = true;
let analyzerRequestVersion = 0;
const analyzerLatestRequests = new Map<string, number>();
const runtimeLatestRequests = new Map<string, number>();
const runtimeCache = new RuntimeSnapshotCache(64);
const runtimeUriByFingerprint = new Map<string, string>();
const latestRuntimeGraphs = new Map<string, {
  uri: string;
  packRoot: string;
  fingerprint: string;
  content: string;
  graph: DawnlightRuntimeGraphSnapshot;
}>();
let runtimeRequestVersion = 0;
let workspaceModelPromise: Promise<void> = Promise.resolve();
let analyzerCatalogStatus: DawnlightAnalyzerCatalogStatus = {
  state: 'not-requested',
  expectedHash: catalogState.hash
};
let analyzerCatalogRefreshPromise: Promise<ReturnType<typeof analyzerCatalogStatusSnapshot>> | undefined;
let analyzerCatalogRefreshHash: string | undefined;
const analyzerClient = new DawnlightAnalyzerClient({
  onStderr: text => connection.console.warn(`Dawnlight Analyzer: ${text.trim()}`),
  onState: status => {
    connection.console.info(`Dawnlight Analyzer state: ${status.state}.`);
    if (status.state === 'offline' && status.lastError) {
      connection.console.warn(`Dawnlight Analyzer offline: ${status.lastError}`);
      clearAllRuntimeState();
    }
  }
});

function uriToPath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function referenceSnapshot(reference: PackPathReference) {
  return {
    role: reference.role,
    path: reference.path,
    uri: pathToFileURL(reference.absolutePath).toString(),
    exists: reference.exists,
    valid: reference.valid
  };
}

function packSnapshot(pack: ShaderPackProject) {
  return {
    rootUri: pathToFileURL(pack.rootPath).toString(),
    manifestUri: pathToFileURL(pack.manifestPath).toString(),
    id: pack.id,
    valid: pack.valid,
    generation: pack.generation,
    fragments: pack.fragments.map(referenceSnapshot),
    settings: pack.settings ? referenceSnapshot(pack.settings) : undefined,
    shaderRoot: pack.shaderRoot ? referenceSnapshot(pack.shaderRoot) : undefined,
    diagnostics: pack.diagnostics.map(diagnostic => ({
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.path
    }))
  };
}

function workspaceSnapshot(): DawnlightWorkspaceSnapshot {
  return {
    generation: discovery.snapshot.generation,
    packs: discovery.snapshot.packs.map(packSnapshot),
    ambiguousDocumentUris: discovery.snapshot.ambiguousDocuments.map(document =>
      pathToFileURL(document.absolutePath).toString())
  };
}

function compositionSnapshot(): DawnlightWorkspaceCompositionSnapshot {
  return {
    generation: composition.snapshot.generation,
    projects: composition.snapshot.projects
  };
}

function symbolSnapshot() {
  return symbolIndex.snapshot;
}

function publishMergedDiagnostics(uri: string): void {
  const diagnostics: Diagnostic[] = [...(schemaDiagnostics.get(uri) ?? [])];
  for (const source of FAST_DIAGNOSTIC_SOURCES) {
    diagnostics.push(...(fastDiagnostics.get(source)?.get(uri) ?? []));
  }
  diagnostics.push(...(analyzerDiagnostics.get(uri) ?? []));
  diagnostics.push(...(runtimeDiagnostics.get(uri) ?? []));
  connection.sendDiagnostics({ uri, diagnostics });
}

function isWithinPath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative));
}

function analyzerRelativePath(packRoot: string, absolutePath: string): string | undefined {
  if (!isWithinPath(packRoot, absolutePath)) return undefined;
  const relative = path.relative(packRoot, absolutePath).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative)) return undefined;
  return relative;
}

function analyzerPointerPath(pointer: string | undefined): readonly (string | number)[] | undefined {
  if (pointer === undefined || pointer === '') return [];
  if (!pointer.startsWith('/')) return undefined;
  try {
    return pointer.slice(1).split('/').map(segment => {
      if (/~(?![01])/.test(segment)) throw new Error('Invalid JSON Pointer escape.');
      const decoded = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      return /^0$|^[1-9][0-9]*$/.test(decoded) ? Number(decoded) : decoded;
    });
  } catch {
    return undefined;
  }
}

function analyzerDiagnosticRange(
  document: ReturnType<typeof documentStore.getByPath>,
  pointer: string | undefined
): Range {
  if (!document?.root) return Range.create(0, 0, 0, 0);
  const segments = analyzerPointerPath(pointer);
  if (!segments) return Range.create(0, 0, 0, 0);
  let current = segments;
  while (true) {
    const node = document.nodeAtPath(current);
    if (node) {
      const range = document.rangeForNode(node);
      return Range.create(range.start.line, range.start.character, range.end.line, range.end.character);
    }
    if (current.length === 0) break;
    current = current.slice(0, -1);
  }
  return Range.create(0, 0, 0, 0);
}

function analyzerSeverity(value: DawnlightAnalyzerDiagnostic['severity']): DiagnosticSeverity {
  return value === 'warning'
    ? DiagnosticSeverity.Warning
    : value === 'information'
      ? DiagnosticSeverity.Information
      : value === 'hint'
        ? DiagnosticSeverity.Hint
        : DiagnosticSeverity.Error;
}

function clearAnalyzerDiagnostics(pack: ShaderPackProject, project?: PackComposition): void {
  for (const document of project?.documents ?? []) analyzerDiagnostics.delete(document.uri);
  analyzerDiagnostics.delete(pathToFileURL(pack.manifestPath).toString());
  for (const uri of analyzerDiagnostics.keys()) {
    const filePath = uriToPath(uri);
    if (filePath && isWithinPath(pack.rootPath, filePath)) analyzerDiagnostics.delete(uri);
  }
}

function publishAnalyzerResult(
  pack: ShaderPackProject,
  project: PackComposition | undefined,
  result: DawnlightAnalyzerValidatePackResult
): void {
  clearAnalyzerDiagnostics(pack, project);
  const byUri = new Map<string, Diagnostic[]>();
  for (const item of result.diagnostics) {
    if (!item || typeof item.code !== 'string' || !/^DLMAN[0-9]{4}$/.test(item.code) ||
      typeof item.message !== 'string' ||
      typeof item.file !== 'string') continue;
    const normalizedFile = item.file.replace(/\\/g, '/');
    if (path.isAbsolute(normalizedFile) || normalizedFile.startsWith('../') || normalizedFile === '..') continue;
    const absolutePath = path.resolve(pack.rootPath, ...normalizedFile.split('/'));
    if (!isWithinPath(pack.rootPath, absolutePath)) continue;
    const document = documentStore.getByPath(absolutePath);
    if (!document) continue;
    if (!['error', 'warning', 'information', 'hint'].includes(item.severity)) continue;
    const relatedInformation = (Array.isArray(item.related) ? item.related : []).flatMap(related => {
      if (typeof related.file !== 'string' || typeof related.message !== 'string') return [];
      const relatedFile = related.file.replace(/\\/g, '/');
      if (path.isAbsolute(relatedFile) || relatedFile.startsWith('../') || relatedFile === '..') return [];
      const relatedPath = path.resolve(pack.rootPath, ...relatedFile.split('/'));
      if (!isWithinPath(pack.rootPath, relatedPath)) return [];
      const relatedDocument = documentStore.getByPath(relatedPath);
      if (!relatedDocument) return [];
      return [{
        location: Location.create(
          relatedDocument.uri,
          analyzerDiagnosticRange(relatedDocument, related.pointer)
        ),
        message: related.message
      }];
    });
    const diagnostic: Diagnostic = {
      source: 'dawnlight-analyzer',
      code: item.code,
      message: item.message,
      severity: analyzerSeverity(item.severity),
      range: analyzerDiagnosticRange(document, item.pointer),
      relatedInformation: relatedInformation.length > 0 ? relatedInformation : undefined
    };
    const list = byUri.get(document.uri) ?? [];
    list.push(diagnostic);
    byUri.set(document.uri, list);
  }
  for (const [uri, diagnostics] of byUri) {
    analyzerDiagnostics.set(uri, Object.freeze(diagnostics));
    knownDiagnosticUris.add(uri);
  }
  for (const document of project?.documents ?? []) knownDiagnosticUris.add(document.uri);
  for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
}

function analyzerOverlays(pack: ShaderPackProject, project: PackComposition | undefined): DawnlightAnalyzerOverlay[] {
  const overlays: DawnlightAnalyzerOverlay[] = [];
  for (const document of project?.documents ?? []) {
    if (document.source !== 'overlay') continue;
    const relative = analyzerRelativePath(pack.rootPath, document.absolutePath);
    if (!relative) continue;
    overlays.push({ path: relative, version: document.version, content: document.text });
  }
  return overlays;
}

function clearRuntimeDiagnostics(pack: ShaderPackProject, project?: PackComposition): void {
  for (const document of project?.documents ?? []) runtimeDiagnostics.delete(document.uri);
  runtimeDiagnostics.delete(pathToFileURL(pack.manifestPath).toString());
  for (const uri of runtimeDiagnostics.keys()) {
    const filePath = uriToPath(uri);
    if (filePath && isWithinPath(pack.rootPath, filePath)) runtimeDiagnostics.delete(uri);
  }
}

function runtimeDiagnosticLocation(
  pack: ShaderPackProject,
  diagnostic: DawnlightRuntimeDiagnostic
): { document: NonNullable<ReturnType<typeof documentStore.getByPath>>; range: Range } | undefined {
  const file = diagnostic.provenance?.file;
  const absolutePath = file
    ? path.resolve(pack.rootPath, ...file.replace(/\\/g, '/').split('/'))
    : pack.manifestPath;
  if (!isWithinPath(pack.rootPath, absolutePath)) return undefined;
  const document = documentStore.getByPath(absolutePath);
  if (!document) return undefined;
  return {
    document,
    range: analyzerDiagnosticRange(document, diagnostic.provenance?.pointer)
  };
}

function publishRuntimeDiagnostics(
  pack: ShaderPackProject,
  project: PackComposition | undefined,
  diagnostics: readonly DawnlightRuntimeDiagnostic[]
): void {
  clearRuntimeDiagnostics(pack, project);
  const byUri = new Map<string, Diagnostic[]>();
  for (const item of diagnostics) {
    if (!item || !/^DLGRAPH[0-9]{4}$/.test(item.code) && !/^DLMAN[0-9]{4}$/.test(item.code)) continue;
    const location = runtimeDiagnosticLocation(pack, item);
    if (!location) continue;
    const relatedInformation = (item.related ?? []).flatMap(related => {
      const provenance = related.provenance;
      if (!provenance?.file) return [];
      const relatedPath = path.resolve(pack.rootPath, ...provenance.file.replace(/\\/g, '/').split('/'));
      if (!isWithinPath(pack.rootPath, relatedPath)) return [];
      const relatedDocument = documentStore.getByPath(relatedPath);
      if (!relatedDocument) return [];
      return [{
        location: Location.create(
          relatedDocument.uri,
          analyzerDiagnosticRange(relatedDocument, provenance.pointer)
        ),
        message: related.message
      }];
    });
    const diagnostic: Diagnostic = {
      source: 'dawnlight-analyzer-graph',
      code: item.code,
      message: item.message,
      severity: analyzerSeverity(item.severity),
      range: location.range,
      relatedInformation: relatedInformation.length > 0 ? relatedInformation : undefined
    };
    const list = byUri.get(location.document.uri) ?? [];
    list.push(diagnostic);
    byUri.set(location.document.uri, list);
  }
  for (const [uri, items] of byUri) {
    runtimeDiagnostics.set(uri, Object.freeze(items));
    knownDiagnosticUris.add(uri);
  }
  for (const document of project?.documents ?? []) knownDiagnosticUris.add(document.uri);
  for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
}

function invalidateRuntimePack(packRoot: string): void {
  for (const key of latestRuntimeGraphs.keys()) {
    if (path.resolve(key).toLowerCase() === path.resolve(packRoot).toLowerCase()) {
      latestRuntimeGraphs.delete(key);
    }
  }
  for (const [key, uri] of runtimeUriByFingerprint) {
    const entry = runtimeCache.get(uri);
    if (!entry || isWithinPath(packRoot, entry.packRoot) || isWithinPath(entry.packRoot, packRoot)) {
      runtimeUriByFingerprint.delete(key);
    }
  }
  runtimeCache.invalidatePack(packRoot);
  for (const key of runtimeLatestRequests.keys()) {
    if (key.includes(path.resolve(packRoot))) runtimeLatestRequests.delete(key);
  }
}

function invalidateAllRuntimeSnapshots(): void {
  runtimeCache.clear();
  runtimeUriByFingerprint.clear();
  runtimeLatestRequests.clear();
  latestRuntimeGraphs.clear();
}

function clearAllRuntimeState(): void {
  invalidateAllRuntimeSnapshots();
  runtimeDiagnostics.clear();
  for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
}

function invalidateRuntimeForPath(filePath: string): void {
  const pack = discovery.findPackForDocument(filePath);
  if (!pack) return;
  invalidateRuntimePack(pack.rootPath);
  const project = composition.snapshot.internalProjects.find(item => item.rootUri === pack.rootPath);
  clearRuntimeDiagnostics(pack, project);
  for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
}

function positionContains(range: { start: { line: number; character: number }; end: { line: number; character: number } }, position: { line: number; character: number }): boolean {
  if (position.line < range.start.line || position.line > range.end.line) return false;
  if (position.line === range.start.line && position.character < range.start.character) return false;
  if (position.line === range.end.line && position.character > range.end.character) return false;
  return true;
}

function runtimePackForRequest(params: DawnlightRuntimeViewRequest): {
  pack?: ShaderPackProject;
  project?: PackComposition;
  message?: string;
} {
  let pack: ShaderPackProject | undefined;
  if (params.packRoot) {
    const requested = path.resolve(params.packRoot);
    pack = discovery.snapshot.packs.find(candidate =>
      path.resolve(candidate.rootPath).toLowerCase() === requested.toLowerCase());
    if (!pack) return { message: `No discovered shader pack matches '${params.packRoot}'.` };
  } else if (params.documentUri) {
    const documentPath = uriToPath(params.documentUri);
    if (documentPath) pack = discovery.findPackForDocument(documentPath);
  }
  if (!pack && discovery.snapshot.packs.length === 1) pack = discovery.snapshot.packs[0];
  if (!pack) {
    return {
      message: discovery.snapshot.packs.length === 0
        ? 'No shader pack was discovered in the workspace.'
        : 'Several shader packs are open; specify a document or packRoot.'
    };
  }
  return {
    pack,
    project: composition.snapshot.internalProjects.find(item => item.rootUri === pack!.rootPath)
  };
}

function runtimeProgramCandidates(
  pack: ShaderPackProject,
  project: PackComposition | undefined,
  params: DawnlightRuntimeViewRequest
): readonly DawnlightRuntimeViewCandidate[] {
  const definitions = project?.definitions.program ?? [];
  let candidates = definitions;
  if (params.documentUri && params.position) {
    candidates = definitions.filter(definition =>
      definition.uri === params.documentUri && positionContains(definition.range, params.position!));
  }
  if (candidates.length === 0) candidates = definitions;
  return candidates
    .map(definition => ({
      programId: definition.id,
      label: definition.id,
      description: `${definition.value.kind ?? 'program'} in ${path.relative(pack.rootPath, uriToPath(definition.uri) ?? definition.uri).replace(/\\/g, '/')}`,
      detail: definition.value.variantOf ? `variant of ${String(definition.value.variantOf)}` : undefined
    }))
    .sort((left, right) => left.programId.localeCompare(right.programId));
}

function runtimeInputs(params: DawnlightRuntimeViewRequest) {
  return {
    options: params.options ?? {},
    capabilities: params.capabilities ?? {}
  } as const;
}

function runtimeOverlays(
  pack: ShaderPackProject,
  project: PackComposition | undefined
): DawnlightAnalyzerOverlay[] {
  return analyzerOverlays(pack, project).sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function runtimeCancellationSignal(token?: CancellationToken): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!token) return { signal: controller.signal, dispose: () => undefined };
  if (token.isCancellationRequested) controller.abort();
  const subscription = token.onCancellationRequested(() => controller.abort());
  return { signal: controller.signal, dispose: () => subscription.dispose() };
}

function runtimeFailureMessage(
  kind: 'graph' | 'variant',
  result: { compatible: boolean; success: boolean; diagnostics: readonly DawnlightRuntimeDiagnostic[] } | undefined
): string {
  if (!result) return `Analyzer did not return a ${kind} snapshot.`;
  if (!result.compatible) return `Analyzer ${kind} contract is incompatible with this client.`;
  const first = result.diagnostics[0];
  return first ? `${first.code}: ${first.message}` : `Analyzer could not resolve the ${kind} request.`;
}

function runtimeResultDiagnostics(
  result: DawnlightAnalyzerDumpGraphResult | DawnlightAnalyzerExplainVariantResult
): readonly DawnlightRuntimeDiagnostic[] {
  const diagnostics = [...result.diagnostics];
  if ('graph' in result && result.graph) diagnostics.push(...result.graph.hazards);
  return diagnostics;
}

function runtimeDocumentSourceUri(pack: ShaderPackProject, params: DawnlightRuntimeViewRequest): string {
  return params.documentUri && uriToPath(params.documentUri)
    ? params.documentUri
    : pathToFileURL(pack.manifestPath).toString();
}

function analyzerCatalogStatusSnapshot() {
  return Object.freeze({ ...analyzerCatalogStatus });
}

function refreshAnalyzerCatalog(): Promise<ReturnType<typeof analyzerCatalogStatusSnapshot>> {
  const expectedHash = catalogState.hash;
  if (analyzerCatalogRefreshPromise && analyzerCatalogRefreshHash === expectedHash) {
    return analyzerCatalogRefreshPromise;
  }
  analyzerCatalogRefreshHash = expectedHash;
  const promise = refreshAnalyzerCatalogCore(expectedHash).finally(() => {
    if (analyzerCatalogRefreshPromise === promise) {
      analyzerCatalogRefreshPromise = undefined;
      analyzerCatalogRefreshHash = undefined;
    }
  });
  analyzerCatalogRefreshPromise = promise;
  return promise;
}

async function refreshAnalyzerCatalogCore(expectedHash: string): Promise<ReturnType<typeof analyzerCatalogStatusSnapshot>> {
  // An empty expected hash asks the sidecar for its actual snapshot so the
  // server can report a useful mismatch instead of turning it into a generic
  // request failure. The client still validates the snapshot's own hash and
  // contract before returning it.
  const result: DawnlightAnalyzerGetCatalogResult | undefined =
    await analyzerClient.getCatalog({
      clientSupportedVersions: [CONTRACT_VERSIONS.catalogSnapshot],
      expectedCatalogHash: ''
    });
  if (catalogState.hash.toLowerCase() !== expectedHash.toLowerCase()) {
    return analyzerCatalogStatusSnapshot();
  }
  if (!result) {
    const lastError = analyzerClient.status.lastError;
    const state: DawnlightAnalyzerCatalogParityState = !analyzerClient.status.path
      ? 'unavailable'
      : lastError && /method\s+(not\s+found|unknown)|not\s+implemented/i.test(lastError)
        ? 'unavailable'
        : 'invalid';
    analyzerCatalogStatus = {
      state,
      expectedHash,
      message: lastError ?? (!analyzerClient.status.path
        ? 'Analyzer is not configured; using the active local Catalog.'
        : 'Analyzer did not return a Catalog snapshot.')
    };
    if (state === 'unavailable') {
      connection.console.info(analyzerClient.status.path
        ? 'Dawnlight Analyzer does not expose getCatalog; using the active local Catalog.'
        : 'Dawnlight Analyzer is not configured; using the active local Catalog.');
    } else {
      connection.console.warn(`Dawnlight Analyzer Catalog export was invalid: ${analyzerCatalogStatus.message}`);
    }
    clearAllRuntimeState();
    return analyzerCatalogStatusSnapshot();
  }
  const actualHash = result.catalogHash;
  const state: DawnlightAnalyzerCatalogParityState = !result.compatible
    ? 'incompatible'
    : actualHash.toLowerCase() === expectedHash.toLowerCase()
      ? 'match'
      : 'mismatch';
  analyzerCatalogStatus = {
    state,
    expectedHash,
    actualHash,
    selectedVersion: result.selectedVersion,
    analyzerVersion: result.analyzerVersion,
    message: state === 'mismatch'
      ? 'Analyzer Catalog hash differs from the active Language Server Catalog.'
      : undefined
  };
  if (state === 'match') {
    connection.console.info(`Dawnlight Analyzer Catalog parity confirmed (${actualHash}).`);
  } else if (state === 'mismatch') {
    connection.console.warn(analyzerCatalogStatus.message ?? 'Dawnlight Analyzer Catalog parity mismatch.');
  } else {
    connection.console.warn(
      `Dawnlight Analyzer Catalog contract is incompatible with the active snapshot ` +
      `(selected version ${result.selectedVersion ?? 'none'}).`
    );
  }
  if (state !== 'match') clearAllRuntimeState();
  return analyzerCatalogStatusSnapshot();
}

async function validatePackWithAnalyzer(pack: ShaderPackProject): Promise<{
  accepted: boolean;
  requestVersion: number;
  status: DawnlightAnalyzerStatus;
}> {
  const requestVersion = ++analyzerRequestVersion;
  analyzerLatestRequests.set(pack.rootPath, requestVersion);
  const project = composition.snapshot.internalProjects.find(item => item.rootUri === pack.rootPath);
  clearAnalyzerDiagnostics(pack, project);
  for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
  const result = await analyzerClient.validatePack({
    packRoot: pack.rootPath,
    catalogHash: catalogState.hash,
    requestVersion,
    overlays: analyzerOverlays(pack, project)
  });
  if (!result || analyzerLatestRequests.get(pack.rootPath) !== requestVersion ||
    !discovery.snapshot.packs.some(item => item.rootPath === pack.rootPath)) {
    return { accepted: false, requestVersion, status: analyzerClient.status };
  }
  publishAnalyzerResult(pack, project, result);
  return { accepted: true, requestVersion, status: analyzerClient.status };
}

async function ensureRuntimeCatalogParity(): Promise<{ ok: boolean; message?: string }> {
  if (analyzerCatalogStatus.state === 'match' &&
      analyzerCatalogStatus.expectedHash.toLowerCase() === catalogState.hash.toLowerCase() &&
      (analyzerClient.status.state === 'ready' || analyzerClient.status.state === 'validating')) {
    return { ok: true };
  }
  const status = await refreshAnalyzerCatalog();
  if (status.state !== 'match') {
    return {
      ok: false,
      message: status.message ??
        `Runtime analysis requires Analyzer Catalog parity (current state: ${status.state}).`
    };
  }
  return { ok: true };
}

function runtimeFingerprint(
  kind: 'graph' | 'variant',
  pack: ShaderPackProject,
  project: PackComposition | undefined,
  selector: string | undefined,
  params: DawnlightRuntimeViewRequest
): string {
  return runtimeInputFingerprint(
    pack.rootPath,
    catalogState.hash,
    kind,
    selector,
    {
      inputs: runtimeInputs(params),
      includeInactive: params.includeInactive ?? true
    },
    project as { documents?: readonly RuntimeDocumentLike[] } | undefined
  );
}

function runtimeCacheKey(
  kind: 'graph' | 'variant',
  packRoot: string,
  fingerprint: string,
  selector?: string
): string {
  return `${kind}:${path.resolve(packRoot)}:${selector ?? ''}:${fingerprint}`;
}

function isRuntimeRequestCurrent(
  latestKey: string,
  requestVersion: number,
  epoch: number,
  fingerprint: string,
  pack: ShaderPackProject,
  project: PackComposition | undefined,
  kind: 'graph' | 'variant',
  selector: string | undefined,
  params: DawnlightRuntimeViewRequest
): boolean {
  if (runtimeLatestRequests.get(latestKey) !== requestVersion) return false;
  if (analyzerClient.epoch !== epoch) return false;
  if (!discovery.snapshot.packs.some(item => item.rootPath === pack.rootPath)) return false;
  return runtimeFingerprint(kind, pack, project, selector, params) === fingerprint;
}

function runtimeViewResultForEntry(
  entry: ReturnType<RuntimeSnapshotCache['get']>,
  result: { requestVersion: number; graphHash?: string; variantFingerprint?: string }
): DawnlightRuntimeViewResult {
  return {
    documentUri: entry?.uri,
    requestVersion: result.requestVersion,
    graphHash: result.graphHash,
    variantFingerprint: result.variantFingerprint
  };
}

async function dumpRuntimeGraph(
  rawParams: DawnlightRuntimeViewRequest = {},
  token?: CancellationToken
): Promise<DawnlightRuntimeViewResult> {
  await workspaceModelSettled();
  const params = rawParams ?? {};
  const resolved = runtimePackForRequest(params);
  if (!resolved.pack) return { message: resolved.message ?? 'No shader pack is available.' };
  const pack = resolved.pack;
  const project = resolved.project;
  const parity = await ensureRuntimeCatalogParity();
  if (!parity.ok) return { message: parity.message };
  const fingerprint = runtimeFingerprint('graph', pack, project, undefined, params);
  const key = runtimeCacheKey('graph', pack.rootPath, fingerprint);
  const cachedUri = runtimeUriByFingerprint.get(key);
  if (cachedUri) {
    const cached = runtimeCache.get(cachedUri);
    if (cached) {
      const cachedResult = cached.result as DawnlightAnalyzerDumpGraphResult;
      if (cachedResult.graph) {
        publishRuntimeDiagnostics(pack, project, runtimeResultDiagnostics(cachedResult));
        latestRuntimeGraphs.set(pack.rootPath, {
          uri: cached.uri,
          packRoot: pack.rootPath,
          fingerprint,
          content: cached.content,
          graph: cachedResult.graph
        });
      }
      return runtimeViewResultForEntry(cached, {
        requestVersion: cachedResult.requestVersion,
        graphHash: cachedResult.graph?.graphHash,
        variantFingerprint: cachedResult.graph?.variantFingerprint
      });
    }
    runtimeUriByFingerprint.delete(key);
  }

  const requestVersion = ++runtimeRequestVersion;
  const latestKey = `graph:${path.resolve(pack.rootPath)}`;
  runtimeLatestRequests.set(latestKey, requestVersion);
  const epoch = analyzerClient.epoch;
  const cancellation = runtimeCancellationSignal(token);
  let result: DawnlightAnalyzerDumpGraphResult | undefined;
  try {
    const analyzerParams: DawnlightAnalyzerDumpGraphParams = {
      packRoot: pack.rootPath,
      catalogHash: catalogState.hash,
      requestVersion,
      overlays: runtimeOverlays(pack, project),
      clientSupportedVersions: [1],
      inputs: runtimeInputs(params),
      includeInactive: params.includeInactive ?? true
    };
    result = await analyzerClient.dumpGraph(analyzerParams, cancellation.signal);
  } finally {
    cancellation.dispose();
  }
  if (!result || !isRuntimeRequestCurrent(
    latestKey, requestVersion, epoch, fingerprint, pack, project, 'graph', undefined, params
  )) {
    return { stale: true, requestVersion, message: 'Runtime graph request became stale or was cancelled.' };
  }
  if (result.catalogHash.toLowerCase() !== catalogState.hash.toLowerCase()) {
    return { message: 'Analyzer returned a runtime graph for a different Catalog hash.' };
  }
  if (!result.compatible || !result.success || !result.graph) {
    if (result.compatible) publishRuntimeDiagnostics(pack, project, runtimeResultDiagnostics(result));
    return { requestVersion, message: runtimeFailureMessage('graph', result) };
  }
  publishRuntimeDiagnostics(pack, project, runtimeResultDiagnostics(result));
  const uri = encodeRuntimeDocumentUri(
    'dawnlight-graph',
    { sourceUri: runtimeDocumentSourceUri(pack, params) },
    sha256(`${fingerprint}:${result.graph.graphHash}:${epoch}`)
  );
  const content = renderRuntimeGraph(result, pack.rootPath);
  runtimeCache.set({
    uri,
    operation: 'graph',
    packRoot: pack.rootPath,
    fingerprint,
    content,
    result
  });
  latestRuntimeGraphs.set(pack.rootPath, {
    uri,
    packRoot: pack.rootPath,
    fingerprint,
    content,
    graph: result.graph
  });
  runtimeUriByFingerprint.set(key, uri);
  return runtimeViewResultForEntry(runtimeCache.get(uri), {
    requestVersion,
    graphHash: result.graph.graphHash,
    variantFingerprint: result.graph.variantFingerprint
  });
}

async function explainRuntimeVariant(
  rawParams: DawnlightRuntimeViewRequest = {},
  token?: CancellationToken
): Promise<DawnlightRuntimeViewResult> {
  await workspaceModelSettled();
  const params = rawParams ?? {};
  const resolved = runtimePackForRequest(params);
  if (!resolved.pack) return { message: resolved.message ?? 'No shader pack is available.' };
  const pack = resolved.pack;
  const project = resolved.project;
  let programId = params.programId;
  if (!programId) {
    const candidates = runtimeProgramCandidates(pack, project, params);
    if (candidates.length !== 1) {
      return {
        candidates,
        message: candidates.length === 0
          ? 'No declared program is available in this shader pack.'
          : 'Select a program variant to explain.'
      };
    }
    programId = candidates[0].programId;
  }
  const parity = await ensureRuntimeCatalogParity();
  if (!parity.ok) return { message: parity.message };
  const fingerprint = runtimeFingerprint('variant', pack, project, programId, params);
  const key = runtimeCacheKey('variant', pack.rootPath, fingerprint, programId);
  const cachedUri = runtimeUriByFingerprint.get(key);
  if (cachedUri) {
    const cached = runtimeCache.get(cachedUri);
    if (cached) {
      const cachedResult = cached.result as DawnlightAnalyzerExplainVariantResult;
      return runtimeViewResultForEntry(cached, {
        requestVersion: cachedResult.requestVersion,
        variantFingerprint: cachedResult.explanation?.variantFingerprint
      });
    }
    runtimeUriByFingerprint.delete(key);
  }

  const requestVersion = ++runtimeRequestVersion;
  const latestKey = `variant:${path.resolve(pack.rootPath)}:${programId}`;
  runtimeLatestRequests.set(latestKey, requestVersion);
  const epoch = analyzerClient.epoch;
  const cancellation = runtimeCancellationSignal(token);
  let result: DawnlightAnalyzerExplainVariantResult | undefined;
  try {
    const analyzerParams: DawnlightAnalyzerExplainVariantParams = {
      packRoot: pack.rootPath,
      catalogHash: catalogState.hash,
      requestVersion,
      overlays: runtimeOverlays(pack, project),
      clientSupportedVersions: [1],
      inputs: runtimeInputs(params),
      programId,
      includeInactive: params.includeInactive ?? true
    };
    result = await analyzerClient.explainVariant(analyzerParams, cancellation.signal);
  } finally {
    cancellation.dispose();
  }
  if (!result || !isRuntimeRequestCurrent(
    latestKey, requestVersion, epoch, fingerprint, pack, project, 'variant', programId, params
  )) {
    return { stale: true, requestVersion, message: 'Program variant request became stale or was cancelled.' };
  }
  if (result.catalogHash.toLowerCase() !== catalogState.hash.toLowerCase()) {
    return { message: 'Analyzer returned a variant explanation for a different Catalog hash.' };
  }
  if (!result.compatible || !result.success || !result.explanation) {
    return { requestVersion, message: runtimeFailureMessage('variant', result) };
  }
  const uri = encodeRuntimeDocumentUri(
    'dawnlight-variant',
    { sourceUri: runtimeDocumentSourceUri(pack, params), programId },
    sha256(`${fingerprint}:${result.explanation.variantFingerprint}:${epoch}`)
  );
  const content = renderVariantExplanation(result, pack.rootPath);
  runtimeCache.set({
    uri,
    operation: 'variant',
    packRoot: pack.rootPath,
    fingerprint,
    content,
    result
  });
  runtimeUriByFingerprint.set(key, uri);
  return runtimeViewResultForEntry(runtimeCache.get(uri), {
    requestVersion,
    variantFingerprint: result.explanation.variantFingerprint
  });
}

function runtimeDocumentContent(uri: string, operation: 'graph' | 'variant'): string | null {
  const key = decodeRuntimeDocumentUri(uri);
  if (!key || (operation === 'graph' && key.programId) || (operation === 'variant' && !key.programId)) {
    return null;
  }
  return runtimeCache.get(uri)?.content ?? null;
}

function runtimeGraphNodeAt(document: TextDocument, position: { line: number; character: number }) {
  const documentPath = uriToPath(document.uri);
  const pack = documentPath ? discovery.findPackForDocument(documentPath) : undefined;
  const snapshot = pack ? latestRuntimeGraphs.get(pack.rootPath) : undefined;
  const symbol = navigation.runtimeSymbol(document, position);
  if (!snapshot || !symbol || !['pass', 'program', 'resource'].includes(symbol.kind)) return undefined;
  if (!runtimeCache.has(snapshot.uri)) {
    latestRuntimeGraphs.delete(snapshot.packRoot);
    return undefined;
  }
  const node = snapshot.graph.nodes.find(candidate =>
    candidate.declaredId === symbol.id || candidate.id === symbol.id || candidate.label === symbol.id ||
    candidate.id.endsWith(`:${symbol.id}`));
  return node ? { snapshot, symbol, node } : undefined;
}

function runtimeGraphDefinition(
  document: TextDocument,
  position: { line: number; character: number }
): Location | undefined {
  const context = runtimeGraphNodeAt(document, position);
  if (!context) return undefined;
  const needle = `"id": ${JSON.stringify(context.node.id)}`;
  const line = Math.max(0, context.snapshot.content.split('\n').findIndex(item => item.includes(needle)));
  return Location.create(context.snapshot.uri, Range.create(line, 0, line, Math.max(1, needle.length)));
}

function runtimeGraphHover(
  document: TextDocument,
  position: { line: number; character: number }
) {
  const context = runtimeGraphNodeAt(document, position);
  if (!context) return null;
  const incoming = context.snapshot.graph.edges.filter(edge => edge.to === context.node.id).length;
  const outgoing = context.snapshot.graph.edges.filter(edge => edge.from === context.node.id).length;
  const events = context.snapshot.graph.events.filter(event => event.nodeId === context.node.id).length;
  const hazards = context.snapshot.graph.hazards.filter(hazard =>
    hazard.nodeIds.includes(context.node.id));
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: [
        `**Runtime graph node** \`${context.node.id}\``,
        '',
        `- State: \`${context.node.active ? 'active' : 'inactive'}\``,
        `- Kind: \`${context.node.kind}\``,
        context.node.order === undefined ? undefined : `- Execution order: \`${context.node.order}\``,
        `- Edges: \`${incoming} incoming / ${outgoing} outgoing\``,
        `- Events: \`${events}\``,
        `- Hazards: \`${hazards.length}\``,
        `- Graph hash: \`${context.snapshot.graph.graphHash}\``
      ].filter(line => line !== undefined).join('\n')
    },
    range: context.symbol.range
  };
}

async function workspaceModelSettled(): Promise<void> {
  let observed: Promise<void>;
  do {
    observed = workspaceModelPromise;
    await observed;
  } while (observed !== workspaceModelPromise);
}

function publishFastDiagnostics(changedPaths: readonly string[] = []): void {
  const request = ++fastDiagnosticRequest;
  if (fastDiagnosticTimer) clearTimeout(fastDiagnosticTimer);
  fastDiagnosticTimer = setTimeout(() => {
    if (request !== fastDiagnosticRequest) return;
    const discoverySnapshot = discovery.snapshot;
    const compositionSnapshot = composition.snapshot;
    const symbolSnapshotValue = symbolIndex.snapshot;
    const result = fastDiagnosticService.compute(
      discoverySnapshot,
      compositionSnapshot,
      symbolSnapshotValue,
      catalogState,
      changedPaths
    );
    if (request !== fastDiagnosticRequest ||
      composition.snapshot.generation !== result.compositionGeneration ||
      symbolIndex.snapshot.generation !== result.symbolGeneration) {
      publishFastDiagnostics(changedPaths);
      return;
    }
    for (const source of FAST_DIAGNOSTIC_SOURCES) {
      const sourceMap = result.bySource.get(source) ?? new Map();
      fastDiagnostics.set(source, sourceMap);
      for (const uri of sourceMap.keys()) knownDiagnosticUris.add(uri);
    }
    for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
  }, 175);
}

function rebuildComposition(changedPaths: readonly string[] = []): void {
  workspaceModelPromise = composition.rebuild(discovery.snapshot).then(result => {
    if (result.applied) {
      return symbolIndex.rebuild(result.snapshot, discovery.snapshot, changedPaths).then(indexResult => {
        if (indexResult.applied) publishFastDiagnostics(changedPaths);
        return indexResult;
      });
    }
    return undefined;
  }).then(() => undefined).catch(error => {
    connection.console.error(`Could not compose Dawnlight workspace: ${(error as Error).message}`);
  });
}

function notifyWorkspaceChanged(snapshot: ReturnType<WorkspacePackDiscovery['refresh']>): void {
  clearAllRuntimeState();
  const removedAnalyzerUris: string[] = [];
  for (const uri of analyzerDiagnostics.keys()) {
    const filePath = uriToPath(uri);
    if (filePath && !snapshot.packs.some(pack => isWithinPath(pack.rootPath, filePath))) {
      analyzerDiagnostics.delete(uri);
      removedAnalyzerUris.push(uri);
    }
  }
  for (const root of analyzerLatestRequests.keys()) {
    if (!snapshot.packs.some(pack => pack.rootPath === root)) analyzerLatestRequests.delete(root);
  }
  connection.console.info(
    `Dawnlight workspace generation ${snapshot.generation}: ${snapshot.packs.length} pack(s).`
  );
  for (const document of documents.all()) void validateDocument(document);
  for (const uri of removedAnalyzerUris) publishMergedDiagnostics(uri);
}

function dynamicSchemaRole(documentPath: string): DynamicSchemaRole | undefined {
  const association = discovery.getDocumentAssociation(documentPath);
  if (!association?.reference) return undefined;
  if (association.role === 'fragment') {
    return /^manifest\/(?:options|resources|passes|programs)\/[^/]+\.json$/i
      .test(association.reference.path) ? undefined : 'fragment';
  }
  if (association.role === 'settings') {
    return /^manifest\/ui\/settings\.json$/i.test(association.reference.path)
      ? undefined : 'settings';
  }
  return undefined;
}

async function validateDocument(document: TextDocument): Promise<void> {
  const documentVersion = document.version;
  const documentPath = uriToPath(document.uri);
  const role = documentPath ? dynamicSchemaRole(documentPath) : undefined;
  schemaService.setRole(document, role);
  type SchemaDiagnostics = Awaited<ReturnType<DawnlightSchemaService['validate']>>;
  let diagnostics: SchemaDiagnostics = [];
  if (role) {
    try {
      diagnostics = await schemaService.validate(document, role);
    } catch (error) {
      connection.console.error(
        `Could not validate ${document.uri}: ${(error as Error).message}`
      );
    }
  }
  if (documents.get(document.uri)?.version !== documentVersion) return;
  schemaDiagnostics.set(document.uri, diagnostics.map(diagnostic => ({
      range: diagnostic.range,
      message: typeof diagnostic.message === 'string'
        ? diagnostic.message
        : diagnostic.message.value,
      severity: diagnostic.severity,
      code: createDiagnosticCode('schema', 1),
      data: { originalCode: diagnostic.code },
      source: 'dawnlight-schema'
    })));
  knownDiagnosticUris.add(document.uri);
  publishMergedDiagnostics(document.uri);
}

function refreshWorkspace(changedPaths: readonly string[] = []): void {
  dynamicCompletion.invalidate(changedPaths);
  const previous = discovery.snapshot;
  const snapshot = changedPaths.length > 0
    ? discovery.handleFileEvents(changedPaths)
    : discovery.refresh();
  if (snapshot === previous) return;
  notifyWorkspaceChanged(snapshot);
  rebuildComposition(changedPaths);
}

connection.onInitialize(params => {
  initializedWorkspaceFolders = (params.workspaceFolders ?? [])
    .map(folder => uriToPath(folder.uri))
    .filter((folder): folder is string => folder !== undefined);
  if (initializedWorkspaceFolders.length === 0 && params.rootUri) {
    const rootPath = uriToPath(params.rootUri);
    if (rootPath) initializedWorkspaceFolders = [rootPath];
  }
  const options = params.initializationOptions as DawnlightInitializeOptions | undefined;
  if (options?.clientProtocolVersion !== undefined &&
      options.clientProtocolVersion !== CONTRACT_VERSIONS.languageServerProtocol) {
    connection.console.warn(
      `Client protocol ${options.clientProtocolVersion} does not match server protocol ` +
      `${CONTRACT_VERSIONS.languageServerProtocol}.`
    );
  }
  catalogState = resolveCatalogSnapshot(bundledCatalogDirectory, {
    externalPath: options?.catalogPath,
    clientSupportedVersions: options?.catalogSnapshotVersions
  });
  analyzerCatalogStatus = {
    state: 'not-requested',
    expectedHash: catalogState.hash
  };
  validationOnSave = options?.validationOnSave ?? true;
  analyzerClient.configure({
    analyzerPath: options?.analyzerPath,
    catalogHash: catalogState.hash,
    timeoutMs: options?.analyzerTimeoutMs,
    restartLimit: options?.analyzerRestartLimit
  });

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false }
      },
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['"', ':']
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true
        }
      },
      experimental: {
        dawnlight: SERVER_CAPABILITIES
      }
    },
    serverInfo: {
      name: 'Dawnlight Shader Pack Language Server',
      version: '0.2.0'
    }
  };
  return result;
});

connection.onInitialized(() => {
  discovery.setWorkspaceFolders(initializedWorkspaceFolders);
  rebuildComposition();
  connection.console.info('Dawnlight language server initialized.');
  connection.console.info(
    `Dawnlight Catalog ${catalogState.source}: ${catalogState.path}; hash ${catalogState.hash}.`
  );
  if (catalogState.fallbackReason) connection.console.warn(catalogState.fallbackReason);
  if (!catalogState.negotiation.compatible) {
    connection.console.warn(
      `Catalog contract mismatch: client [${catalogState.negotiation.clientSupportedVersions.join(', ')}], ` +
      `server [${catalogState.negotiation.serverSupportedVersions.join(', ')}].`
    );
  }
  connection.console.info(
    `Dawnlight workspace generation ${discovery.snapshot.generation}: ` +
    `${discovery.snapshot.packs.length} pack(s).`
  );
});

connection.onNotification(
  'workspace/didChangeWorkspaceFolders',
  (params: DidChangeWorkspaceFoldersParams) => {
    const remaining = initializedWorkspaceFolders.filter(folder =>
      !params.event.removed.some(removed => {
        const removedPath = uriToPath(removed.uri);
        return removedPath !== undefined &&
          path.resolve(removedPath).toLowerCase() === path.resolve(folder).toLowerCase();
      }));
    const added = params.event.added
      .map(folder => uriToPath(folder.uri))
      .filter((folder): folder is string => folder !== undefined);
    initializedWorkspaceFolders = [...remaining, ...added];
    discovery.setWorkspaceFolders(initializedWorkspaceFolders);
    dynamicCompletion.invalidate();
    for (const document of documents.all()) void validateDocument(document);
    rebuildComposition();
  }
);

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const changedPaths = params.changes
    .map(change => uriToPath(change.uri))
    .filter((changedPath): changedPath is string => changedPath !== undefined);
  for (const changedPath of changedPaths) documentStore.invalidate(changedPath);
  refreshWorkspace(changedPaths);
});

connection.onRequest(LSP_METHODS.workspaceSnapshot, () => workspaceSnapshot());
connection.onRequest(LSP_METHODS.compositionSnapshot, () => compositionSnapshot());
connection.onRequest(LSP_METHODS.symbolSnapshot, () => symbolSnapshot());
connection.onRequest(LSP_METHODS.catalogSnapshot, () => ({
  source: catalogState.source,
  path: catalogState.path,
  hash: catalogState.hash,
  hashValid: catalogState.hashValid,
  snapshot: catalogState.snapshot,
  requestedPath: catalogState.requestedPath,
  fallbackReason: catalogState.fallbackReason,
  negotiation: catalogState.negotiation,
  analyzer: analyzerCatalogStatusSnapshot()
}));
connection.onRequest(LSP_METHODS.catalogDocument, params =>
  catalogNavigation.document((params as { uri: string }).uri));
connection.onRequest(LSP_METHODS.dumpGraph, (params: DawnlightRuntimeViewRequest = {}, token) =>
  dumpRuntimeGraph(params, token));
connection.onRequest(LSP_METHODS.explainVariant, (params: DawnlightRuntimeViewRequest = {}, token) =>
  explainRuntimeVariant(params, token));
connection.onRequest(LSP_METHODS.graphDocument, (params: { uri?: string } | null = {}) =>
  params && typeof params.uri === 'string' ? runtimeDocumentContent(params.uri, 'graph') : null);
connection.onRequest(LSP_METHODS.variantDocument, (params: { uri?: string } | null = {}) =>
  params && typeof params.uri === 'string' ? runtimeDocumentContent(params.uri, 'variant') : null);
connection.onRequest(LSP_METHODS.analyzerStatus, () => analyzerClient.status);
connection.onRequest(LSP_METHODS.analyzerCatalog, () => refreshAnalyzerCatalog());
connection.onRequest(LSP_METHODS.restartAnalyzer, async () => {
  analyzerRequestVersion += 1;
  analyzerLatestRequests.clear();
  clearAllRuntimeState();
  analyzerDiagnostics.clear();
  await analyzerClient.restart();
  analyzerCatalogStatus = {
    state: 'not-requested',
    expectedHash: catalogState.hash
  };
  for (const uri of knownDiagnosticUris) publishMergedDiagnostics(uri);
  return analyzerClient.status;
});
connection.onRequest(LSP_METHODS.validatePack, async (params: { packRoot?: string } = {}) => {
  const requestedRoot = params.packRoot ? path.resolve(params.packRoot) : undefined;
  const pack = discovery.snapshot.packs.find(candidate =>
    requestedRoot ? path.resolve(candidate.rootPath) === requestedRoot : true);
  if (!pack) return { accepted: false, status: analyzerClient.status };
  return validatePackWithAnalyzer(pack);
});

connection.onCompletion(async params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const schemaResult = await schemaService.complete(document, params.position);
  return mergeCompletionResults(
    schemaResult,
    dynamicCompletion.complete(document, params.position)
  );
});

connection.onDefinition(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const definitions = navigation.definition(document, params.position) ??
    catalogNavigation.definition(document, params.position) ?? [];
  const runtime = runtimeGraphDefinition(document, params.position);
  return runtime ? [...definitions, runtime] : definitions.length > 0 ? definitions : null;
});

connection.onReferences(params => {
  const document = documents.get(params.textDocument.uri);
  return document
    ? navigation.references(document, params.position, params.context.includeDeclaration)
    : null;
});

connection.onPrepareRename(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  try {
    return navigation.prepareRename(document, params.position);
  } catch (error) {
    if (error instanceof DawnlightRenameError) {
      throw new ResponseError(ErrorCodes.InvalidRequest, error.message);
    }
    throw error;
  }
});

connection.onRenameRequest(params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  try {
    return navigation.rename(document, params.position, params.newName);
  } catch (error) {
    if (error instanceof DawnlightRenameError) {
      throw new ResponseError(ErrorCodes.InvalidRequest, error.message);
    }
    throw error;
  }
});

connection.onHover(async params => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const schemaHover = await schemaService.hover(document, params.position);
  const dynamicHover = mergeHover(
    navigation.hover(document, params.position),
    catalogNavigation.hover(document, params.position)
  );
  return mergeHover(mergeHover(schemaHover, dynamicHover), runtimeGraphHover(document, params.position));
});

documents.onDidOpen(event => {
  const documentPath = uriToPath(event.document.uri);
  documentStore.open(event.document.uri, event.document.getText(), event.document.version);
  dynamicCompletion.invalidate(documentPath ? [documentPath] : []);
  if (documentPath) {
    invalidateRuntimeForPath(documentPath);
    discovery.locatePackForDocument(documentPath);
    const previous = discovery.snapshot;
    const next = discovery.setDocumentOverlay(documentPath, event.document.getText());
    if (next !== previous) notifyWorkspaceChanged(next);
  }
  rebuildComposition(documentPath ? [documentPath] : []);
  void validateDocument(event.document);
});

documents.onDidChangeContent(event => {
  documentStore.update(event.document.uri, event.document.getText(), event.document.version);
  const documentPath = uriToPath(event.document.uri);
  dynamicCompletion.invalidate(documentPath ? [documentPath] : []);
  if (documentPath) {
    invalidateRuntimeForPath(documentPath);
    const previous = discovery.snapshot;
    const next = discovery.setDocumentOverlay(documentPath, event.document.getText());
    if (next !== previous) notifyWorkspaceChanged(next);
  }
  rebuildComposition(documentPath ? [documentPath] : []);
  void validateDocument(event.document);
});

documents.onDidSave(event => {
  if (!validationOnSave) return;
  const documentPath = uriToPath(event.document.uri);
  if (!documentPath) return;
  const association = discovery.getDocumentAssociation(documentPath);
  if (association && association.role !== 'untracked') void validatePackWithAnalyzer(association.pack);
});

documents.onDidClose(event => {
  const documentPath = uriToPath(event.document.uri);
  documentStore.close(event.document.uri);
  dynamicCompletion.invalidate(documentPath ? [documentPath] : []);
  if (documentPath) {
    invalidateRuntimeForPath(documentPath);
    const previous = discovery.snapshot;
    const next = discovery.clearDocumentOverlay(documentPath);
    if (next !== previous) notifyWorkspaceChanged(next);
  }
  rebuildComposition(documentPath ? [documentPath] : []);
  schemaService.setRole(event.document, undefined);
  schemaDiagnostics.delete(event.document.uri);
  knownDiagnosticUris.add(event.document.uri);
  publishMergedDiagnostics(event.document.uri);
});

connection.onShutdown(() => {
  if (fastDiagnosticTimer) clearTimeout(fastDiagnosticTimer);
  fastDiagnosticTimer = undefined;
  fastDiagnosticRequest += 1;
  return analyzerClient.shutdown();
});

documents.listen(connection);
connection.listen();
