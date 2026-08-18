import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';
import {
  ANALYZER_METHODS,
  CONTRACT_VERSIONS,
  DEFAULT_ANALYZER_PROTOCOL_VERSIONS,
  DEFAULT_CATALOG_SNAPSHOT_VERSIONS,
  DawnlightAnalyzerInitializeResult,
  DawnlightAnalyzerDumpGraphParams,
  DawnlightAnalyzerDumpGraphResult,
  DawnlightAnalyzerExplainVariantParams,
  DawnlightAnalyzerExplainVariantResult,
  DawnlightAnalyzerGetCatalogParams,
  DawnlightAnalyzerGetCatalogResult,
  DawnlightAnalyzerStatus,
  DawnlightAnalyzerValidatePackParams,
  DawnlightAnalyzerValidatePackResult,
  parseDawnlightAnalyzerGetCatalogResult,
  parseDawnlightAnalyzerDumpGraphParams,
  parseDawnlightAnalyzerDumpGraphResult,
  parseDawnlightAnalyzerExplainVariantParams,
  parseDawnlightAnalyzerExplainVariantResult,
  DEFAULT_RUNTIME_GRAPH_VERSIONS,
  DEFAULT_VARIANT_EXPLAIN_VERSIONS
} from '@dawnlight/contracts';

interface AnalyzerClientOptions {
  analyzerPath?: string;
  catalogHash?: string;
  timeoutMs?: number;
  restartLimit?: number;
  onStderr?: (text: string) => void;
  onState?: (status: DawnlightAnalyzerStatus) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abortListener?: () => void;
}

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export class DawnlightAnalyzerRequestCancelledError extends Error {
  constructor(message = 'Analyzer request was cancelled.') {
    super(message);
    this.name = 'DawnlightAnalyzerRequestCancelledError';
  }
}

export function isAnalyzerRequestCancelled(error: unknown): boolean {
  return error instanceof DawnlightAnalyzerRequestCancelledError ||
    (error instanceof Error &&
      ((error as Error & { code?: number | string }).code === -32800 ||
        error.name === 'AbortError'));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asError(value: unknown): Error {
  if (isRecord(value) && typeof value.message === 'string') {
    const error = new Error(value.message);
    if (typeof value.code === 'number' || typeof value.code === 'string') {
      (error as Error & { code?: number | string }).code = value.code;
    }
    return error;
  }
  return new Error('Analyzer returned an unknown JSON-RPC error.');
}

function isMethodNotFound(error: unknown): boolean {
  if (!isRecord(error) && !(error instanceof Error)) return false;
  const code = (error as Error & { code?: number | string }).code;
  const message = error instanceof Error ? error.message :
    (typeof (error as Record<string, unknown>).message === 'string'
      ? String((error as Record<string, unknown>).message) : '');
  return code === -32601 || /method\s+(not\s+found|unknown)|not\s+implemented/i.test(message);
}

export class DawnlightAnalyzerClient {
  private options: Required<Pick<AnalyzerClientOptions, 'timeoutMs' | 'restartLimit'>> &
    Omit<AnalyzerClientOptions, 'timeoutMs' | 'restartLimit'>;
  private process?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<void>;
  private nextId = 1;
  private restartCount = 0;
  private state: DawnlightAnalyzerStatus['state'] = 'disabled';
  private lastError?: string;
  private protocolVersion?: number;
  private intentionalStop = false;
  private input = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly unsupportedMethods = new Set<string>();
  private activeOperations = 0;
  private processGeneration = 0;

  /** Changes whenever a sidecar process is replaced; callers use it in stale guards. */
  get epoch(): number {
    return this.processGeneration;
  }

  constructor(options: AnalyzerClientOptions = {}) {
    this.options = {
      timeoutMs: 10000,
      restartLimit: 3,
      ...options
    };
    this.publishState();
  }

  get status(): DawnlightAnalyzerStatus {
    return Object.freeze({
      state: this.options.analyzerPath ? this.state : 'disabled',
      path: this.options.analyzerPath,
      restartCount: this.restartCount,
      lastError: this.lastError,
      protocolVersion: this.protocolVersion
    });
  }

  configure(options: AnalyzerClientOptions): void {
    const changed = options.analyzerPath !== this.options.analyzerPath;
    this.options = {
      ...this.options,
      ...options,
      timeoutMs: options.timeoutMs ?? this.options.timeoutMs,
      restartLimit: options.restartLimit ?? this.options.restartLimit
    };
    if (changed) {
      void this.shutdown();
      this.unsupportedMethods.clear();
      this.restartCount = 0;
      this.lastError = undefined;
      this.state = this.options.analyzerPath ? 'offline' : 'disabled';
      this.publishState();
    }
  }

  async validatePack(
    params: DawnlightAnalyzerValidatePackParams
  ): Promise<DawnlightAnalyzerValidatePackResult | undefined> {
    if (!this.options.analyzerPath) return undefined;
    try {
      await this.ensureStarted();
    } catch {
      return undefined;
    }
    this.beginOperation();
    try {
      const result = await this.request<DawnlightAnalyzerValidatePackResult>(
        ANALYZER_METHODS.validatePack,
        params
      );
      if (!isRecord(result) || typeof result.requestVersion !== 'number' ||
        !Array.isArray(result.diagnostics)) {
        throw new Error('Analyzer returned an invalid validatePack result.');
      }
      return result;
    } catch (error) {
      if (this.process && !isAnalyzerRequestCancelled(error)) this.recordFailure(error);
      return undefined;
    } finally {
      this.endOperation();
    }
  }

  /**
   * Ask the optional Analyzer for its authoritative Catalog snapshot.
   *
   * Catalog export is deliberately best-effort: an older sidecar may not
   * implement the method, and an invalid/mismatched snapshot must never take
   * down the Language Server's local Catalog features.  Transport failures
   * still use the normal failure/restart policy, while contract/hash failures
   * leave a healthy sidecar running and return `undefined`.
   */
  async getCatalog(
    params: DawnlightAnalyzerGetCatalogParams = {}
  ): Promise<DawnlightAnalyzerGetCatalogResult | undefined> {
    if (!this.options.analyzerPath) return undefined;
    if (this.unsupportedMethods.has(ANALYZER_METHODS.getCatalog)) return undefined;
    try {
      await this.ensureStarted();
    } catch {
      return undefined;
    }

    const clientSupportedVersions = params.clientSupportedVersions ?? DEFAULT_CATALOG_SNAPSHOT_VERSIONS;
    if (!Array.isArray(clientSupportedVersions) ||
      clientSupportedVersions.some(version => !Number.isInteger(version) || version < 0) ||
      new Set(clientSupportedVersions).size !== clientSupportedVersions.length) {
      this.lastError = 'Analyzer Catalog request contains invalid supported versions.';
      this.state = this.process
        ? (this.activeOperations > 0 ? 'validating' : 'ready')
        : (this.options.analyzerPath ? 'offline' : 'disabled');
      this.publishState();
      return undefined;
    }
    const expectedCatalogHash = params.expectedCatalogHash ?? this.options.catalogHash;
    let raw: unknown;
    try {
      raw = await this.request<unknown>(ANALYZER_METHODS.getCatalog, {
        clientSupportedVersions,
        ...(expectedCatalogHash ? { expectedCatalogHash } : {})
      });
    } catch (error) {
      // JSON-RPC -32601 is a normal capability downgrade for V2 sidecars.
      // Keep the process alive so validatePack remains available.
      if (isMethodNotFound(error)) {
        this.lastError = errorMessage(error);
        this.unsupportedMethods.add(ANALYZER_METHODS.getCatalog);
        this.state = this.activeOperations > 0 ? 'validating' : 'ready';
        this.publishState();
        return undefined;
      }
      if (this.process) this.recordFailure(error);
      return undefined;
    }

    try {
      const result = parseDawnlightAnalyzerGetCatalogResult(raw);
      // A valid but incompatible Catalog is still returned to the caller so
      // the Language Server can expose an explicit `incompatible` state.  A
      // compatible response, however, must select the contract we requested.
      if (result.compatible && result.selectedVersion !== CONTRACT_VERSIONS.catalogSnapshot) {
        throw new Error('Analyzer Catalog contract negotiation failed.');
      }
      if (result.compatible && !clientSupportedVersions.includes(result.selectedVersion!)) {
        throw new Error('Analyzer Catalog selected a version the client did not advertise.');
      }
      if (!result.compatible && result.serverSupportedVersions?.some(version =>
        clientSupportedVersions.includes(version))) {
        throw new Error('Analyzer Catalog reported incompatible despite a common supported version.');
      }
      if (expectedCatalogHash && result.catalogHash.toLowerCase() !== expectedCatalogHash.toLowerCase()) {
        throw new Error('Analyzer Catalog hash does not match the active Catalog.');
      }
      this.lastError = undefined;
      this.state = this.activeOperations > 0 ? 'validating' : 'ready';
      this.publishState();
      return result;
    } catch (error) {
      // A malformed or stale export is a non-fatal Analyzer protocol issue;
      // callers can continue using the bundled/local Catalog.
      this.lastError = errorMessage(error);
      this.state = this.process
        ? (this.activeOperations > 0 ? 'validating' : 'ready')
        : (this.options.analyzerPath ? 'offline' : 'disabled');
      this.publishState();
      return undefined;
    }
  }

  async dumpGraph(
    params: DawnlightAnalyzerDumpGraphParams,
    signal?: AbortSignal
  ): Promise<DawnlightAnalyzerDumpGraphResult | undefined> {
    return this.runtimeRequest(
      ANALYZER_METHODS.dumpGraph,
      params,
      parseDawnlightAnalyzerDumpGraphParams,
      parseDawnlightAnalyzerDumpGraphResult,
      DEFAULT_RUNTIME_GRAPH_VERSIONS,
      signal
    );
  }

  async explainVariant(
    params: DawnlightAnalyzerExplainVariantParams,
    signal?: AbortSignal
  ): Promise<DawnlightAnalyzerExplainVariantResult | undefined> {
    return this.runtimeRequest(
      ANALYZER_METHODS.explainVariant,
      params,
      parseDawnlightAnalyzerExplainVariantParams,
      parseDawnlightAnalyzerExplainVariantResult,
      DEFAULT_VARIANT_EXPLAIN_VERSIONS,
      signal
    );
  }

  async restart(): Promise<void> {
    await this.stopProcess();
    this.unsupportedMethods.clear();
    this.restartCount = 0;
    this.lastError = undefined;
    this.state = this.options.analyzerPath ? 'offline' : 'disabled';
    this.publishState();
  }

  async shutdown(): Promise<void> {
    await this.stopProcess(true);
    this.unsupportedMethods.clear();
    this.state = this.options.analyzerPath ? 'offline' : 'disabled';
    this.publishState();
  }

  private ensureStarted(): Promise<void> {
    // A single sidecar serves initialize, Catalog, and validation requests.
    // Validation changes the state to `validating`, but must not make a
    // concurrent request spawn a second process.  `startPromise` covers the
    // startup window; once ready/validating, the existing process is already
    // usable.
    if (this.process && this.startPromise) return this.startPromise;
    if (this.process && (this.state === 'ready' || this.state === 'validating')) {
      return Promise.resolve();
    }
    if (this.restartCount > this.options.restartLimit) {
      return Promise.reject(new Error('Analyzer automatic restart limit was reached.'));
    }
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startWithRetries().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  private async startWithRetries(): Promise<void> {
    while (true) {
      try {
        await this.startOnce();
        return;
      } catch (error) {
        if (this.process) this.recordFailure(error);
        if (this.restartCount > this.options.restartLimit) throw error;
      }
    }
  }

  private async startOnce(): Promise<void> {
    const analyzerPath = this.options.analyzerPath;
    if (!analyzerPath) throw new Error('Analyzer path is not configured.');
    this.state = 'starting';
    this.publishState();
    const absolutePath = path.resolve(analyzerPath);
    const extension = path.extname(absolutePath).toLowerCase();
    const command = extension === '.js' ? process.execPath : extension === '.dll' ? 'dotnet' : absolutePath;
    const args = extension === '.js' || extension === '.dll' ? [absolutePath] : [];
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });
    this.processGeneration += 1;
    this.process = child;
    this.intentionalStop = false;
    this.input = Buffer.alloc(0);
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.readOutput(chunk as Buffer));
    child.stderr.on('data', chunk => this.options.onStderr?.(String(chunk)));
    const exit = new Promise<never>((_, reject) => {
      const failed = (error: Error) => {
        if (this.process === child) {
          this.process = undefined;
          this.failPending(error);
          if (!this.intentionalStop) {
            this.lastError = error.message;
            this.restartCount += 1;
            this.state = 'offline';
            this.publishState();
          }
        }
        reject(error);
      };
      child.once('error', error => failed(error));
      child.once('exit', (code, signal) => {
        if (!this.intentionalStop) {
          failed(new Error(`Analyzer exited unexpectedly (${code ?? 'null'}/${signal ?? 'none'}).`));
        }
      });
    });
    try {
      const initialize = this.request<DawnlightAnalyzerInitializeResult>(
        ANALYZER_METHODS.initialize,
        {
          protocolVersion: CONTRACT_VERSIONS.analyzerProtocol,
          clientSupportedVersions: DEFAULT_ANALYZER_PROTOCOL_VERSIONS,
          catalogHash: this.options.catalogHash
        }
      );
      const result = await Promise.race([initialize, exit]);
      if (!isRecord(result) || result.compatible !== true ||
        result.selectedVersion !== CONTRACT_VERSIONS.analyzerProtocol) {
        throw new Error('Analyzer protocol negotiation failed.');
      }
      this.protocolVersion = result.selectedVersion;
      this.unsupportedMethods.clear();
      this.state = 'ready';
      this.publishState();
    } catch (error) {
      throw error;
    }
  }

  private request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const child = this.process;
    if (!child || child.stdin.destroyed) return Promise.reject(new Error('Analyzer process is not running.'));
    if (signal?.aborted) return Promise.reject(new DawnlightAnalyzerRequestCancelledError());
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const frame = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
    if (Buffer.byteLength(frame, 'utf8') > MAX_MESSAGE_BYTES) {
      return Promise.reject(new Error('Analyzer request exceeds the message size limit.'));
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (pending?.signal && pending.abortListener) {
          pending.signal.removeEventListener('abort', pending.abortListener);
        }
        reject(new Error(`Analyzer request '${method}' timed out.`));
      }, this.options.timeoutMs);
      const abortListener = signal ? () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        signal.removeEventListener('abort', abortListener!);
        this.sendNotification('$/cancelRequest', { id });
        reject(new DawnlightAnalyzerRequestCancelledError(
          `Analyzer request '${method}' was cancelled.`
        ));
      } : undefined;
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timer,
        signal,
        abortListener
      });
      if (signal && abortListener) signal.addEventListener('abort', abortListener, { once: true });
      child.stdin.write(frame, error => {
        if (!error) return;
        clearTimeout(timer);
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (pending?.signal && pending.abortListener) {
          pending.signal.removeEventListener('abort', pending.abortListener);
        }
        reject(error);
      });
    });
  }

  private async runtimeRequest<Params, Result>(
    method: string,
    rawParams: Params,
    parseParams: (value: unknown) => Params,
    parseResult: (value: unknown) => Result,
    supportedVersions: readonly number[],
    signal?: AbortSignal
  ): Promise<Result | undefined> {
    if (!this.options.analyzerPath) return undefined;
    if (this.unsupportedMethods.has(method)) return undefined;
    let params: Params;
    try {
      params = parseParams(rawParams);
    } catch (error) {
      this.lastError = errorMessage(error);
      this.state = this.process
        ? (this.activeOperations > 0 ? 'validating' : 'ready')
        : (this.options.analyzerPath ? 'offline' : 'disabled');
      this.publishState();
      return undefined;
    }
    try {
      await this.ensureStarted();
    } catch {
      return undefined;
    }
    this.beginOperation();
    try {
      const result = parseResult(await this.request<unknown>(method, {
        ...params as Record<string, unknown>,
        clientSupportedVersions: supportedVersions
      }, signal));
      const requestRecord = params as Record<string, unknown>;
      const resultRecord = result as Record<string, unknown>;
      if (resultRecord.requestVersion !== requestRecord.requestVersion ||
        resultRecord.catalogHash !== requestRecord.catalogHash) {
        throw new Error(`Analyzer ${method} response does not echo the request version/catalog hash.`);
      }
      this.lastError = undefined;
      return result;
    } catch (error) {
      if (!isAnalyzerRequestCancelled(error) && this.process && !isMethodNotFound(error)) {
        this.lastError = errorMessage(error);
        // A malformed payload is non-fatal; a transport timeout/crash follows
        // the existing restart policy and takes the sidecar offline.
        if (/timed out|exited unexpectedly|not running|Content-Length|invalid JSON/i.test(errorMessage(error))) {
          this.recordFailure(error);
        } else {
          this.state = 'validating';
          this.publishState();
        }
      } else if (isMethodNotFound(error)) {
        this.lastError = errorMessage(error);
        this.unsupportedMethods.add(method);
      }
      return undefined;
    } finally {
      this.endOperation();
    }
  }

  private sendNotification(method: string, params: unknown): void {
    const child = this.process;
    if (!child || child.stdin.destroyed) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    const frame = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
    if (Buffer.byteLength(frame, 'utf8') > MAX_MESSAGE_BYTES) return;
    child.stdin.write(frame, () => undefined);
  }

  private beginOperation(): void {
    this.activeOperations += 1;
    this.state = 'validating';
    this.publishState();
  }

  private endOperation(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
    if (!this.process) {
      this.state = this.options.analyzerPath ? 'offline' : 'disabled';
    } else {
      this.state = this.activeOperations > 0 ? 'validating' : 'ready';
    }
    this.publishState();
  }

  private readOutput(chunk: Buffer): void {
    this.input = Buffer.concat([this.input, chunk]);
    while (true) {
      const separator = this.input.indexOf(Buffer.from('\r\n\r\n', 'ascii'));
      if (separator < 0) {
        if (this.input.length > MAX_MESSAGE_BYTES) {
          this.failPending(new Error('Analyzer response exceeds the message size limit.'));
        }
        return;
      }
      const headers = this.input.subarray(0, separator).toString('ascii').split('\r\n');
      const lengthHeader = headers.find(header => /^content-length:/i.test(header));
      const length = lengthHeader ? Number(lengthHeader.slice(lengthHeader.indexOf(':') + 1).trim()) : NaN;
      if (!Number.isInteger(length) || length < 0 || length > MAX_MESSAGE_BYTES) {
        this.failPending(new Error('Analyzer response has an invalid Content-Length header.'));
        return;
      }
      const bodyStart = separator + 4;
      if (this.input.length - bodyStart < length) return;
      const body = this.input.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.input = this.input.subarray(bodyStart + length);
      let message: unknown;
      try {
        message = JSON.parse(body);
      } catch {
        this.failPending(new Error('Analyzer returned invalid JSON.'));
        return;
      }
      this.handleMessage(message);
    }
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message) || typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }
    if (isRecord(message.error)) pending.reject(asError(message.error));
    else pending.resolve(message.result);
  }

  private recordFailure(error: unknown): void {
    this.lastError = errorMessage(error);
    if (!this.intentionalStop) this.restartCount += 1;
    this.state = this.options.analyzerPath ? 'offline' : 'disabled';
    this.publishState();
    void this.stopProcess();
  }

  private async stopProcess(intentional = false): Promise<void> {
    const child = this.process;
    if (!child) return;
    this.intentionalStop = intentional;
    if (intentional && child.stdin.writable) {
      try {
        await this.request(ANALYZER_METHODS.shutdown, {});
      } catch {
        // The process may already be exiting; termination below is authoritative.
      }
    }
    if (!child.killed) child.kill();
    this.process = undefined;
    this.failPending(new Error('Analyzer process stopped.'));
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      if (pending.signal && pending.abortListener) {
        pending.signal.removeEventListener('abort', pending.abortListener);
      }
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private publishState(): void {
    this.options.onState?.(this.status);
  }
}
