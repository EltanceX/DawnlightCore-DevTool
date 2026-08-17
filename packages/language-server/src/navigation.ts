import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DawnlightPackSymbolIndexSnapshot,
  DawnlightPosition,
  DawnlightRange,
  DawnlightReferenceSnapshot,
  DawnlightSymbolKind,
  DawnlightSymbolSnapshot
} from '@dawnlight/contracts';
import { getNodeValue } from 'jsonc-parser';
import {
  Hover,
  Location,
  MarkupKind,
  Position,
  PrepareRenameResult,
  Range,
  TextEdit,
  WorkspaceEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PackComposition, WorkspaceCompositionManager } from './composition';
import { JsoncDocumentSnapshot, JsoncDocumentStore } from './jsoncDocuments';
import { WorkspaceSymbolIndexManager } from './symbols';

const identifierPattern = /^[a-z0-9][a-z0-9_-]*:\S+$/;
const coreSymbolKinds = new Set<DawnlightSymbolKind>(['option', 'resource', 'program', 'pass']);

export class DawnlightRenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DawnlightRenameError';
  }
}

interface NavigationContext {
  document: JsoncDocumentSnapshot;
  project: DawnlightPackSymbolIndexSnapshot;
  composition: PackComposition;
  symbol?: DawnlightSymbolSnapshot;
  reference?: DawnlightReferenceSnapshot;
}

function comparePosition(left: DawnlightPosition, right: DawnlightPosition): number {
  return left.line - right.line || left.character - right.character;
}

function contains(range: DawnlightRange, position: Position): boolean {
  return comparePosition(range.start, position) <= 0 && comparePosition(position, range.end) <= 0;
}

function sameLocation(left: Location, right: Location): boolean {
  return left.uri === right.uri &&
    comparePosition(left.range.start, right.range.start) === 0 &&
    comparePosition(left.range.end, right.range.end) === 0;
}

function uniqueLocations(locations: readonly Location[]): Location[] {
  const result: Location[] = [];
  for (const location of locations) {
    if (!result.some(existing => sameLocation(existing, location))) result.push(location);
  }
  return result;
}

function normalizedRelativePath(root: string, uri: string): string {
  try {
    return path.relative(root, fileURLToPath(uri)).split(path.sep).join('/');
  } catch {
    return uri;
  }
}

function inline(value: unknown): string {
  return `\`${String(value).replace(/`/g, '\\`')}\``;
}

function list(value: unknown): string | undefined {
  return Array.isArray(value) && value.length > 0 ? value.map(inline).join(', ') : undefined;
}

function sizeSummary(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const size = value as Record<string, unknown>;
  const details = ['mode', 'scale', 'width', 'height']
    .filter(key => size[key] !== undefined)
    .map(key => `${key}=${String(size[key])}`);
  return details.length > 0 ? details.join(', ') : undefined;
}

function valueLine(label: string, value: unknown): string | undefined {
  return value === undefined ? undefined : `- ${label}: ${inline(
    typeof value === 'object' ? JSON.stringify(value) : value
  )}`;
}

function symbolTitle(kind: DawnlightSymbolKind): string {
  const titles: Record<DawnlightSymbolKind, string> = {
    option: 'Option',
    resource: 'Resource',
    program: 'Program',
    pass: 'Pass',
    settingsPage: 'Settings page',
    settingsGroup: 'Settings group',
    settingsControl: 'Settings control',
    file: 'File'
  };
  return titles[kind];
}

function definitionForSymbol(
  composition: PackComposition,
  symbol: DawnlightSymbolSnapshot
) {
  if (!coreSymbolKinds.has(symbol.kind)) return undefined;
  const definitions = composition.definitions[symbol.kind as 'option' | 'resource' | 'program' | 'pass'];
  return definitions.find(definition => definition.id === symbol.id && definition.uri === symbol.uri);
}

function symbolHover(
  composition: PackComposition,
  symbol: DawnlightSymbolSnapshot,
  range: Range
): Hover {
  const definition = definitionForSymbol(composition, symbol);
  const value = definition?.value ?? {};
  const lines: (string | undefined)[] = [
    `**${symbolTitle(symbol.kind)}** ${inline(symbol.id)}`,
    ''
  ];
  if (symbol.kind === 'option') {
    lines.push(
      valueLine('Type', value.type),
      valueLine('Default', value.default),
      list(value.allowed) ? `- Allowed: ${list(value.allowed)}` : undefined,
      value.min !== undefined || value.max !== undefined
        ? `- Range: ${inline(value.min ?? '-inf')} to ${inline(value.max ?? '+inf')}`
        : undefined,
      list(value.impact) ? `- Impact: ${list(value.impact)}` : undefined
    );
  } else if (symbol.kind === 'resource') {
    lines.push(
      valueLine('Kind', value.kind),
      valueLine('Format', value.format),
      valueLine('Lifetime', value.lifetime),
      sizeSummary(value.size) ? `- Size: ${inline(sizeSummary(value.size))}` : undefined,
      valueLine('Content', value.content)
    );
  } else if (symbol.kind === 'program') {
    const shaders = ['vertex', 'fragment', 'geometry', 'compute']
      .filter(stage => value[stage] !== undefined)
      .map(stage => `${stage}=${String(value[stage])}`);
    const defines = value.defines && typeof value.defines === 'object' && !Array.isArray(value.defines)
      ? Object.keys(value.defines as Record<string, unknown>).length
      : undefined;
    lines.push(
      valueLine('Kind', value.kind),
      shaders.length > 0 ? `- Shaders: ${inline(shaders.join(', '))}` : undefined,
      valueLine('Compile mode', value.compileMode),
      defines !== undefined ? `- Defines: ${inline(defines)}` : undefined
    );
  } else if (symbol.kind === 'pass') {
    const stage = value.stage && typeof value.stage === 'object' && !Array.isArray(value.stage)
      ? value.stage as Record<string, unknown>
      : undefined;
    const host = value.host && typeof value.host === 'object' && !Array.isArray(value.host)
      ? value.host as Record<string, unknown>
      : undefined;
    lines.push(
      valueLine('Stage', stage?.template),
      valueLine('Target', stage?.target ?? host?.target),
      valueLine('Phase', stage?.phase ?? host?.phase),
      Array.isArray(value.commands) ? `- Commands: ${inline(value.commands.length)}` : undefined
    );
  }
  lines.push('', `Defined in ${inline(normalizedRelativePath(composition.rootUri, symbol.uri))}`);
  return {
    contents: { kind: MarkupKind.Markdown, value: lines.filter(line => line !== undefined).join('\n') },
    range
  };
}

function pathHover(reference: DawnlightReferenceSnapshot): Hover {
  const labels: Record<'path' | 'shader' | 'asset', string> = {
    path: 'Pack document', shader: 'Shader file', asset: 'Asset file'
  };
  const target = reference.targetPath ?? '(invalid path)';
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: [
        `**${labels[reference.kind as 'path' | 'shader' | 'asset']}** ${inline(target)}`,
        '',
        `- Status: ${reference.resolved ? 'exists' : 'missing or invalid'}`,
        '- Path Rename updates JSON references only and does not move the file.'
      ].join('\n')
    },
    range: reference.range
  };
}

function isSafePackPath(value: string): boolean {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

export class DawnlightNavigationService {
  constructor(
    private readonly documents: JsoncDocumentStore,
    private readonly composition: WorkspaceCompositionManager,
    private readonly symbols: WorkspaceSymbolIndexManager
  ) {}

  definition(document: TextDocument, position: Position): Location[] | null {
    const context = this.context(document, position);
    if (!context) return null;
    if (context.reference) {
      if (!context.reference.resolved || context.reference.ambiguous) return null;
      if (context.reference.targetId && context.reference.targetKind) {
        const target = this.uniqueTarget(context.project, context.reference);
        return target ? [Location.create(target.uri, target.selectionRange)] : null;
      }
      if (context.reference.targetUri) {
        return [Location.create(context.reference.targetUri, Range.create(0, 0, 0, 0))];
      }
    }
    return context.symbol ? [Location.create(context.symbol.uri, context.symbol.selectionRange)] : null;
  }

  references(document: TextDocument, position: Position, includeDeclaration: boolean): Location[] | null {
    const context = this.context(document, position);
    if (!context) return null;
    const symbol = context.symbol ?? (context.reference
      ? this.uniqueTarget(context.project, context.reference)
      : undefined);
    if (symbol && coreSymbolKinds.has(symbol.kind)) {
      const matches = context.project.references
        .filter(reference => reference.targetId === symbol.id && reference.targetKind === symbol.kind)
        .map(reference => Location.create(reference.uri, reference.range));
      if (includeDeclaration) matches.unshift(Location.create(symbol.uri, symbol.selectionRange));
      return uniqueLocations(matches);
    }
    const targetPath = context.reference?.targetPath;
    if (targetPath) {
      return uniqueLocations(context.project.references
        .filter(reference => reference.targetPath === targetPath)
        .map(reference => Location.create(reference.uri, reference.range)));
    }
    return null;
  }

  hover(document: TextDocument, position: Position): Hover | null {
    const context = this.context(document, position);
    if (!context) return null;
    if (context.reference) {
      if (context.reference.targetId) {
        const target = this.uniqueTarget(context.project, context.reference);
        return target ? symbolHover(context.composition, target, context.reference.range) : null;
      }
      return pathHover(context.reference);
    }
    return context.symbol ? symbolHover(context.composition, context.symbol, context.symbol.selectionRange) : null;
  }

  prepareRename(document: TextDocument, position: Position): PrepareRenameResult | null {
    const context = this.requireRenameContext(document, position);
    const range = context.reference?.range ?? context.symbol?.selectionRange;
    if (!range) return null;
    return { range, placeholder: this.currentValue(context) };
  }

  rename(document: TextDocument, position: Position, newName: string): WorkspaceEdit {
    const context = this.requireRenameContext(document, position);
    const target = context.symbol ?? (context.reference
      ? this.uniqueTarget(context.project, context.reference)
      : undefined);
    if (target && coreSymbolKinds.has(target.kind)) {
      if (!identifierPattern.test(newName)) {
        throw new DawnlightRenameError(
          "Dawnlight IDs must be namespaced, for example 'example:feature', and cannot contain whitespace."
        );
      }
      const collision = context.project.symbols.some(symbol =>
        coreSymbolKinds.has(symbol.kind) && symbol.canonicalId === newName &&
        symbol !== target);
      if (collision && newName !== target.id) {
        throw new DawnlightRenameError(`Cannot rename to '${newName}' because that ID is already defined.`);
      }
      const references = context.project.references.filter(reference =>
        reference.targetId === target.id && reference.targetKind === target.kind);
      if (references.some(reference => !reference.resolved || reference.ambiguous)) {
        throw new DawnlightRenameError('Cannot rename because one or more matching references are uncertain.');
      }
      return this.workspaceEdit([
        { uri: target.uri, range: target.selectionRange },
        ...references.map(reference => ({ uri: reference.uri, range: reference.range }))
      ], newName);
    }

    const pathReference = context.reference;
    if (!pathReference?.targetPath) {
      throw new DawnlightRenameError('The selected value is not a confirmed Dawnlight symbol or path.');
    }
    if (!isSafePackPath(newName)) {
      throw new DawnlightRenameError('Dawnlight paths must be relative, use forward slashes, and cannot contain dot segments.');
    }
    const references = context.project.references.filter(reference =>
      reference.targetPath === pathReference.targetPath && reference.kind === pathReference.kind);
    if (references.some(reference => !reference.resolved || reference.ambiguous)) {
      throw new DawnlightRenameError('Cannot rename because one or more matching path references are uncertain.');
    }
    return this.workspaceEdit(
      references.map(reference => ({ uri: reference.uri, range: reference.range })),
      newName
    );
  }

  private context(document: TextDocument, position: Position): NavigationContext | undefined {
    const snapshot = this.documents.getByUri(document.uri);
    if (!snapshot || snapshot.version !== document.version) return undefined;
    const matchingProjects = this.symbols.snapshot.projects.filter(candidate =>
      candidate.documents.some(item => item.uri === document.uri));
    if (matchingProjects.length !== 1 ||
      matchingProjects[0].compositionGeneration !== this.composition.snapshot.generation) return undefined;
    const project = matchingProjects[0];
    const composed = this.composition.snapshot.internalProjects.find(candidate =>
      candidate.rootUri === project?.rootUri);
    if (!project || !composed) return undefined;
    const indexedDocument = project.documents.find(item => item.uri === document.uri);
    if (!indexedDocument || indexedDocument.version !== snapshot.version) return undefined;
    const references = project.references.filter(reference =>
      reference.uri === document.uri && contains(reference.range, position));
    const symbols = project.symbols.filter(symbol =>
      symbol.kind !== 'file' && symbol.uri === document.uri && contains(symbol.selectionRange, position));
    return {
      document: snapshot,
      project,
      composition: composed,
      reference: references.sort((left, right) => this.rangeLength(snapshot, left.range) -
        this.rangeLength(snapshot, right.range))[0],
      symbol: symbols[0]
    };
  }

  private requireRenameContext(document: TextDocument, position: Position): NavigationContext {
    const context = this.context(document, position);
    if (!context) {
      throw new DawnlightRenameError('Dawnlight cannot rename while the project index is updating.');
    }
    if (context.project.documents.some(item => item.parseErrorCount > 0)) {
      throw new DawnlightRenameError('Cannot rename while a shader-pack JSONC document has syntax errors.');
    }
    if (context.project.duplicates.length > 0) {
      throw new DawnlightRenameError('Cannot rename while the shader pack contains duplicate symbol IDs.');
    }
    if (!context.symbol && !context.reference) {
      throw new DawnlightRenameError('The selected value is not a Dawnlight symbol or path.');
    }
    if (context.symbol && !coreSymbolKinds.has(context.symbol.kind) && !context.reference) {
      throw new DawnlightRenameError(
        'Rename is supported for option, resource, program, pass, and confirmed path references.'
      );
    }
    if (context.reference && (!context.reference.resolved || context.reference.ambiguous)) {
      throw new DawnlightRenameError('Cannot rename an unresolved or ambiguous reference.');
    }
    return context;
  }

  private uniqueTarget(
    project: DawnlightPackSymbolIndexSnapshot,
    reference: DawnlightReferenceSnapshot
  ): DawnlightSymbolSnapshot | undefined {
    if (!reference.targetId || !reference.targetKind) return undefined;
    const matches = project.symbols.filter(symbol =>
      symbol.id === reference.targetId && symbol.kind === reference.targetKind);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private currentValue(context: NavigationContext): string {
    if (context.symbol) return context.symbol.id;
    const node = context.reference ? context.document.nodeAtPath(context.reference.path) : undefined;
    const value = node ? getNodeValue(node) : undefined;
    return typeof value === 'string' ? value : '';
  }

  private workspaceEdit(
    locations: readonly { uri: string; range: DawnlightRange }[],
    newName: string
  ): WorkspaceEdit {
    const changes: Record<string, TextEdit[]> = {};
    for (const location of locations) {
      const edits = changes[location.uri] ?? [];
      if (!edits.some(edit => comparePosition(edit.range.start, location.range.start) === 0 &&
        comparePosition(edit.range.end, location.range.end) === 0)) {
        edits.push(TextEdit.replace(location.range, JSON.stringify(newName)));
      }
      changes[location.uri] = edits;
    }
    return { changes };
  }

  private rangeLength(document: JsoncDocumentSnapshot, range: DawnlightRange): number {
    return document.textDocument.offsetAt(range.end) - document.textDocument.offsetAt(range.start);
  }
}

export function mergeHover(schema: Hover | null, dynamic: Hover | null): Hover | null {
  if (!schema) return dynamic;
  if (!dynamic) return schema;
  const markdown = (hover: Hover): string => {
    if (typeof hover.contents === 'string') return hover.contents;
    if (Array.isArray(hover.contents)) return hover.contents.map(item =>
      typeof item === 'string' ? item : item.value).join('\n\n');
    return hover.contents.value;
  };
  return {
    contents: { kind: MarkupKind.Markdown, value: `${markdown(dynamic)}\n\n---\n\n${markdown(schema)}` },
    range: dynamic.range ?? schema.range
  };
}
