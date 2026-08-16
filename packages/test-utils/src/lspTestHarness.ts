import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import {
  createMessageConnection,
  Logger,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-jsonrpc/node';
import { DawnlightInitializeOptions } from '@dawnlight/contracts';

const silentLogger: Logger = {
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  log: () => undefined
};

export interface LanguageServerInitializeResult {
  capabilities: {
    textDocumentSync?: number;
    experimental?: {
      dawnlight?: unknown;
    };
  };
  serverInfo?: {
    name: string;
    version?: string;
  };
}

export class LspTestHarness {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly connection: MessageConnection;
  private stderr = '';

  private constructor(child: ChildProcessWithoutNullStreams, connection: MessageConnection) {
    this.child = child;
    this.connection = connection;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      this.stderr += chunk;
    });
  }

  static async start(
    serverPath: string,
    initializationOptions: DawnlightInitializeOptions
  ): Promise<{ harness: LspTestHarness; result: LanguageServerInitializeResult }> {
    const child = spawn(process.execPath, [serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
      silentLogger
    );
    connection.listen();
    const harness = new LspTestHarness(child, connection);
    const result = await connection.sendRequest<LanguageServerInitializeResult>('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      workspaceFolders: null,
      initializationOptions
    });
    connection.sendNotification('initialized', {});
    return { harness, result };
  }

  async shutdown(timeoutMs = 5000): Promise<void> {
    await this.connection.sendRequest('shutdown');
    this.connection.sendNotification('exit');
    await this.waitForExit(timeoutMs);
    this.connection.dispose();
    if (this.child.exitCode !== 0) {
      throw new Error(`Language server exited with ${this.child.exitCode}: ${this.stderr}`);
    }
  }

  hasExited(): boolean {
    return this.child.exitCode !== null;
  }

  private waitForExit(timeoutMs: number): Promise<void> {
    if (this.child.exitCode !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.child.kill();
        reject(new Error(`Language server did not exit within ${timeoutMs} ms: ${this.stderr}`));
      }, timeoutMs);
      this.child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.child.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}
