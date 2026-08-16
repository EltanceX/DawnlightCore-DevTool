import {
  createConnection,
  InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CONTRACT_VERSIONS,
  DawnlightInitializeOptions,
  SERVER_CAPABILITIES
} from '@dawnlight/contracts';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(params => {
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
  connection.console.info('Dawnlight language server initialized.');
});

connection.onShutdown(() => undefined);

documents.listen(connection);
connection.listen();
