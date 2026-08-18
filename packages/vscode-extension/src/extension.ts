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

interface RuntimeViewCandidate {
  programId: string;
  label?: string;
  description?: string;
  detail?: string;
}

interface RuntimeViewResult {
  documentUri?: string;
  candidates?: readonly RuntimeViewCandidate[];
  message?: string;
}

interface RuntimeViewQuickPickItem extends vscode.QuickPickItem {
  programId: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runtimeViewUnavailableMessage(
  viewName: 'runtime graph' | 'program variant',
  result?: RuntimeViewResult
): string {
  const detail = result?.message?.trim();
  return `${viewName === 'runtime graph' ? 'Runtime graph' : 'Program variant explanation'} is unavailable. ${
    detail || 'Open a document inside a discovered shader pack and configure a compatible Dawnlight Analyzer.'
  }`;
}

function activeRuntimeViewParams(): { documentUri: string; position: { line: number; character: number } } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(
      'Open a shader pack JSON/JSONC document before requesting a Dawnlight runtime view.'
    );
    return undefined;
  }
  return {
    documentUri: editor.document.uri.toString(),
    position: {
      line: editor.selection.active.line,
      character: editor.selection.active.character
    }
  };
}

async function openRuntimeViewDocument(
  result: RuntimeViewResult | null | undefined,
  viewName: 'runtime graph' | 'program variant'
): Promise<boolean> {
  if (!result?.documentUri) {
    void vscode.window.showWarningMessage(runtimeViewUnavailableMessage(viewName, result ?? undefined));
    return false;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(result.documentUri));
  const markdownDocument = document.languageId === 'markdown'
    ? document
    : await vscode.languages.setTextDocumentLanguage(document, 'markdown');
  await vscode.window.showTextDocument(markdownDocument, { preview: true });
  return true;
}

function candidateQuickPickItems(candidates: readonly RuntimeViewCandidate[] | undefined): RuntimeViewQuickPickItem[] {
  if (!candidates) return [];
  return candidates
    .filter(candidate => typeof candidate.programId === 'string' && candidate.programId.length > 0)
    .map(candidate => ({
      label: candidate.label || candidate.programId,
      description: candidate.description,
      detail: candidate.detail,
      programId: candidate.programId
    }));
}

async function provideRuntimeViewDocument(
  uri: vscode.Uri,
  method: string,
  missingText: string
): Promise<string> {
  if (!client) return `${missingText}\nThe Language Server is not running.\n`;
  try {
    const content = await client.sendRequest<string | null>(method, { uri: uri.toString() });
    return content ?? missingText;
  } catch (error) {
    return `${missingText}\n${errorMessage(error)}\n`;
  }
}

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
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(
    'dawnlight-graph',
    {
      provideTextDocumentContent: uri => provideRuntimeViewDocument(
        uri,
        LSP_METHODS.graphDocument,
        '# Runtime graph unavailable\n\nThis graph snapshot is no longer available. Run **Dawnlight: Open Runtime Graph** again.\n'
      )
    }
  ));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(
    'dawnlight-variant',
    {
      provideTextDocumentContent: uri => provideRuntimeViewDocument(
        uri,
        LSP_METHODS.variantDocument,
        '# Program variant unavailable\n\nThis variant snapshot is no longer available. Run **Dawnlight: Explain Program Variant** again.\n'
      )
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
  context.subscriptions.push(vscode.commands.registerCommand('dawnlight.openRuntimeGraph', async () => {
    if (!client) {
      void vscode.window.showWarningMessage(runtimeViewUnavailableMessage('runtime graph'));
      return;
    }
    const params = activeRuntimeViewParams();
    if (!params) return;
    try {
      const result = await client.sendRequest<RuntimeViewResult | null>(LSP_METHODS.dumpGraph, params);
      await openRuntimeViewDocument(result, 'runtime graph');
    } catch (error) {
      void vscode.window.showErrorMessage(`Unable to open the Dawnlight runtime graph: ${errorMessage(error)}`);
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('dawnlight.explainProgramVariant', async () => {
    if (!client) {
      void vscode.window.showWarningMessage(runtimeViewUnavailableMessage('program variant'));
      return;
    }
    const params = activeRuntimeViewParams();
    if (!params) return;
    try {
      let result = await client.sendRequest<RuntimeViewResult | null>(LSP_METHODS.explainVariant, params);
      if (!result?.documentUri) {
        const items = candidateQuickPickItems(result?.candidates);
        if (items.length > 0) {
          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select the Dawnlight program variant to explain',
            matchOnDescription: true,
            matchOnDetail: true
          });
          if (!selected) return;
          result = await client.sendRequest<RuntimeViewResult | null>(LSP_METHODS.explainVariant, {
            ...params,
            programId: selected.programId
          });
        }
      }
      await openRuntimeViewDocument(result, 'program variant');
    } catch (error) {
      void vscode.window.showErrorMessage(`Unable to explain the Dawnlight program variant: ${errorMessage(error)}`);
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
