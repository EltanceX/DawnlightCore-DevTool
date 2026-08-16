import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { CONTRACT_VERSIONS } from '@dawnlight/contracts';

export interface DawnlightExtensionApi {
  getServerStatus(): {
    running: boolean;
    languageServerProtocolVersion: number;
    schemaContractVersion: number;
  };
}

let client: LanguageClient | undefined;
let running = false;

export async function activate(context: vscode.ExtensionContext): Promise<DawnlightExtensionApi> {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };
  const workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(workspaceWatcher);

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'json' },
      { scheme: 'file', language: 'jsonc' }
    ],
    initializationOptions: {
      clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol
    },
    synchronize: {
      fileEvents: workspaceWatcher
    }
  };

  client = new LanguageClient(
    'dawnlightShaderPack',
    'Dawnlight Shader Pack Language Server',
    serverOptions,
    clientOptions
  );
  await client.start();
  running = true;

  return Object.freeze({
    getServerStatus: () => ({
      running,
      languageServerProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
      schemaContractVersion: CONTRACT_VERSIONS.schemaContract
    })
  });
}

export async function deactivate(): Promise<void> {
  running = false;
  const activeClient = client;
  client = undefined;
  if (activeClient) await activeClient.stop();
}
