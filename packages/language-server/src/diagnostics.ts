import {
  Diagnostic,
  DiagnosticSeverity,
  Range
} from 'vscode-languageserver/node';
import * as path from 'node:path';
import { getNodeValue, Node } from 'jsonc-parser';
import { createDiagnosticCode } from '@dawnlight/contracts';
import {
  PackComposition,
  WorkspaceCompositionSnapshot,
  DefinitionRecord
} from './composition';
import {
  JsoncDocumentSnapshot,
  JsoncRange
} from './jsoncDocuments';
import {
  ShaderPackProject,
  WorkspaceDiscoverySnapshot
} from './workspaceDiscovery';
import {
  DawnlightPackSymbolIndexSnapshot,
  DawnlightReferenceSnapshot,
  DawnlightSymbolSnapshot,
  DawnlightWorkspaceSymbolIndexSnapshot
} from '@dawnlight/contracts';

export const FAST_DIAGNOSTIC_SOURCES = Object.freeze([
  'dawnlight-json',
  'dawnlight-path',
  'dawnlight-symbol',
  'dawnlight-graph'
] as const);

export type FastDiagnosticSource = typeof FAST_DIAGNOSTIC_SOURCES[number];

export interface FastDiagnosticResult {
  compositionGeneration: number;
  symbolGeneration: number;
  bySource: ReadonlyMap<FastDiagnosticSource, ReadonlyMap<string, readonly Diagnostic[]>>;
}

type JsonPath = readonly (string | number)[];
type DiagnosticMaps = Map<FastDiagnosticSource, Map<string, Diagnostic[]>>;

function zeroRange(): Range {
  return Range.create(0, 0, 0, 0);
}

function freezeRange(range: JsoncRange): Range {
  return Range.create(range.start.line, range.start.character, range.end.line, range.end.character);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

function rootKey(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative));
}

function startsWithPath(value: JsonPath, prefix: JsonPath): boolean {
  return prefix.every((segment, index) => value[index] === segment);
}

function documentFor(project: PackComposition, uri: string): JsoncDocumentSnapshot | undefined {
  return project.documents.find(document => document.uri === uri);
}

function nodeRange(document: JsoncDocumentSnapshot | undefined, path: JsonPath): Range | undefined {
  if (!document) return undefined;
  const node = document.nodeAtPath(path);
  return node ? freezeRange(document.rangeForNode(node)) : undefined;
}

function nodeValue(document: JsoncDocumentSnapshot | undefined, path: JsonPath): unknown {
  const node = document?.nodeAtPath(path);
  return node ? getNodeValue(node) : undefined;
}

function objectAt(document: JsoncDocumentSnapshot | undefined, path: JsonPath): Record<string, unknown> | undefined {
  const value = nodeValue(document, path);
  return isRecord(value) ? value : undefined;
}

function pluralFor(kind: DefinitionRecord['kind']): string {
  return kind === 'option' ? 'options' : `${kind}s`;
}

function definitionPath(definition: DefinitionRecord): JsonPath {
  return [pluralFor(definition.kind), definition.localOrder];
}

function definitionNodeRange(
  project: PackComposition,
  definition: DefinitionRecord,
  property: string
): Range | undefined {
  return nodeRange(documentFor(project, definition.uri), [...definitionPath(definition), property]);
}

function definitionById(
  project: PackComposition,
  kind: DefinitionRecord['kind'],
  id: string
): DefinitionRecord | undefined {
  return project.definitions[kind].find(definition => definition.id === id);
}

function addDiagnostic(
  maps: DiagnosticMaps,
  source: FastDiagnosticSource,
  uri: string,
  code: string,
  message: string,
  range?: JsoncRange | Range,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error
): void {
  const byUri = maps.get(source) ?? new Map<string, Diagnostic[]>();
  const diagnostics = byUri.get(uri) ?? [];
  const resolvedRange = range ? freezeRange(range) : zeroRange();
  const duplicate = diagnostics.some(diagnostic =>
    diagnostic.code === code &&
    diagnostic.range.start.line === resolvedRange.start.line &&
    diagnostic.range.start.character === resolvedRange.start.character &&
    diagnostic.range.end.line === resolvedRange.end.line &&
    diagnostic.range.end.character === resolvedRange.end.character);
  if (!duplicate) {
    diagnostics.push({
      severity,
      range: resolvedRange,
      message,
      source,
      code
    });
  }
  byUri.set(uri, diagnostics);
  maps.set(source, byUri);
}

function addCompositionDiagnostics(
  maps: DiagnosticMaps,
  project: PackComposition
): void {
  for (const diagnostic of project.diagnostics) {
    addDiagnostic(
      maps,
      'dawnlight-json',
      diagnostic.uri,
      diagnostic.code,
      diagnostic.message,
      diagnostic.range
    );
  }
}

function findStringNode(
  node: Node | undefined,
  expected: string | undefined,
  path: JsonPath = []
): { path: JsonPath; node: Node } | undefined {
  if (!node || expected === undefined) return undefined;
  if (node.type === 'string' && getNodeValue(node) === expected) return { path, node };
  if (node.type === 'array') {
    for (let index = 0; index < (node.children?.length ?? 0); index += 1) {
      const result = findStringNode(node.children?.[index], expected, [...path, index]);
      if (result) return result;
    }
  } else if (node.type === 'object') {
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      const key = keyNode ? getNodeValue(keyNode) : undefined;
      if (typeof key === 'string') {
        const result = findStringNode(valueNode, expected, [...path, key]);
        if (result) return result;
      }
    }
  }
  return undefined;
}

function rootPathRange(
  document: JsoncDocumentSnapshot | undefined,
  diagnostic: { message: string; path?: string }
): Range {
  if (!document) return zeroRange();
  const property = /^fragment/i.test(diagnostic.message)
    ? 'fragments'
    : /^settings/i.test(diagnostic.message)
      ? 'settings'
      : /^shaderRoot/i.test(diagnostic.message)
        ? 'shaderRoot'
        : undefined;
  const propertyRange = property ? nodeRange(document, [property]) : undefined;
  const stringNode = findStringNode(document.root, diagnostic.path);
  return stringNode ? freezeRange(document.rangeForNode(stringNode.node)) : propertyRange ?? zeroRange();
}

function addDiscoveryPathDiagnostics(
  maps: DiagnosticMaps,
  pack: ShaderPackProject,
  rootDocument: JsoncDocumentSnapshot | undefined
): void {
  for (const diagnostic of pack.diagnostics) {
    if (!diagnostic.code.startsWith('DLPATH')) continue;
    addDiagnostic(
      maps,
      'dawnlight-path',
      rootDocument?.uri ?? `file://${pack.manifestPath}`,
      diagnostic.code,
      diagnostic.message,
      rootPathRange(rootDocument, diagnostic)
    );
  }
}

function addReferencePathDiagnostics(
  maps: DiagnosticMaps,
  project: PackComposition,
  index: DawnlightPackSymbolIndexSnapshot
): void {
  for (const reference of index.references) {
    if (!['path', 'shader', 'asset'].includes(reference.kind) || reference.resolved) continue;
    const category = reference.kind === 'shader' ? 'shader' : reference.kind === 'asset' ? 'asset' : 'pack';
    const code = reference.targetPath ? createDiagnosticCode('path', 4) : createDiagnosticCode('path', 1);
    const message = reference.targetPath
      ? `${category} path '${reference.targetPath}' does not exist.`
      : `${category} path is invalid or escapes the shader pack.`;
    addDiagnostic(maps, 'dawnlight-path', reference.uri, code, message, reference.range);
  }
}

function addSymbolDiagnostics(
  maps: DiagnosticMaps,
  project: PackComposition,
  index: DawnlightPackSymbolIndexSnapshot
): void {
  for (const diagnostic of index.diagnostics) {
    addDiagnostic(maps, 'dawnlight-symbol', diagnostic.uri, diagnostic.code, diagnostic.message, diagnostic.range);
  }
  const documents = new Map(project.documents.map(document => [document.uri, document]));
  for (const reference of index.references) {
    if (!reference.targetId || !reference.targetKind || reference.resolved) continue;
    if (documents.get(reference.uri)?.errors.length) continue;
    const code = reference.ambiguous
      ? createDiagnosticCode('symbol', 3)
      : createDiagnosticCode('symbol', 2);
    const kind = reference.targetKind === 'settingsControl' ? 'settings option' : reference.targetKind;
    const message = reference.ambiguous
      ? `${kind} reference '${reference.targetId}' is ambiguous.`
      : `Unknown ${kind} '${reference.targetId}'.`;
    addDiagnostic(maps, 'dawnlight-symbol', reference.uri, code, message, reference.range);
  }
}

function arrayItemPath(path: JsonPath, property: string): JsonPath | undefined {
  for (let index = path.length - 2; index >= 0; index -= 1) {
    if (path[index] === property && typeof path[index + 1] === 'number') {
      return path.slice(0, index + 2);
    }
  }
  return undefined;
}

function resourceKindMatchesBinding(bindingKind: string, resourceKind: string): boolean {
  if (bindingKind === 'sampler2D' || bindingKind === 'image2D') return resourceKind === 'texture2D';
  if (bindingKind === 'samplerCube' || bindingKind === 'imageCube') return resourceKind === 'textureCube';
  if (bindingKind === 'uniformBuffer' || bindingKind === 'storageBuffer') return resourceKind === 'buffer';
  return true;
}

function addResourceCompatibilityDiagnostics(
  maps: DiagnosticMaps,
  project: PackComposition,
  index: DawnlightPackSymbolIndexSnapshot
): void {
  for (const reference of index.references) {
    if (reference.kind !== 'resource' || !reference.targetId || !reference.resolved) continue;
    const document = documentFor(project, reference.uri);
    if (!document?.root || document.errors.length > 0) continue;
    const resource = definitionById(project, 'resource', reference.targetId);
    if (!resource) continue;
    const bindingPath = arrayItemPath(reference.path, 'bindings');
    if (bindingPath) {
      const bindingKind = stringValue(nodeValue(document, [...bindingPath, 'kind']));
      const resourceKind = stringValue(resource.value.kind);
      if (bindingKind && resourceKind && !resourceKindMatchesBinding(bindingKind, resourceKind)) {
        addDiagnostic(
          maps,
          'dawnlight-graph',
          reference.uri,
          createDiagnosticCode('graph', 5),
          `Resource '${reference.targetId}' of kind '${resourceKind}' is incompatible with binding '${bindingKind}'.`,
          reference.range
        );
      }
    }
    if (reference.path.includes('targets')) {
      const isDepth = reference.path.includes('depth');
      const resourceKind = stringValue(resource.value.kind);
      const format = stringValue(resource.value.format);
      const invalid = resourceKind === 'buffer' ||
        (isDepth ? !format?.toLowerCase().startsWith('depth') : format?.toLowerCase().startsWith('depth'));
      if (invalid) {
        addDiagnostic(
          maps,
          'dawnlight-graph',
          reference.uri,
          createDiagnosticCode('graph', 6),
          `Target resource '${reference.targetId}' is incompatible with the ${isDepth ? 'depth' : 'color'} attachment.`,
          reference.range
        );
      }
    }
  }
}

function addPassGraphDiagnostics(
  maps: DiagnosticMaps,
  project: PackComposition,
  composition: PackComposition
): void {
  const programDefinitions = new Map(composition.definitions.program.map(definition => [definition.id, definition]));
  const resourceDefinitions = new Map(composition.definitions.resource.map(definition => [definition.id, definition]));
  for (const pass of composition.definitions.pass) {
    const document = documentFor(composition, pass.uri);
    if (!document || document.errors.length > 0) continue;
    const passPath = definitionPath(pass);
    const passValue = pass.value;
    const allowedPrograms = new Set(arrayValue(passValue.programs)?.filter(
      (value): value is string => typeof value === 'string') ?? []);
    const commands = arrayValue(passValue.commands) ?? [];
    commands.forEach((command, commandIndex) => {
      if (!isRecord(command)) return;
      const commandPath = [...passPath, 'commands', commandIndex];
      const commandType = stringValue(command.type);
      const programId = stringValue(command.program);
      if (programId && !allowedPrograms.has(programId)) {
        addDiagnostic(
          maps,
          'dawnlight-graph',
          pass.uri,
          createDiagnosticCode('graph', 2),
          `Command program '${programId}' is not listed in containing pass '${pass.id}'.`,
          nodeRange(document, [...commandPath, 'program'])
        );
      }
      const expectedKind = commandType === 'compute'
        ? 'compute'
        : commandType === 'fullscreen' || commandType === 'present'
          ? 'graphics'
          : undefined;
      const program = programId ? programDefinitions.get(programId) : undefined;
      if (expectedKind && program && program.value.kind !== expectedKind) {
        addDiagnostic(
          maps,
          'dawnlight-graph',
          pass.uri,
          createDiagnosticCode('graph', 1),
          `Command type '${commandType}' requires a ${expectedKind} program, but '${programId}' is '${String(program.value.kind)}'.`,
          nodeRange(document, [...commandPath, 'program'])
        );
      }
      if (commandType === 'historyCommit') {
        const resourceId = stringValue(command.resource);
        const resource = resourceId ? resourceDefinitions.get(resourceId) : undefined;
        if (resource && resource.value.lifetime !== 'history') {
          addDiagnostic(
            maps,
            'dawnlight-graph',
            pass.uri,
            createDiagnosticCode('graph', 4),
            `historyCommit resource '${resourceId}' must have lifetime 'history'.`,
            nodeRange(document, [...commandPath, 'resource'])
          );
        }
      }
    });

    const ordering = isRecord(passValue.stage) && isRecord(passValue.stage.ordering)
      ? passValue.stage.ordering
      : undefined;
    for (const property of ['before', 'after', 'requires']) {
      const values = arrayValue(ordering?.[property]) ?? [];
      values.forEach((value, index) => {
        if (value !== pass.id) return;
        addDiagnostic(
          maps,
          'dawnlight-graph',
          pass.uri,
          createDiagnosticCode('graph', 7),
          `Pass '${pass.id}' orders itself with '${property}'.`,
          nodeRange(document, [...passPath, 'stage', 'ordering', property, index])
        );
      });
    }
  }
}

function translationKeys(settings: JsoncDocumentSnapshot): Set<string> {
  const keys = new Set<string>();
  const translations = nodeValue(settings, ['translations']);
  if (!isRecord(translations)) return keys;
  for (const locale of Object.values(translations)) {
    if (!isRecord(locale)) continue;
    for (const key of Object.keys(locale)) keys.add(key);
  }
  return keys;
}

function visitScalarStrings(
  node: Node | undefined,
  visit: (node: Node, path: JsonPath) => void,
  path: JsonPath = []
): void {
  if (!node) return;
  visit(node, path);
  if (node.type === 'array') {
    node.children?.forEach((child, index) => visitScalarStrings(child, visit, [...path, index]));
  } else if (node.type === 'object') {
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0];
      const valueNode = property.children?.[1];
      const key = keyNode ? getNodeValue(keyNode) : undefined;
      if (typeof key === 'string') visitScalarStrings(valueNode, visit, [...path, key]);
    }
  }
}

function addSettingsDiagnostics(
  maps: DiagnosticMaps,
  project: PackComposition,
  index: DawnlightPackSymbolIndexSnapshot
): void {
  const settings = project.documents.find(document =>
    index.symbols.some(symbol => symbol.uri === document.uri && symbol.kind === 'settingsPage'));
  if (!settings || settings.errors.length > 0) return;
  const options = new Map(project.definitions.option.map(option => [option.id, option]));
  const controls = index.symbols.filter(symbol => symbol.kind === 'settingsControl' && symbol.uri === settings.uri);
  const controlsByOption = new Map<string, typeof controls>();
  for (const control of controls) {
    const option = stringValue(nodeValue(settings, [...control.path, 'option']));
    if (!option) continue;
    const list = controlsByOption.get(option) ?? [];
    list.push(control);
    controlsByOption.set(option, list);
    const definition = options.get(option);
    if (definition) {
      const widget = stringValue(nodeValue(settings, [...control.path, 'widget']));
      const type = stringValue(definition.value.type);
      const allowed = Array.isArray(definition.value.allowed);
      const valid = type === 'boolean'
        ? widget === 'toggle'
        : allowed
          ? widget === 'choice'
          : type === 'number' || type === 'integer'
            ? widget === 'slider' || widget === 'number'
            : widget === 'text';
      if (widget && !valid) {
        addDiagnostic(
          maps,
          'dawnlight-graph',
          settings.uri,
          createDiagnosticCode('graph', 9),
          `Settings widget '${widget}' is incompatible with option '${option}' of type '${type ?? 'unknown'}'.`,
          nodeRange(settings, [...control.path, 'widget'])
        );
      }
    }
  }
  for (const [option, matching] of controlsByOption) {
    if (matching.length < 2) continue;
    for (const control of matching) {
      addDiagnostic(
        maps,
        'dawnlight-graph',
        settings.uri,
        createDiagnosticCode('graph', 10),
        `Settings option '${option}' is controlled more than once.`,
        nodeRange(settings, [...control.path, 'option'])
      );
    }
  }
  const hiddenOptions = arrayValue(nodeValue(settings, ['hiddenOptions'])) ?? [];
  const hiddenIds = new Set(hiddenOptions.filter((value): value is string => typeof value === 'string'));
  hiddenOptions.forEach((value, index) => {
    if (typeof value !== 'string' || !controlsByOption.has(value)) return;
    addDiagnostic(
      maps,
      'dawnlight-graph',
      settings.uri,
      createDiagnosticCode('graph', 10),
      `Settings option '${value}' cannot be both controlled and hidden.`,
      nodeRange(settings, ['hiddenOptions', index])
    );
  });
  for (const option of project.definitions.option) {
    if (controlsByOption.has(option.id) || hiddenIds.has(option.id)) continue;
    addDiagnostic(
      maps,
      'dawnlight-graph',
      option.uri,
      createDiagnosticCode('graph', 11),
      `Option '${option.id}' is not represented by a Settings control or hiddenOptions.`,
      option.selectionRange,
      DiagnosticSeverity.Warning
    );
  }
  const keys = translationKeys(settings);
  visitScalarStrings(settings.root, (node, path) => {
    const property = path[path.length - 1];
    const value = getNodeValue(node);
    if (!['title', 'label', 'description'].includes(String(property)) || typeof value !== 'string') return;
    if (!value.includes('.') || keys.has(value)) return;
    // Plain display strings are valid. Dotted values are the explicit translation-key convention.
    if (value.includes(' ')) return;
    addDiagnostic(
      maps,
      'dawnlight-graph',
      settings.uri,
      createDiagnosticCode('graph', 8),
      `Translation key '${value}' is not defined in Settings translations.`,
      freezeRange(settings.rangeForNode(node)),
      DiagnosticSeverity.Warning
    );
  });
}

function freezeResult(maps: DiagnosticMaps, compositionGeneration: number, symbolGeneration: number): FastDiagnosticResult {
  const bySource = new Map<FastDiagnosticSource, ReadonlyMap<string, readonly Diagnostic[]>>();
  for (const source of FAST_DIAGNOSTIC_SOURCES) {
    const sourceMap = maps.get(source) ?? new Map<string, Diagnostic[]>();
    bySource.set(source, new Map([...sourceMap].map(([uri, diagnostics]) => [uri, Object.freeze([...diagnostics])] as const)));
  }
  return { compositionGeneration, symbolGeneration, bySource };
}

export class DawnlightFastDiagnosticService {
  private readonly projectCache = new Map<string, DiagnosticMaps>();

  compute(
    discovery: WorkspaceDiscoverySnapshot,
    composition: WorkspaceCompositionSnapshot,
    symbols: DawnlightWorkspaceSymbolIndexSnapshot,
    changedPaths: readonly string[] = []
  ): FastDiagnosticResult {
    const maps: DiagnosticMaps = new Map();
    const internalByRoot = new Map(composition.internalProjects.map(project => [project.rootUri, project]));
    const symbolByRoot = new Map(symbols.projects.map(project => [project.rootUri, project]));
    const changed = changedPaths.map(rootKey);
    const activeRoots = new Set<string>();
    for (const pack of discovery.packs) {
      const packRoot = rootKey(pack.rootPath);
      activeRoots.add(packRoot);
      const project = internalByRoot.get(pack.rootPath);
      const index = symbolByRoot.get(pack.rootPath);
      if (!project || !index) continue;
      const affected = changed.length === 0 || changed.some(candidate => isWithin(pack.rootPath, candidate));
      let projectMaps = this.projectCache.get(packRoot);
      if (affected || !projectMaps) {
        projectMaps = new Map();
        const root = project.documents.find(document => document.absolutePath === pack.manifestPath);
        addCompositionDiagnostics(projectMaps, project);
        addDiscoveryPathDiagnostics(projectMaps, pack, root);
        addReferencePathDiagnostics(projectMaps, project, index);
        addSymbolDiagnostics(projectMaps, project, index);
        addPassGraphDiagnostics(projectMaps, project, project);
        addResourceCompatibilityDiagnostics(projectMaps, project, index);
        addSettingsDiagnostics(projectMaps, project, index);
        this.projectCache.set(packRoot, projectMaps);
      }
      for (const [source, sourceMap] of projectMaps) {
        for (const [uri, diagnostics] of sourceMap) {
          for (const diagnostic of diagnostics) {
            addDiagnostic(
              maps,
              source,
              uri,
              String(diagnostic.code),
              diagnostic.message,
              diagnostic.range,
              diagnostic.severity
            );
          }
        }
      }
    }
    for (const key of this.projectCache.keys()) if (!activeRoots.has(key)) this.projectCache.delete(key);
    return freezeResult(maps, composition.generation, symbols.generation);
  }
}
