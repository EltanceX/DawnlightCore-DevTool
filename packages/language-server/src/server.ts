import {
  createConnection,
  DidChangeWatchedFilesParams,
  DidChangeWorkspaceFoldersParams,
  Diagnostic,
  DiagnosticSeverity,
  ErrorCodes,
  InitializeResult,
  Location,
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
  LSP_METHODS,
  SERVER_CAPABILITIES
} from '@dawnlight/contracts';
import {
  DawnlightAnalyzerDiagnostic,
  DawnlightAnalyzerOverlay,
  DawnlightAnalyzerStatus,
  DawnlightAnalyzerValidatePackResult
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
const fastDiagnostics = new Map<FastDiagnosticSource, ReadonlyMap<string, readonly Diagnostic[]>>();
const knownDiagnosticUris = new Set<string>();
let fastDiagnosticTimer: NodeJS.Timeout | undefined;
let fastDiagnosticRequest = 0;
let initializedWorkspaceFolders: string[] = [];
let validationOnSave = true;
let analyzerRequestVersion = 0;
const analyzerLatestRequests = new Map<string, number>();
const analyzerClient = new DawnlightAnalyzerClient({
  onStderr: text => connection.console.warn(`Dawnlight Analyzer: ${text.trim()}`),
  onState: status => {
    connection.console.info(`Dawnlight Analyzer state: ${status.state}.`);
    if (status.state === 'offline' && status.lastError) {
      connection.console.warn(`Dawnlight Analyzer offline: ${status.lastError}`);
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
  void composition.rebuild(discovery.snapshot).then(result => {
    if (result.applied) {
      return symbolIndex.rebuild(result.snapshot, discovery.snapshot, changedPaths).then(indexResult => {
        if (indexResult.applied) publishFastDiagnostics(changedPaths);
        return indexResult;
      });
    }
    return undefined;
  }).catch(error => {
    connection.console.error(`Could not compose Dawnlight workspace: ${(error as Error).message}`);
  });
}

function notifyWorkspaceChanged(snapshot: ReturnType<WorkspacePackDiscovery['refresh']>): void {
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
  negotiation: catalogState.negotiation
}));
connection.onRequest(LSP_METHODS.catalogDocument, params =>
  catalogNavigation.document((params as { uri: string }).uri));
connection.onRequest(LSP_METHODS.analyzerStatus, () => analyzerClient.status);
connection.onRequest(LSP_METHODS.restartAnalyzer, async () => {
  analyzerRequestVersion += 1;
  analyzerLatestRequests.clear();
  analyzerDiagnostics.clear();
  await analyzerClient.restart();
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
  return document
    ? navigation.definition(document, params.position) ??
      catalogNavigation.definition(document, params.position)
    : null;
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
  return mergeHover(schemaHover, dynamicHover);
});

documents.onDidOpen(event => {
  const documentPath = uriToPath(event.document.uri);
  documentStore.open(event.document.uri, event.document.getText(), event.document.version);
  dynamicCompletion.invalidate(documentPath ? [documentPath] : []);
  if (documentPath) {
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
