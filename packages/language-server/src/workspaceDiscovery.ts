import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';
import { createDiagnosticCode } from '@dawnlight/contracts';

export const DEFAULT_EXCLUDED_DIRECTORIES = Object.freeze([
  '.git',
  '.vscode-test',
  'node_modules',
  'bin',
  'obj',
  'dist',
  'out'
] as const);

export type PackDocumentRole = 'fragment' | 'settings' | 'shaderRoot';

export interface WorkspaceDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export interface PackPathReference {
  role: PackDocumentRole;
  rawPath: string;
  path: string;
  absolutePath: string;
  exists: boolean;
  valid: boolean;
}

export interface ShaderPackProject {
  rootPath: string;
  manifestPath: string;
  id?: string;
  valid: boolean;
  generation: number;
  fragments: readonly PackPathReference[];
  settings?: PackPathReference;
  shaderRoot?: PackPathReference;
  diagnostics: readonly WorkspaceDiagnostic[];
}

export interface AmbiguousDocument {
  absolutePath: string;
  packRoots: readonly string[];
}

export interface WorkspaceDiscoverySnapshot {
  generation: number;
  packs: readonly ShaderPackProject[];
  ambiguousDocuments: readonly AmbiguousDocument[];
}

export interface DocumentAssociation {
  pack: ShaderPackProject;
  role: 'root' | PackDocumentRole | 'untracked';
  reference?: PackPathReference;
}

export class PackPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackPathError';
  }
}

interface MutablePack {
  rootPath: string;
  manifestPath: string;
  id?: string;
  valid: boolean;
  generation: number;
  fragments: PackPathReference[];
  settings?: PackPathReference;
  shaderRoot?: PackPathReference;
  diagnostics: WorkspaceDiagnostic[];
}

interface MutableOwnership {
  absolutePath: string;
  packRoots: Map<string, string>;
}

function comparisonKey(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function canonicalExistingPath(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizePackRelativePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PackPathError('Path must be a non-empty string.');
  }
  if (value.includes('\\')) {
    throw new PackPathError('Path must use forward slashes.');
  }
  if (value.includes('\0')) {
    throw new PackPathError('Path must not contain a null character.');
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new PackPathError('Path must be relative to the shader pack root.');
  }
  const segments = value.split('/');
  if (segments.some(segment => segment.length === 0)) {
    throw new PackPathError('Path must not contain an empty segment.');
  }
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new PackPathError('Path must not contain dot segments.');
  }
  return segments.join('/');
}

function findManifestFiles(workspaceRoot: string, excluded: ReadonlySet<string>): string[] {
  const manifests: string[] = [];
  const pending = [workspaceRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name.toLowerCase())) pending.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === 'shaderpack.json') {
        manifests.push(canonicalExistingPath(fullPath));
      }
    }
  }
  return manifests;
}

function readRootManifest(manifestPath: string, diagnostics: WorkspaceDiagnostic[]): Record<string, unknown> | undefined {
  let source: string;
  try {
    source = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    diagnostics.push({
      code: createDiagnosticCode('json', 1),
      message: `Could not read shaderpack.json: ${(error as Error).message}`
    });
    return undefined;
  }

  const parseErrors: ParseError[] = [];
  const value = parse(source, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0 || !isRecord(value)) {
    const detail = parseErrors.length > 0
      ? printParseErrorCode(parseErrors[0].error)
      : 'Root value must be an object';
    diagnostics.push({
      code: createDiagnosticCode('json', 1),
      message: `shaderpack.json is temporarily invalid: ${detail}.`
    });
    return undefined;
  }
  return value;
}

function resolveReference(
  packRoot: string,
  role: PackDocumentRole,
  rawValue: unknown,
  diagnostics: WorkspaceDiagnostic[],
  expectedKind: 'file' | 'directory'
): PackPathReference | undefined {
  if (typeof rawValue !== 'string') {
    diagnostics.push({
      code: createDiagnosticCode('path', 1),
      message: `${role} path must be a string.`
    });
    return undefined;
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizePackRelativePath(rawValue);
  } catch (error) {
    diagnostics.push({
      code: createDiagnosticCode('path', 1),
      message: `${role} path '${rawValue}' is invalid: ${(error as Error).message}`,
      path: rawValue
    });
    return undefined;
  }

  if (normalizedPath.toLowerCase() === 'shaderpack.json') {
    diagnostics.push({
      code: createDiagnosticCode('path', 3),
      message: `${role} path must not include shaderpack.json itself.`,
      path: normalizedPath
    });
    return undefined;
  }

  const absolutePath = path.resolve(packRoot, ...normalizedPath.split('/'));
  if (!isWithin(packRoot, absolutePath)) {
    diagnostics.push({
      code: createDiagnosticCode('path', 5),
      message: `${role} path escapes the shader pack root.`,
      path: normalizedPath
    });
    return undefined;
  }

  const exists = fs.existsSync(absolutePath);
  let valid = true;
  if (exists) {
    const canonicalRoot = canonicalExistingPath(packRoot);
    const canonicalTarget = canonicalExistingPath(absolutePath);
    if (!isWithin(canonicalRoot, canonicalTarget)) {
      diagnostics.push({
        code: createDiagnosticCode('path', 5),
        message: `${role} path resolves outside the shader pack root.`,
        path: normalizedPath
      });
      valid = false;
    } else {
      try {
        const stat = fs.statSync(absolutePath);
        const correctKind = expectedKind === 'file' ? stat.isFile() : stat.isDirectory();
        if (!correctKind) {
          diagnostics.push({
            code: createDiagnosticCode('path', 4),
            message: `${role} path does not reference a ${expectedKind}.`,
            path: normalizedPath
          });
          valid = false;
        }
      } catch {
        diagnostics.push({
          code: createDiagnosticCode('path', 4),
          message: `${role} path disappeared while the pack was being scanned.`,
          path: normalizedPath
        });
        valid = false;
      }
    }
  } else {
    diagnostics.push({
      code: createDiagnosticCode('path', 4),
      message: `${role} path does not exist.`,
      path: normalizedPath
    });
    valid = false;
  }

  return Object.freeze({
    role,
    rawPath: rawValue,
    path: normalizedPath,
    absolutePath: path.normalize(absolutePath),
    exists,
    valid
  });
}

function buildPack(manifestPath: string, generation: number): MutablePack {
  const rootPath = path.dirname(manifestPath);
  const diagnostics: WorkspaceDiagnostic[] = [];
  const manifest = readRootManifest(manifestPath, diagnostics);
  const pack: MutablePack = {
    rootPath,
    manifestPath,
    valid: manifest !== undefined,
    generation,
    fragments: [],
    diagnostics
  };
  if (!manifest) return pack;

  if (typeof manifest.id === 'string') pack.id = manifest.id;

  const seenPaths = new Set<string>();
  if (manifest.fragments !== undefined && !Array.isArray(manifest.fragments)) {
    diagnostics.push({
      code: createDiagnosticCode('path', 1),
      message: 'fragments must be an array of pack-relative paths.'
    });
  } else if (Array.isArray(manifest.fragments)) {
    for (const rawPath of manifest.fragments) {
      const reference = resolveReference(rootPath, 'fragment', rawPath, diagnostics, 'file');
      if (!reference) continue;
      const key = comparisonKey(reference.absolutePath);
      if (seenPaths.has(key)) {
        diagnostics.push({
          code: createDiagnosticCode('path', 2),
          message: `Fragment path '${reference.path}' is duplicated.`,
          path: reference.path
        });
        pack.fragments.push(Object.freeze({ ...reference, valid: false }));
      } else {
        seenPaths.add(key);
        pack.fragments.push(reference);
      }
    }
  }

  if (manifest.settings !== undefined) {
    pack.settings = resolveReference(rootPath, 'settings', manifest.settings, diagnostics, 'file');
  }
  if (manifest.shaderRoot !== undefined) {
    pack.shaderRoot = resolveReference(rootPath, 'shaderRoot', manifest.shaderRoot, diagnostics, 'directory');
  }
  pack.valid = diagnostics.length === 0;
  return pack;
}

function freezePack(pack: MutablePack): ShaderPackProject {
  return Object.freeze({
    ...pack,
    fragments: Object.freeze([...pack.fragments]),
    diagnostics: Object.freeze(pack.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })))
  });
}

export class WorkspacePackDiscovery {
  private workspaceFolders: string[];
  private readonly excludedDirectories: ReadonlySet<string>;
  private current: WorkspaceDiscoverySnapshot = Object.freeze({
    generation: 0,
    packs: Object.freeze([]),
    ambiguousDocuments: Object.freeze([])
  });

  constructor(workspaceFolders: readonly string[], excludedDirectories: readonly string[] = []) {
    this.workspaceFolders = this.normalizeWorkspaceFolders(workspaceFolders);
    this.excludedDirectories = new Set(
      [...DEFAULT_EXCLUDED_DIRECTORIES, ...excludedDirectories].map(value => value.toLowerCase())
    );
  }

  get snapshot(): WorkspaceDiscoverySnapshot {
    return this.current;
  }

  setWorkspaceFolders(workspaceFolders: readonly string[]): WorkspaceDiscoverySnapshot {
    this.workspaceFolders = this.normalizeWorkspaceFolders(workspaceFolders);
    return this.refresh();
  }

  refresh(): WorkspaceDiscoverySnapshot {
    const generation = this.current.generation + 1;
    const manifestByKey = new Map<string, string>();
    for (const workspaceFolder of this.workspaceFolders) {
      for (const manifestPath of findManifestFiles(workspaceFolder, this.excludedDirectories)) {
        manifestByKey.set(comparisonKey(manifestPath), manifestPath);
      }
    }

    const mutablePacks = [...manifestByKey.values()]
      .sort((left, right) => left.localeCompare(right))
      .map(manifestPath => buildPack(manifestPath, generation));
    const ownership = this.createOwnershipMap(mutablePacks);
    const ambiguousDocuments: AmbiguousDocument[] = [];
    for (const item of ownership.values()) {
      if (item.packRoots.size < 2) continue;
      const packRoots = [...item.packRoots.values()].sort();
      ambiguousDocuments.push(Object.freeze({
        absolutePath: item.absolutePath,
        packRoots: Object.freeze(packRoots)
      }));
      for (const root of packRoots) {
        const pack = mutablePacks.find(candidate =>
          comparisonKey(candidate.rootPath) === comparisonKey(root));
        if (pack) {
          pack.valid = false;
          pack.diagnostics.push({
            code: createDiagnosticCode('path', 6),
            message: 'Document is explicitly owned by more than one shader pack.',
            path: path.relative(pack.rootPath, item.absolutePath).split(path.sep).join('/')
          });
        }
      }
    }

    ambiguousDocuments.sort((left, right) =>
      left.absolutePath.localeCompare(right.absolutePath));

    const next = Object.freeze({
      generation,
      packs: Object.freeze(mutablePacks.map(freezePack)),
      ambiguousDocuments: Object.freeze(ambiguousDocuments)
    });
    this.current = next;
    return next;
  }

  handleFileEvents(changedPaths: readonly string[]): WorkspaceDiscoverySnapshot {
    return changedPaths.some(changedPath => this.isRelevantFileEvent(changedPath))
      ? this.refresh()
      : this.current;
  }

  locatePackForDocument(documentPath: string): ShaderPackProject | undefined {
    let pack = this.findPackForDocument(documentPath);
    if (pack) return pack;
    const nearestRoot = this.findNearestPackRoot(documentPath);
    if (!nearestRoot) return undefined;
    this.refresh();
    pack = this.current.packs.find(candidate =>
      comparisonKey(candidate.rootPath) === comparisonKey(nearestRoot));
    return pack;
  }

  findPackForDocument(documentPath: string): ShaderPackProject | undefined {
    const absolutePath = path.resolve(documentPath);
    return this.current.packs
      .filter(pack => isWithin(pack.rootPath, absolutePath) &&
        !this.hasExcludedRelativeSegment(pack.rootPath, absolutePath))
      .sort((left, right) => right.rootPath.length - left.rootPath.length)[0];
  }

  getDocumentAssociation(documentPath: string): DocumentAssociation | undefined {
    const pack = this.locatePackForDocument(documentPath);
    if (!pack) return undefined;
    const key = comparisonKey(documentPath);
    if (comparisonKey(pack.manifestPath) === key) return { pack, role: 'root' };
    for (const reference of pack.fragments) {
      if (comparisonKey(reference.absolutePath) === key) {
        return { pack, role: 'fragment', reference };
      }
    }
    if (pack.settings && comparisonKey(pack.settings.absolutePath) === key) {
      return { pack, role: 'settings', reference: pack.settings };
    }
    if (pack.shaderRoot && isWithin(pack.shaderRoot.absolutePath, path.resolve(documentPath))) {
      return { pack, role: 'shaderRoot', reference: pack.shaderRoot };
    }
    return { pack, role: 'untracked' };
  }

  private normalizeWorkspaceFolders(workspaceFolders: readonly string[]): string[] {
    const byKey = new Map<string, string>();
    for (const workspaceFolder of workspaceFolders) {
      const canonical = canonicalExistingPath(workspaceFolder);
      byKey.set(comparisonKey(canonical), canonical);
    }
    return [...byKey.values()];
  }

  private createOwnershipMap(packs: readonly MutablePack[]): Map<string, MutableOwnership> {
    const ownership = new Map<string, MutableOwnership>();
    const addOwner = (absolutePath: string, packRoot: string) => {
      const key = comparisonKey(absolutePath);
      const item = ownership.get(key) ?? {
        absolutePath: path.normalize(absolutePath),
        packRoots: new Map<string, string>()
      };
      item.packRoots.set(comparisonKey(packRoot), packRoot);
      ownership.set(key, item);
    };
    for (const pack of packs) {
      addOwner(pack.manifestPath, pack.rootPath);
      for (const reference of pack.fragments) addOwner(reference.absolutePath, pack.rootPath);
      if (pack.settings) addOwner(pack.settings.absolutePath, pack.rootPath);
    }
    return ownership;
  }

  private findNearestPackRoot(documentPath: string): string | undefined {
    const absolutePath = path.resolve(documentPath);
    const workspaceRoot = this.workspaceFolders
      .filter(folder => isWithin(folder, absolutePath))
      .sort((left, right) => right.length - left.length)[0];
    if (!workspaceRoot) return undefined;

    if (this.hasExcludedRelativeSegment(workspaceRoot, absolutePath)) {
      return undefined;
    }

    let isDirectory = false;
    try {
      isDirectory = fs.statSync(absolutePath).isDirectory();
    } catch {
      // New and unsaved documents do not exist on disk yet.
    }
    let directory = isDirectory ? absolutePath : path.dirname(absolutePath);
    while (isWithin(workspaceRoot, directory)) {
      const manifestPath = path.join(directory, 'shaderpack.json');
      if (fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile()) {
        return canonicalExistingPath(directory);
      }
      if (comparisonKey(directory) === comparisonKey(workspaceRoot)) break;
      directory = path.dirname(directory);
    }
    return undefined;
  }

  private hasExcludedRelativeSegment(parent: string, candidate: string): boolean {
    return path.relative(parent, candidate).split(path.sep)
      .some(segment => this.excludedDirectories.has(segment.toLowerCase()));
  }

  private isRelevantFileEvent(changedPath: string): boolean {
    const absolutePath = path.resolve(changedPath);
    const workspaceRoot = this.workspaceFolders.find(folder => isWithin(folder, absolutePath));
    if (!workspaceRoot || this.hasExcludedRelativeSegment(workspaceRoot, absolutePath)) {
      return false;
    }
    if (path.basename(absolutePath).toLowerCase() === 'shaderpack.json') return true;
    const key = comparisonKey(absolutePath);
    return this.current.packs.some(pack =>
      pack.fragments.some(reference => comparisonKey(reference.absolutePath) === key) ||
      (pack.settings && comparisonKey(pack.settings.absolutePath) === key) ||
      (pack.shaderRoot && isWithin(pack.shaderRoot.absolutePath, absolutePath)));
  }
}
