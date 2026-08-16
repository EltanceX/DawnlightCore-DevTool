import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  findNodeAtLocation,
  getNodeValue,
  getLocation,
  getNodePath,
  Node,
  parseTree,
  ParseError,
  ParseOptions
} from 'jsonc-parser';
import { TextDocument } from 'vscode-languageserver-textdocument';

export interface JsoncPosition {
  line: number;
  character: number;
}

export interface JsoncRange {
  start: JsoncPosition;
  end: JsoncPosition;
}

export interface JsoncDocumentSnapshot {
  readonly uri: string;
  readonly absolutePath: string;
  readonly version: number;
  readonly source: 'disk' | 'overlay';
  readonly text: string;
  readonly value: unknown;
  readonly root?: Node;
  readonly errors: readonly ParseError[];
  readonly textDocument: TextDocument;
  nodeAtPath(path: readonly (string | number)[]): Node | undefined;
  nodePathAtOffset(offset: number): readonly (string | number)[];
  rangeForNode(node: Node): JsoncRange;
}

interface StoredOverlay {
  uri: string;
  absolutePath: string;
  version: number;
  text: string;
}

const jsoncParseOptions: ParseOptions = { allowTrailingComma: true };

function keyForPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function createSnapshot(
  uri: string,
  absolutePath: string,
  version: number,
  source: 'disk' | 'overlay',
  text: string
): JsoncDocumentSnapshot {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, jsoncParseOptions);
  const textDocument = TextDocument.create(uri, 'jsonc', version, text);
  return {
    uri,
    absolutePath,
    version,
    source,
    text,
    value: root ? getNodeValue(root) : undefined,
    root,
    errors: Object.freeze([...errors]),
    textDocument,
    nodeAtPath: nodePath => root ? findNodeAtLocation(root, [...nodePath]) : undefined,
    nodePathAtOffset: offset => root ? Object.freeze(getLocation(text, offset).path) : Object.freeze([]),
    rangeForNode: node => ({
      start: textDocument.positionAt(node.offset),
      end: textDocument.positionAt(node.offset + node.length)
    })
  };
}

export class JsoncDocumentStore {
  private readonly overlays = new Map<string, StoredOverlay>();
  private readonly cache = new Map<string, JsoncDocumentSnapshot>();

  open(uri: string, text: string, version: number): JsoncDocumentSnapshot {
    const absolutePath = fileURLToPath(uri);
    this.overlays.set(keyForPath(absolutePath), { uri, absolutePath, version, text });
    const snapshot = createSnapshot(uri, absolutePath, version, 'overlay', text);
    this.cache.set(keyForPath(absolutePath), snapshot);
    return snapshot;
  }

  update(uri: string, text: string, version: number): JsoncDocumentSnapshot {
    return this.open(uri, text, version);
  }

  close(uri: string): JsoncDocumentSnapshot | undefined {
    const absolutePath = fileURLToPath(uri);
    this.overlays.delete(keyForPath(absolutePath));
    this.cache.delete(keyForPath(absolutePath));
    return this.getByPath(absolutePath);
  }

  invalidate(filePath: string): void {
    if (!this.overlays.has(keyForPath(filePath))) this.cache.delete(keyForPath(filePath));
  }

  hasOverlay(filePath: string): boolean {
    return this.overlays.has(keyForPath(filePath));
  }

  getByUri(uri: string): JsoncDocumentSnapshot | undefined {
    return this.getByPath(fileURLToPath(uri));
  }

  getByPath(filePath: string): JsoncDocumentSnapshot | undefined {
    const absolutePath = path.normalize(path.resolve(filePath));
    const key = keyForPath(absolutePath);
    const overlay = this.overlays.get(key);
    if (overlay) {
      const cached = this.cache.get(key);
      return cached ?? this.open(overlay.uri, overlay.text, overlay.version);
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    let text: string;
    try {
      if (!fs.statSync(absolutePath).isFile()) return undefined;
      text = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return undefined;
    }
    const snapshot = createSnapshot(pathToFileURL(absolutePath).toString(), absolutePath, 0, 'disk', text);
    this.cache.set(key, snapshot);
    return snapshot;
  }

  getNodePath(snapshot: JsoncDocumentSnapshot, node: Node): readonly (string | number)[] {
    return Object.freeze(getNodePath(node));
  }

  clear(): void {
    this.overlays.clear();
    this.cache.clear();
  }
}
