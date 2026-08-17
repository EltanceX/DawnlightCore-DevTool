import {
  createConnection,
  DidChangeWatchedFilesParams,
  DidChangeWorkspaceFoldersParams,
  ErrorCodes,
  InitializeResult,
  ProposedFeatures,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONTRACT_VERSIONS,
  DawnlightWorkspaceCompositionSnapshot,
  DawnlightWorkspaceSnapshot,
  DawnlightInitializeOptions,
  LSP_METHODS,
  SERVER_CAPABILITIES
} from '@dawnlight/contracts';
import { DawnlightSchemaService, DynamicSchemaRole } from './schemaService';
import { JsoncDocumentStore } from './jsoncDocuments';
import { WorkspaceCompositionManager } from './composition';
import { WorkspaceSymbolIndexManager } from './symbols';
import { DawnlightCompletionService, mergeCompletionResults } from './completion';
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

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const discovery = new WorkspacePackDiscovery([]);
const schemaService = new DawnlightSchemaService(path.resolve(__dirname, '..', 'schemas'));
const documentStore = new JsoncDocumentStore();
const composition = new WorkspaceCompositionManager(documentStore);
const symbolIndex = new WorkspaceSymbolIndexManager();
const dynamicCompletion = new DawnlightCompletionService(documentStore, {
  discovery,
  composition,
  symbols: symbolIndex
});
const navigation = new DawnlightNavigationService(documentStore, composition, symbolIndex);
let initializedWorkspaceFolders: string[] = [];

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

function rebuildComposition(changedPaths: readonly string[] = []): void {
  void composition.rebuild(discovery.snapshot).then(result => {
    if (result.applied) return symbolIndex.rebuild(result.snapshot, discovery.snapshot, changedPaths);
    return undefined;
  }).catch(error => {
    connection.console.error(`Could not compose Dawnlight workspace: ${(error as Error).message}`);
  });
}

function notifyWorkspaceChanged(snapshot: ReturnType<WorkspacePackDiscovery['refresh']>): void {
  connection.console.info(
    `Dawnlight workspace generation ${snapshot.generation}: ${snapshot.packs.length} pack(s).`
  );
  for (const document of documents.all()) void validateDocument(document);
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
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: diagnostics.map(diagnostic => ({
      range: diagnostic.range,
      message: typeof diagnostic.message === 'string'
        ? diagnostic.message
        : diagnostic.message.value,
      severity: diagnostic.severity,
      code: diagnostic.code,
      source: 'dawnlight-schema'
    }))
  });
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

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
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
  return document ? navigation.definition(document, params.position) : null;
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
  return mergeHover(schemaHover, navigation.hover(document, params.position));
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
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onShutdown(() => undefined);

documents.listen(connection);
connection.listen();
