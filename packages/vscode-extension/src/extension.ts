import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { CONTRACT_VERSIONS, LSP_METHODS } from '@dawnlight/contracts';

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
  const configuredPath = vscode.workspace
    .getConfiguration('dawnlight.shaderPack')
    .get<string>('catalog.path', '')
    .trim();
  const configuredAnalyzerPath = vscode.workspace
    .getConfiguration('dawnlight.shaderPack.analyzer')
    .get<string>('path', '')
    .trim();
  const validationConfig = vscode.workspace.getConfiguration('dawnlight.shaderPack.validation');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const catalogPath = configuredPath
    ? path.resolve(workspaceRoot ?? process.cwd(), configuredPath.replace('${workspaceFolder}', workspaceRoot ?? ''))
    : undefined;
  const analyzerPath = configuredAnalyzerPath
    ? path.resolve(workspaceRoot ?? process.cwd(), configuredAnalyzerPath.replace('${workspaceFolder}', workspaceRoot ?? ''))
    : undefined;

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'json' },
      { scheme: 'file', language: 'jsonc' }
    ],
    initializationOptions: {
      clientProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
      catalogSnapshotVersions: [CONTRACT_VERSIONS.catalogSnapshot],
      catalogPath,
      analyzerPath,
      analyzerTimeoutMs: validationConfig.get<number>('timeoutMs', 10000),
      analyzerRestartLimit: validationConfig.get<number>('restartLimit', 3),
      validationOnSave: validationConfig.get<boolean>('onSave', true)
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
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(
    'dawnlight-catalog',
    {
      provideTextDocumentContent: uri => client
        ? client.sendRequest<string | null>(LSP_METHODS.catalogDocument, { uri: uri.toString() })
          .then(content => content ?? 'Catalog entry is no longer available.\n')
        : 'Dawnlight Language Server is not running.\n'
    }
  ));
  context.subscriptions.push(vscode.commands.registerCommand('dawnlight.validateShaderPack', async () => {
    if (!client) return;
    await client.sendRequest(LSP_METHODS.validatePack, {});
  }));
  context.subscriptions.push(vscode.commands.registerCommand('dawnlight.restartAnalyzer', async () => {
    if (!client) return;
    await client.sendRequest(LSP_METHODS.restartAnalyzer, {});
  }));
  context.subscriptions.push(vscode.commands.registerCommand('dawnlight.refreshAnalyzerCatalog', async () => {
    if (!client) return;
    const status = await client.sendRequest(LSP_METHODS.analyzerCatalog, {});
    if (status && typeof status === 'object' && status !== null && 'state' in status) {
      const state = String((status as { state?: unknown }).state);
      const message = (status as { message?: unknown }).message;
      if (state === 'match') {
        void vscode.window.showInformationMessage('Dawnlight Analyzer Catalog matches the active Catalog.');
      } else {
        void vscode.window.showWarningMessage(
          `Dawnlight Analyzer Catalog status: ${state}${typeof message === 'string' ? ` (${message})` : ''}`
        );
      }
    }
  }));

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
