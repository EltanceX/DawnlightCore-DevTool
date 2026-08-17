import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  InsertTextFormat,
  Position,
  Range
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getNodeValue } from 'jsonc-parser';
import { WorkspaceCompositionManager, PackComposition, DefinitionRecord } from './composition';
import { JsoncDocumentSnapshot, JsoncDocumentStore } from './jsoncDocuments';
import { WorkspaceSymbolIndexManager } from './symbols';
import {
  DEFAULT_EXCLUDED_DIRECTORIES,
  ShaderPackProject,
  WorkspacePackDiscovery
} from './workspaceDiscovery';

interface CompletionSource {
  discovery: WorkspacePackDiscovery;
  composition: WorkspaceCompositionManager;
  symbols: WorkspaceSymbolIndexManager;
}

interface PackContext {
  pack: ShaderPackProject;
  composition: PackComposition;
  document: JsoncDocumentSnapshot;
}

interface PathCacheEntry {
  jsonFiles: readonly string[];
  shaderFiles: readonly string[];
}

const dynamicRank = 0;

function keyForPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) &&
    relative !== '..' && !path.isAbsolute(relative));
}

function freezePosition(position: Position): Position {
  return Object.freeze({ line: position.line, character: position.character });
}

function rangeKey(range: Range | undefined): string {
  if (!range) return '';
  return `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function itemInsertText(item: CompletionItem): string {
  if (item.textEdit && !Array.isArray(item.textEdit) && 'newText' in item.textEdit) {
    return item.textEdit.newText;
  }
  return typeof item.insertText === 'string' ? item.insertText : item.label.toString();
}

function itemRange(item: CompletionItem): Range | undefined {
  if (item.textEdit && !Array.isArray(item.textEdit) && 'range' in item.textEdit) {
    return item.textEdit.range;
  }
  return (item as CompletionItem & { range?: Range }).range;
}

export function completionDeduplicationKey(item: CompletionItem): string {
  return `${item.label}|${item.kind ?? ''}|${rangeKey(itemRange(item))}|${itemInsertText(item)}`;
}

export function mergeCompletionResults(
  schemaResult: CompletionList | CompletionItem[] | null,
  dynamicItems: readonly CompletionItem[]
): CompletionList | null {
  if (!schemaResult && dynamicItems.length === 0) return null;
  const schemaItems = Array.isArray(schemaResult) ? schemaResult : schemaResult?.items ?? [];
  const items: CompletionItem[] = [];
  const seen = new Set<string>();
  for (const item of [...dynamicItems, ...schemaItems]) {
    const key = completionDeduplicationKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return {
    isIncomplete: !Array.isArray(schemaResult) && Boolean(schemaResult?.isIncomplete),
    items
  };
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'unset';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function valueAt(document: JsoncDocumentSnapshot, jsonPath: readonly (string | number)[]): unknown {
  const node = document.nodeAtPath(jsonPath);
  return node ? getNodeValue(node) : undefined;
}

function arrayItemPath(
  jsonPath: readonly (string | number)[],
  property: string
): readonly (string | number)[] | undefined {
  for (let index = 0; index < jsonPath.length - 1; index += 1) {
    if (jsonPath[index] === property && typeof jsonPath[index + 1] === 'number') {
      return jsonPath.slice(0, index + 2);
    }
  }
  return undefined;
}

function arrayProperty(jsonPath: readonly (string | number)[], property: string): boolean {
  for (let index = 0; index < jsonPath.length; index += 1) {
    if (jsonPath[index] === property && typeof jsonPath[index + 1] === 'number') return true;
  }
  return false;
}

function completionRange(
  snapshot: JsoncDocumentSnapshot,
  jsonPath: readonly (string | number)[],
  position: Position
): Range {
  const node = snapshot.nodeAtPath(jsonPath);
  if (node && ['string', 'number', 'boolean', 'null'].includes(node.type)) {
    return Object.freeze({
      start: freezePosition(snapshot.textDocument.positionAt(node.offset)),
      end: freezePosition(snapshot.textDocument.positionAt(node.offset + node.length))
    });
  }
  const offset = snapshot.textDocument.offsetAt(position);
  let start = offset;
  let end = offset;
  while (start > 0 && !/[\s,:[\]{}"]/.test(snapshot.text[start - 1])) start -= 1;
  while (end < snapshot.text.length && !/[\s,:[\]{}"]/.test(snapshot.text[end])) end += 1;
  return Object.freeze({
    start: freezePosition(snapshot.textDocument.positionAt(start)),
    end: freezePosition(snapshot.textDocument.positionAt(end))
  });
}

function stringItem(
  label: string,
  range: Range,
  detail: string,
  kind: CompletionItemKind = CompletionItemKind.Reference,
  rank = dynamicRank
): CompletionItem {
  const insertText = JSON.stringify(label);
  return {
    label,
    kind,
    detail,
    sortText: `${rank}_${label}`,
    insertText,
    insertTextFormat: InsertTextFormat.PlainText,
    textEdit: { range, newText: insertText }
  };
}

function valueItem(
  value: unknown,
  range: Range,
  detail: string,
  rank = dynamicRank
): CompletionItem {
  const label = formatValue(value);
  const insertText = label;
  return {
    label,
    kind: CompletionItemKind.Value,
    detail,
    sortText: `${rank}_${label}`,
    insertText,
    insertTextFormat: InsertTextFormat.PlainText,
    textEdit: { range, newText: insertText }
  };
}

function definitionDetail(definition: DefinitionRecord): string {
  if (definition.kind === 'option') {
    const value = definition.value;
    const impact = Array.isArray(value.impact) ? value.impact.join(', ') : 'unknown impact';
    return `option · ${String(value.type ?? 'unknown')} · default ${formatValue(value.default)} · impact ${impact}`;
  }
  if (definition.kind === 'program') {
    return `${String(definition.value.kind ?? 'program')} program`;
  }
  if (definition.kind === 'resource') {
    return `resource · ${String(definition.value.kind ?? 'unknown')} · ${String(definition.value.lifetime ?? 'unknown lifetime')}`;
  }
  return 'pass';
}

function definitionItems(
  definitions: readonly DefinitionRecord[],
  range: Range,
  kind: CompletionItemKind = CompletionItemKind.Reference,
  filter: (definition: DefinitionRecord) => boolean = () => true,
  detailPrefix = ''
): CompletionItem[] {
  return definitions.filter(filter).map(definition => stringItem(
    definition.id,
    range,
    detailPrefix + definitionDetail(definition),
    kind
  ));
}

function currentStringValue(document: JsoncDocumentSnapshot, jsonPath: readonly (string | number)[]): string | undefined {
  const value = valueAt(document, jsonPath);
  return typeof value === 'string' ? value : undefined;
}

function findOption(
  project: PackComposition,
  id: string | undefined
): DefinitionRecord | undefined {
  return id ? project.definitions.option.find(option => option.id === id) : undefined;
}

function optionValueCandidates(option: DefinitionRecord | undefined): unknown[] {
  if (!option) return [];
  const value = option.value;
  if (Array.isArray(value.allowed)) return value.allowed;
  if (value.type === 'boolean') return [true, false];
  if (value.default !== undefined) return [value.default];
  if (value.type === 'number' || value.type === 'integer') {
    const candidates: unknown[] = [];
    if (typeof value.min === 'number') candidates.push(value.min);
    if (typeof value.max === 'number' && value.max !== value.min) candidates.push(value.max);
    return candidates;
  }
  return [];
}

function collectFiles(root: string, extensions?: ReadonlySet<string>): string[] {
  const output: string[] = [];
  const pending = [root];
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
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_EXCLUDED_DIRECTORIES.includes(entry.name.toLowerCase() as typeof DEFAULT_EXCLUDED_DIRECTORIES[number])) {
          pending.push(fullPath);
        }
      } else if (entry.isFile() && (!extensions || extensions.has(path.extname(entry.name).toLowerCase()))) {
        output.push(fullPath);
      }
    }
  }
  return output.sort((left, right) => left.localeCompare(right));
}

function relativePackPath(packRoot: string, absolutePath: string): string | undefined {
  if (!isWithin(packRoot, absolutePath)) return undefined;
  return path.relative(packRoot, absolutePath).split(path.sep).join('/');
}

function commandType(document: JsoncDocumentSnapshot, jsonPath: readonly (string | number)[]): string | undefined {
  const commandPath = arrayItemPath(jsonPath, 'commands');
  const value = commandPath ? valueAt(document, [...commandPath, 'type']) : undefined;
  return typeof value === 'string' ? value : undefined;
}

function resourceFilterForTarget(
  document: JsoncDocumentSnapshot,
  jsonPath: readonly (string | number)[],
  definition: DefinitionRecord
): boolean {
  const format = String(definition.value.format ?? '');
  const targetPath = jsonPath.slice(0, jsonPath.lastIndexOf('targets'));
  const targetKind = targetPath.length > 0 ? valueAt(document, [...targetPath, 'targets']) : undefined;
  if (targetKind && jsonPath.includes('depth')) return format.startsWith('depth');
  if (jsonPath.includes('colors')) return !format.startsWith('depth');
  return true;
}

function selectedControlOption(
  document: JsoncDocumentSnapshot,
  jsonPath: readonly (string | number)[],
  project: PackComposition
): DefinitionRecord | undefined {
  const controlPath = arrayItemPath(jsonPath, 'controls');
  return findOption(project, controlPath ? currentStringValue(document, [...controlPath, 'option']) : undefined);
}

function selectedConditionOption(
  document: JsoncDocumentSnapshot,
  jsonPath: readonly (string | number)[],
  project: PackComposition
): DefinitionRecord | undefined {
  const conditionPath = arrayItemPath(jsonPath, 'enabledWhen') ??
    arrayItemPath(jsonPath, 'visibleWhen');
  return findOption(project, conditionPath ? currentStringValue(document, [...conditionPath, 'option']) : undefined);
}

export class DawnlightCompletionService {
  private readonly pathCache = new Map<string, PathCacheEntry>();

  constructor(
    private readonly documents: JsoncDocumentStore,
    private readonly source: CompletionSource
  ) {}

  invalidate(changedPaths: readonly string[] = []): void {
    if (changedPaths.length === 0) {
      this.pathCache.clear();
      return;
    }
    for (const pack of this.source.discovery.snapshot.packs) {
      if (changedPaths.some(changed => isWithin(pack.rootPath, changed))) {
        this.pathCache.delete(keyForPath(pack.rootPath));
      }
    }
  }

  complete(document: TextDocument, position: Position): CompletionItem[] {
    const documentPath = this.toPath(document.uri);
    if (!documentPath) return [];
    const association = this.source.discovery.getDocumentAssociation(documentPath);
    if (!association || association.role === 'untracked') return [];
    const pack = association.pack;
    const project = this.source.composition.snapshot.internalProjects.find(item =>
      keyForPath(item.rootUri) === keyForPath(pack.rootPath));
    const indexedProject = this.source.symbols.snapshot.projects.find(item =>
      keyForPath(item.rootUri) === keyForPath(pack.rootPath));
    const snapshot = this.documents.getByUri(document.uri);
    if (!project || !indexedProject || !snapshot) return [];
    const context: PackContext = { pack, composition: project, document: snapshot };
    const offset = snapshot.textDocument.offsetAt(position);
    const jsonPath = snapshot.nodePathAtOffset(offset);
    const range = completionRange(snapshot, jsonPath, position);
    return this.completeContext(context, jsonPath, range);
  }

  private completeContext(
    context: PackContext,
    jsonPath: readonly (string | number)[],
    range: Range
  ): CompletionItem[] {
    const { pack, composition, document } = context;
    const property = typeof jsonPath[jsonPath.length - 1] === 'string'
      ? jsonPath[jsonPath.length - 1] as string
      : typeof jsonPath[jsonPath.length - 2] === 'string'
        ? jsonPath[jsonPath.length - 2] as string
        : undefined;
    const items: CompletionItem[] = [];
    if (property === 'fragments' || arrayProperty(jsonPath, 'fragments')) {
      items.push(...this.pathItems(pack, document, jsonPath, range, 'fragment'));
    }
    if (property === 'settings') items.push(...this.pathItems(pack, document, jsonPath, range, 'settings'));
    if (property === 'vertex' || property === 'fragment' || property === 'geometry' || property === 'compute') {
      const programPath = arrayItemPath(jsonPath, 'programs');
      const program = programPath ? valueAt(document, programPath) : undefined;
      const programKind = typeof program === 'object' && program !== null
        ? String((program as Record<string, unknown>).kind ?? '')
        : property === 'compute' ? 'compute' : 'graphics';
      items.push(...this.shaderItems(pack, property, programKind, range));
    }
    if (property === 'option') {
      items.push(...definitionItems(composition.definitions.option, range, CompletionItemKind.Reference));
    }
    if (property === 'program' || property === 'programs') {
      const command = commandType(document, jsonPath);
      const passPath = arrayItemPath(jsonPath, 'passes');
      const containingPrograms = passPath ? valueAt(document, [...passPath, 'programs']) : undefined;
      const containingIds = Array.isArray(containingPrograms)
        ? new Set(containingPrograms.filter((value): value is string => typeof value === 'string' && value.length > 0))
        : undefined;
      const hasContainingPrograms = Boolean(containingIds && containingIds.size > 0);
      const filter = command === 'compute'
        ? (definition: DefinitionRecord) => definition.value.kind === 'compute' &&
          (property === 'programs' || !hasContainingPrograms || Boolean(containingIds?.has(definition.id)))
        : command === 'fullscreen' || command === 'present'
          ? (definition: DefinitionRecord) => definition.value.kind === 'graphics' &&
            (property === 'programs' || !hasContainingPrograms || Boolean(containingIds?.has(definition.id)))
          : (definition: DefinitionRecord) => property === 'programs'
            ? !hasContainingPrograms || !containingIds?.has(definition.id)
            : !hasContainingPrograms || Boolean(containingIds?.has(definition.id));
      items.push(...definitionItems(composition.definitions.program, range, CompletionItemKind.Reference, filter));
    }
    if (property === 'resource' || property === 'source' || property === 'destination' ||
      property === 'inputs' || property === 'outputs') {
      const current = currentStringValue(document, jsonPath);
      const passPath = arrayItemPath(jsonPath, 'passes');
      const currentResourceIds = (property === 'inputs' || property === 'outputs') && passPath
        ? valueAt(document, [...passPath, property])
        : undefined;
      const existingIds = Array.isArray(currentResourceIds)
        ? new Set(currentResourceIds.filter((value): value is string => typeof value === 'string' && value.length > 0))
        : new Set<string>();
      const commandPath = arrayItemPath(jsonPath, 'commands');
      const command = commandPath ? valueAt(document, [...commandPath, 'type']) : undefined;
      const filter = (definition: DefinitionRecord) => {
        if ((property === 'source' || property === 'destination') && command !== 'copy') return false;
        if (property === 'inputs' || property === 'outputs') return !existingIds.has(definition.id);
        if (property === 'source' || property === 'destination') return definition.id !== current;
        if (command === 'historyCommit') return definition.value.lifetime === 'history';
        if (arrayProperty(jsonPath, 'targets')) return resourceFilterForTarget(document, jsonPath, definition);
        if (jsonPath.includes('bindings')) {
          const bindingPath = arrayItemPath(jsonPath, 'bindings');
          const bindingKind = bindingPath ? valueAt(document, [...bindingPath, 'kind']) : undefined;
          const resourceKind = String(definition.value.kind ?? '');
          if (bindingKind === 'sampler2D' || bindingKind === 'image2D') return resourceKind === 'texture2D';
          if (bindingKind === 'samplerCube' || bindingKind === 'imageCube') return resourceKind === 'textureCube';
          if (bindingKind === 'uniformBuffer' || bindingKind === 'storageBuffer') return resourceKind === 'buffer';
        }
        return true;
      };
      items.push(...definitionItems(composition.definitions.resource, range, CompletionItemKind.Reference, filter));
    }
    if (property === 'before' || property === 'after' || property === 'requires') {
      const current = arrayItemPath(jsonPath, 'passes');
      const currentId = current ? currentStringValue(document, [...current, 'id']) : undefined;
      items.push(...definitionItems(
        composition.definitions.pass,
        range,
        CompletionItemKind.Reference,
        definition => definition.id !== currentId
      ));
    }
    if (property === 'equals' || property === 'notEquals' || property === 'in') {
      const option = selectedConditionOption(document, jsonPath, composition);
      items.push(...optionValueCandidates(option).map(value => valueItem(value, range, `value for ${option?.id ?? 'condition'}`)));
    }
    if (property === 'widget') {
      const option = selectedControlOption(document, jsonPath, composition);
      items.push(...this.widgetItems(option, range));
    }
    if (property === 'value' && jsonPath.includes('values')) {
      const option = selectedControlOption(document, jsonPath, composition);
      items.push(...optionValueCandidates(option).map(value => valueItem(value, range, `allowed value for ${option?.id ?? 'option'}`)));
    }
    if (this.isTranslationKeyContext(jsonPath)) {
      items.push(...this.translationItems(context, range));
    }
    if (items.length === 0 && property === 'programs') {
      items.push(...definitionItems(composition.definitions.program, range));
    }
    return items;
  }

  private pathItems(
    pack: ShaderPackProject,
    document: JsoncDocumentSnapshot,
    jsonPath: readonly (string | number)[],
    range: Range,
    role: 'fragment' | 'settings'
  ): CompletionItem[] {
    const files = this.pathFiles(pack).jsonFiles;
    const currentPath = relativePackPath(pack.rootPath, document.absolutePath);
    const fragments = new Set(pack.fragments.map(reference => reference.path));
    const settings = pack.settings?.path;
    return files
      .filter(file => file !== 'shaderpack.json')
      .filter(file => file !== currentPath)
      .filter(file => file !== settings && !fragments.has(file))
      .map(file => stringItem(file, range, role === 'fragment' ? 'fragment JSON file' : 'Settings UI JSON file', CompletionItemKind.File));
  }

  private shaderItems(
    pack: ShaderPackProject,
    property: string,
    programKind: string,
    range: Range
  ): CompletionItem[] {
    const shaderRoot = pack.shaderRoot?.absolutePath;
    if (!shaderRoot || programKind === 'compute' && property !== 'compute' ||
      programKind === 'graphics' && property === 'compute') return [];
    const extensions = property === 'vertex'
      ? new Set(['.vsh', '.vert', '.vs', '.glsl'])
      : property === 'fragment'
        ? new Set(['.psh', '.frag', '.fs', '.glsl'])
        : property === 'geometry'
          ? new Set(['.gsh', '.geom', '.gs', '.glsl'])
          : new Set(['.csh', '.comp', '.cs', '.glsl']);
    return this.pathFiles(pack).shaderFiles
      .filter(file => extensions.has(path.extname(file).toLowerCase()))
      .map(file => {
        const relative = path.relative(shaderRoot, file).split(path.sep).join('/');
        return stringItem(relative, range, `${programKind} shader`, CompletionItemKind.File);
      });
  }

  private widgetItems(option: DefinitionRecord | undefined, range: Range): CompletionItem[] {
    if (!option) return ['toggle', 'choice', 'slider', 'number', 'text']
      .map(widget => stringItem(widget, range, 'widget; option is not resolved', CompletionItemKind.Enum));
    const type = option.value.type;
    const allowed = Array.isArray(option.value.allowed);
    const widgets = type === 'boolean'
      ? ['toggle']
      : allowed
        ? ['choice']
        : type === 'number' || type === 'integer'
          ? ['slider', 'number']
          : ['text'];
    return widgets.map(widget => stringItem(widget, range, `${widget} for ${option.id}`, CompletionItemKind.Enum));
  }

  private isTranslationKeyContext(jsonPath: readonly (string | number)[]): boolean {
    const property = jsonPath[jsonPath.length - 1];
    return property === 'title' || property === 'label' || property === 'description';
  }

  private translationItems(context: PackContext, range: Range): CompletionItem[] {
    const settingsPath = context.pack.settings?.absolutePath;
    if (!settingsPath) return [];
    const settings = this.documents.getByPath(settingsPath);
    const translations = settings?.value && typeof settings.value === 'object'
      ? (settings.value as Record<string, unknown>).translations
      : undefined;
    const keys = new Set<string>();
    if (translations && typeof translations === 'object') {
      for (const locale of Object.values(translations as Record<string, unknown>)) {
        if (locale && typeof locale === 'object') {
          for (const key of Object.keys(locale as Record<string, unknown>)) keys.add(key);
        }
      }
    }
    return [...keys].sort().map(key => stringItem(key, range, 'Settings translation key', CompletionItemKind.Reference));
  }

  private pathFiles(pack: ShaderPackProject): PathCacheEntry {
    const key = keyForPath(pack.rootPath);
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    const jsonExtensions = new Set(['.json', '.jsonc']);
    const jsonFiles = collectFiles(pack.rootPath, jsonExtensions)
      .map(file => relativePackPath(pack.rootPath, file))
      .filter((file): file is string => file !== undefined);
    const shaderFiles = pack.shaderRoot
      ? collectFiles(pack.shaderRoot.absolutePath).filter(file => !file.includes(`${path.sep}.`))
      : [];
    const value = Object.freeze({
      jsonFiles: Object.freeze(jsonFiles),
      shaderFiles: Object.freeze(shaderFiles)
    });
    this.pathCache.set(key, value);
    return value;
  }

  private toPath(uri: string): string | undefined {
    try {
      return fileURLToPath(uri);
    } catch {
      return undefined;
    }
  }
}
