import {
  createConnection,
  DidChangeWatchedFilesParams,
  DidChangeWorkspaceFoldersParams,
  InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONTRACT_VERSIONS,
  DawnlightWorkspaceSnapshot,
  DawnlightInitializeOptions,
  LSP_METHODS,
  SERVER_CAPABILITIES
} from '@dawnlight/contracts';
import { DawnlightSchemaService, DynamicSchemaRole } from './schemaService';
import {
  PackPathReference,
  ShaderPackProject,
  WorkspacePackDiscovery
} from './workspaceDiscovery';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const discovery = new WorkspacePackDiscovery([]);
const schemaService = new DawnlightSchemaService(path.resolve(__dirname, '..', 'schemas'));
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
  const previous = discovery.snapshot;
  const snapshot = changedPaths.length > 0
    ? discovery.handleFileEvents(changedPaths)
    : discovery.refresh();
  if (snapshot === previous) return;
  connection.console.info(
    `Dawnlight workspace generation ${snapshot.generation}: ${snapshot.packs.length} pack(s).`
  );
  for (const document of documents.all()) void validateDocument(document);
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
    for (const document of documents.all()) void validateDocument(document);
  }
);

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const changedPaths = params.changes
    .map(change => uriToPath(change.uri))
    .filter((changedPath): changedPath is string => changedPath !== undefined);
  refreshWorkspace(changedPaths);
});

connection.onRequest(LSP_METHODS.workspaceSnapshot, () => workspaceSnapshot());

connection.onCompletion(params => {
  const document = documents.get(params.textDocument.uri);
  return document ? schemaService.complete(document, params.position) : null;
});

connection.onHover(params => {
  const document = documents.get(params.textDocument.uri);
  return document ? schemaService.hover(document, params.position) : null;
});

documents.onDidOpen(event => {
  const documentPath = uriToPath(event.document.uri);
  if (documentPath) discovery.locatePackForDocument(documentPath);
  void validateDocument(event.document);
});

documents.onDidChangeContent(event => {
  void validateDocument(event.document);
});

documents.onDidClose(event => {
  schemaService.setRole(event.document, undefined);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

connection.onShutdown(() => undefined);

documents.listen(connection);
connection.listen();
