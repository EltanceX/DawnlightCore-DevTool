import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createDiagnosticCode,
  DawnlightCompositionDocumentSnapshot,
  DawnlightDuplicateSymbolSnapshot,
  DawnlightJsonPathSegment,
  DawnlightPackSymbolIndexSnapshot,
  DawnlightReferenceKind,
  DawnlightReferenceSnapshot,
  DawnlightSymbolDiagnosticSnapshot,
  DawnlightSymbolKind,
  DawnlightSymbolSnapshot,
  DawnlightWorkspaceSymbolIndexSnapshot
} from '@dawnlight/contracts';
import { getNodeValue, Node } from 'jsonc-parser';
import { PackComposition, DefinitionRecord } from './composition';
import { JsoncDocumentSnapshot } from './jsoncDocuments';
import { ShaderPackProject, WorkspaceDiscoverySnapshot } from './workspaceDiscovery';

export interface SymbolIndexRebuildResult {
  applied: boolean;
  snapshot: DawnlightWorkspaceSymbolIndexSnapshot;
}

function emptySnapshot(): DawnlightWorkspaceSymbolIndexSnapshot {
  return Object.freeze({ generation: 0, projects: Object.freeze([]) });
}

function keyForPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative));
}

function freezeRange(range: DawnlightSymbolSnapshot['range']): DawnlightSymbolSnapshot['range'] {
  return Object.freeze({
    start: Object.freeze({ ...range.start }),
    end: Object.freeze({ ...range.end })
  });
}

function jsonPathForDefinition(kind: DefinitionRecord['kind'], localOrder: number): DawnlightJsonPathSegment[] {
  return [kind === 'option' ? 'options' : `${kind}s`, localOrder];
}

function symbolFromDefinition(definition: DefinitionRecord): DawnlightSymbolSnapshot {
  return Object.freeze({
    id: definition.id,
    canonicalId: definition.id,
    kind: definition.kind,
    uri: definition.uri,
    path: Object.freeze(jsonPathForDefinition(definition.kind, definition.localOrder)),
    range: freezeRange(definition.range),
    selectionRange: freezeRange(definition.selectionRange)
  });
}

function documentSnapshots(documents: readonly JsoncDocumentSnapshot[]): DawnlightCompositionDocumentSnapshot[] {
  return documents.map(document => Object.freeze({
    uri: document.uri,
    version: document.version,
    source: document.source,
    parseErrorCount: document.errors.length
  }));
}

function visitNode(
  node: Node | undefined,
  jsonPath: readonly DawnlightJsonPathSegment[],
  visit: (node: Node, path: readonly DawnlightJsonPathSegment[]) => void
): void {
  if (!node) return;
  visit(node, jsonPath);
  if (node.type === 'array') {
    node.children?.forEach((child, index) => visitNode(child, [...jsonPath, index], visit));
    return;
  }
  if (node.type !== 'object') return;
  for (const property of node.children ?? []) {
    const children = property.children ?? [];
    const key = children[0] ? getNodeValue(children[0]) : undefined;
    const value = children[1];
    if (typeof key === 'string') visitNode(value, [...jsonPath, key], visit);
  }
}

function scalarString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const value = getNodeValue(node);
  return typeof value === 'string' ? value : undefined;
}

function parentProperty(jsonPath: readonly DawnlightJsonPathSegment[]): string | undefined {
  const last = jsonPath[jsonPath.length - 1];
  if (typeof last === 'string') return last;
  const previous = jsonPath[jsonPath.length - 2];
  return typeof previous === 'string' ? previous : undefined;
}

function addSettingsSymbols(
  document: JsoncDocumentSnapshot,
  symbols: DawnlightSymbolSnapshot[]
): void {
  const add = (
    id: string,
    kind: Extract<DawnlightSymbolKind, 'settingsPage' | 'settingsGroup' | 'settingsControl'>,
    jsonPath: DawnlightJsonPathSegment[],
    idPath: DawnlightJsonPathSegment[]
  ) => {
    const node = document.nodeAtPath(jsonPath);
    const idNode = document.nodeAtPath(idPath);
    if (!node || !idNode) return;
    symbols.push(Object.freeze({
      id,
      canonicalId: `settings:${kind}:${id}`,
      kind,
      uri: document.uri,
      path: Object.freeze(jsonPath),
      range: freezeRange(document.rangeForNode(node)),
      selectionRange: freezeRange(document.rangeForNode(idNode))
    }));
  };

  const pages = document.nodeAtPath(['pages']);
  for (let pageIndex = 0; pageIndex < (pages?.children?.length ?? 0); pageIndex += 1) {
    const pagePath = ['pages', pageIndex] as DawnlightJsonPathSegment[];
    const pageId = scalarString(document.nodeAtPath([...pagePath, 'id']));
    if (!pageId) continue;
    add(pageId, 'settingsPage', pagePath, [...pagePath, 'id']);
    const groups = document.nodeAtPath([...pagePath, 'groups']);
    for (let groupIndex = 0; groupIndex < (groups?.children?.length ?? 0); groupIndex += 1) {
      const groupPath = [...pagePath, 'groups', groupIndex] as DawnlightJsonPathSegment[];
      const groupId = scalarString(document.nodeAtPath([...groupPath, 'id']));
      if (!groupId) continue;
      add(groupId, 'settingsGroup', groupPath, [...groupPath, 'id']);
      const controls = document.nodeAtPath([...groupPath, 'controls']);
      for (let controlIndex = 0; controlIndex < (controls?.children?.length ?? 0); controlIndex += 1) {
        const controlPath = [...groupPath, 'controls', controlIndex] as DawnlightJsonPathSegment[];
        const controlId = scalarString(document.nodeAtPath([...controlPath, 'id']));
        if (controlId) add(controlId, 'settingsControl', controlPath, [...controlPath, 'id']);
      }
    }
  }
}

function packRelativePath(packRoot: string, absolutePath: string): string | undefined {
  const relative = path.relative(packRoot, absolutePath);
  if (!isWithin(packRoot, absolutePath)) return undefined;
  return relative.split(path.sep).join('/');
}

function fileTarget(
  packRoot: string,
  baseDirectory: string,
  rawPath: string
): { absolutePath: string; targetPath?: string; targetUri?: string; exists: boolean } {
  const absolutePath = path.normalize(path.resolve(baseDirectory, ...rawPath.split('/')));
  const targetPath = packRelativePath(packRoot, absolutePath);
  const exists = targetPath !== undefined && fs.existsSync(absolutePath);
  return {
    absolutePath,
    targetPath,
    targetUri: exists ? pathToFileURL(absolutePath).toString() : undefined,
    exists
  };
}

function addFileSymbol(
  symbols: DawnlightSymbolSnapshot[],
  seen: Set<string>,
  document: JsoncDocumentSnapshot,
  jsonPath: readonly DawnlightJsonPathSegment[],
  targetPath: string,
  targetUri?: string
): void {
  const canonicalId = `file:${targetPath}`;
  if (seen.has(canonicalId)) return;
  const node = document.nodeAtPath(jsonPath);
  if (!node) return;
  seen.add(canonicalId);
  const range = freezeRange(document.rangeForNode(node));
  symbols.push(Object.freeze({
    id: targetPath,
    canonicalId,
    kind: 'file',
    uri: targetUri ?? document.uri,
    path: Object.freeze([...jsonPath]),
    range,
    selectionRange: range
  }));
}

function addPathReference(
  references: DawnlightReferenceSnapshot[],
  symbols: DawnlightSymbolSnapshot[],
  fileSymbols: Set<string>,
  document: JsoncDocumentSnapshot,
  jsonPath: readonly DawnlightJsonPathSegment[],
  kind: Extract<DawnlightReferenceKind, 'path' | 'shader' | 'asset'>,
  packRoot: string,
  baseDirectory: string,
  rawPath: string
): void {
  const node = document.nodeAtPath(jsonPath);
  if (!node || typeof rawPath !== 'string') return;
  const target = fileTarget(packRoot, baseDirectory, rawPath);
  const targetPath = target.targetPath;
  const range = document.rangeForNode(node);
  if (targetPath) addFileSymbol(symbols, fileSymbols, document, jsonPath, targetPath, target.targetUri);
  references.push(Object.freeze({
    kind,
    targetPath,
    targetUri: target.targetUri,
    uri: document.uri,
    path: Object.freeze([...jsonPath]),
    range,
    resolved: Boolean(targetPath && target.exists),
    ambiguous: false
  }));
}

function addIdReference(
  references: DawnlightReferenceSnapshot[],
  document: JsoncDocumentSnapshot,
  jsonPath: readonly DawnlightJsonPathSegment[],
  kind: Extract<DawnlightReferenceKind, 'option' | 'resource' | 'program'>,
  targetId: string
): void {
  const node = document.nodeAtPath(jsonPath);
  if (!node || typeof targetId !== 'string') return;
  references.push(Object.freeze({
    kind,
    targetId,
    targetKind: kind,
    uri: document.uri,
    path: Object.freeze([...jsonPath]),
    range: freezeRange(document.rangeForNode(node)),
    resolved: false,
    ambiguous: false
  }));
}

function collectDocumentReferences(
  document: JsoncDocumentSnapshot,
  projectRoot: string,
  shaderRoot: string,
  references: DawnlightReferenceSnapshot[],
  symbols: DawnlightSymbolSnapshot[],
  fileSymbols: Set<string>
): void {
  visitNode(document.root, [], (node, jsonPath) => {
    const value = scalarString(node);
    if (value === undefined) return;
    const property = parentProperty(jsonPath);
    if (!property) return;

    if (property === 'option') addIdReference(references, document, jsonPath, 'option', value);
    else if (property === 'program' || property === 'programs') {
      addIdReference(references, document, jsonPath, 'program', value);
    } else if (property === 'resource' || property === 'source' || property === 'destination' ||
      property === 'inputs' || property === 'outputs') {
      addIdReference(references, document, jsonPath, 'resource', value);
    }

    const isShader = property === 'vertex' || property === 'fragment' ||
      property === 'geometry' || property === 'compute';
    if (isShader) addPathReference(
      references, symbols, fileSymbols, document, jsonPath, 'shader', projectRoot, shaderRoot, value);

    if (property === 'path') {
      const parent = jsonPath.length > 1 ? jsonPath[jsonPath.length - 2] : undefined;
      if (parent === 'content') addPathReference(
        references, symbols, fileSymbols, document, jsonPath, 'asset', projectRoot, projectRoot, value);
    }
    const parent = jsonPath.length > 1 ? jsonPath[jsonPath.length - 2] : undefined;
    if (typeof parent === 'string' && parent === 'faces') addPathReference(
      references, symbols, fileSymbols, document, jsonPath, 'asset', projectRoot, projectRoot, value);
  });
}

function collectRootPathReferences(
  project: ShaderPackProject,
  document: JsoncDocumentSnapshot | undefined,
  references: DawnlightReferenceSnapshot[],
  symbols: DawnlightSymbolSnapshot[],
  fileSymbols: Set<string>
): void {
  if (!document) return;
  for (let index = 0; index < project.fragments.length; index += 1) {
    const reference = project.fragments[index];
    addPathReference(
      references, symbols, fileSymbols, document, ['fragments', index], 'path', project.rootPath,
      project.rootPath, reference.path);
  }
  if (project.settings) addPathReference(
    references, symbols, fileSymbols, document, ['settings'], 'path', project.rootPath,
    project.rootPath, project.settings.path);
  if (project.shaderRoot) addPathReference(
    references, symbols, fileSymbols, document, ['shaderRoot'], 'path', project.rootPath,
    project.rootPath, project.shaderRoot.path);
}

function resolveReferences(
  references: readonly DawnlightReferenceSnapshot[],
  symbols: readonly DawnlightSymbolSnapshot[]
): DawnlightReferenceSnapshot[] {
  const byId = new Map<string, DawnlightSymbolSnapshot[]>();
  for (const symbol of symbols) {
    if (symbol.kind === 'file') continue;
    const list = byId.get(symbol.canonicalId) ?? [];
    list.push(symbol);
    byId.set(symbol.canonicalId, list);
  }
  return references.map(reference => {
    if (!reference.targetId || !reference.targetKind) return reference;
    const matches = (byId.get(reference.targetId) ?? [])
      .filter(symbol => symbol.kind === reference.targetKind);
    return Object.freeze({
      ...reference,
      targetUri: matches.length === 1 ? matches[0].uri : undefined,
      resolved: matches.length > 0,
      ambiguous: matches.length > 1
    });
  });
}

function createPackIndex(
  project: PackComposition,
  pack: ShaderPackProject | undefined,
  compositionGeneration: number
): DawnlightPackSymbolIndexSnapshot {
  const symbols: DawnlightSymbolSnapshot[] = [];
  const references: DawnlightReferenceSnapshot[] = [];
  const fileSymbols = new Set<string>();
  const rootDocument = project.documents.find(document =>
    keyForPath(document.absolutePath) === keyForPath(pack?.manifestPath ?? ''));
  for (const kind of ['option', 'resource', 'program', 'pass'] as const) {
    for (const definition of project.definitions[kind]) symbols.push(symbolFromDefinition(definition));
  }
  const settings = pack?.settings
    ? project.documents.find(document => keyForPath(document.absolutePath) === keyForPath(pack.settings!.absolutePath))
    : undefined;
  if (settings) addSettingsSymbols(settings, symbols);

  const shaderRoot = pack?.shaderRoot?.absolutePath ?? project.rootUri;
  for (const document of project.documents) {
    if (document === rootDocument || document === settings) continue;
    collectDocumentReferences(document, project.rootUri, shaderRoot, references, symbols, fileSymbols);
  }
  collectRootPathReferences(pack ?? {
    rootPath: project.rootUri,
    manifestPath: '',
    valid: true,
    generation: 0,
    fragments: [],
    diagnostics: []
  }, rootDocument, references, symbols, fileSymbols);
  if (settings) collectDocumentReferences(settings, project.rootUri, shaderRoot, references, symbols, fileSymbols);
  const resolvedReferences = resolveReferences(references, symbols);
  const grouped = new Map<string, DawnlightSymbolSnapshot[]>();
  for (const symbol of symbols) {
    if (symbol.kind === 'file') continue;
    const list = grouped.get(symbol.canonicalId) ?? [];
    list.push(symbol);
    grouped.set(symbol.canonicalId, list);
  }
  const duplicates: DawnlightDuplicateSymbolSnapshot[] = [];
  const diagnostics: DawnlightSymbolDiagnosticSnapshot[] = [];
  for (const [canonicalId, definitions] of grouped) {
    if (definitions.length < 2) continue;
    const frozenDefinitions = Object.freeze([...definitions]);
    duplicates.push(Object.freeze({ canonicalId, definitions: frozenDefinitions }));
    for (const definition of definitions) diagnostics.push(Object.freeze({
      code: createDiagnosticCode('symbol', 1),
      message: `Duplicate symbol ID '${canonicalId}'.`,
      uri: definition.uri,
      range: freezeRange(definition.selectionRange)
    }));
  }
  return Object.freeze({
    rootUri: project.rootUri,
    compositionGeneration,
    documents: Object.freeze(documentSnapshots(project.documents)),
    symbols: Object.freeze([...symbols]),
    references: Object.freeze(resolvedReferences),
    duplicates: Object.freeze(duplicates),
    diagnostics: Object.freeze(diagnostics)
  });
}

export class WorkspaceSymbolIndexManager {
  private current: DawnlightWorkspaceSymbolIndexSnapshot = emptySnapshot();
  private readonly projects = new Map<string, DawnlightPackSymbolIndexSnapshot>();
  private requestGeneration = 0;
  private indexGeneration = 0;

  get snapshot(): DawnlightWorkspaceSymbolIndexSnapshot {
    return this.current;
  }

  cancel(): void {
    this.requestGeneration += 1;
  }

  async rebuild(
    composition: { generation: number; projects: readonly unknown[]; internalProjects: readonly PackComposition[] },
    discovery: WorkspaceDiscoverySnapshot,
    changedPaths: readonly string[] = []
  ): Promise<SymbolIndexRebuildResult> {
    const request = ++this.requestGeneration;
    await Promise.resolve();
    if (request !== this.requestGeneration) return { applied: false, snapshot: this.current };
    const changed = changedPaths.map(keyForPath);
    const nextProjects: DawnlightPackSymbolIndexSnapshot[] = [];
    for (const internalProject of composition.internalProjects) {
      const pack = discovery.packs.find(item => keyForPath(item.rootPath) === keyForPath(internalProject.rootUri));
      const affected = changed.length === 0 || changed.some(item => isWithin(internalProject.rootUri, item));
      const previous = this.projects.get(keyForPath(internalProject.rootUri));
      if (!affected && previous) {
        this.projects.set(keyForPath(internalProject.rootUri), previous);
        nextProjects.push(previous);
      } else {
        const next = createPackIndex(internalProject, pack, composition.generation);
        this.projects.set(keyForPath(internalProject.rootUri), next);
        nextProjects.push(next);
      }
    }
    const activeRoots = new Set(nextProjects.map(project => keyForPath(project.rootUri)));
    for (const root of this.projects.keys()) if (!activeRoots.has(root)) this.projects.delete(root);
    if (request !== this.requestGeneration) return { applied: false, snapshot: this.current };
    this.indexGeneration += 1;
    this.current = Object.freeze({
      generation: this.indexGeneration,
      projects: Object.freeze(nextProjects)
    });
    return { applied: true, snapshot: this.current };
  }
}

export { createPackIndex };
