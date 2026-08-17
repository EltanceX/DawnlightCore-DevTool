import {
  CatalogEntryBase,
  CatalogSnapshotState
} from '@dawnlight/contracts';
import { getNodeValue } from 'jsonc-parser';
import {
  Hover,
  Location,
  MarkupKind,
  Position,
  Range
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { JsoncDocumentSnapshot, JsoncDocumentStore } from './jsoncDocuments';

type CatalogKind =
  | 'stageTemplate'
  | 'service'
  | 'semantic'
  | 'engineDrawProvider'
  | 'capability'
  | 'resourceFormat';

type CatalogEntry = CatalogEntryBase & {
  valueKind?: string;
  requiredServices?: readonly string[];
  requiredCapabilities?: readonly string[];
  command?: string;
  phase?: string;
  targets?: readonly string[];
  components?: number;
  bytesPerPixel?: number;
  depth?: boolean;
};

interface CatalogReference {
  kind: CatalogKind;
  entry: CatalogEntry;
  range: Range;
}

const kindLabels: Record<CatalogKind, string> = {
  stageTemplate: 'Stage Template',
  service: 'Service',
  semantic: 'Semantic',
  engineDrawProvider: 'EngineDraw Provider',
  capability: 'Capability',
  resourceFormat: 'Resource Format'
};

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

function stringAt(document: JsoncDocumentSnapshot, jsonPath: readonly (string | number)[]): string | undefined {
  const value = valueAt(document, jsonPath);
  return typeof value === 'string' ? value : undefined;
}

function numberAt(document: JsoncDocumentSnapshot, jsonPath: readonly (string | number)[]): number | undefined {
  const value = valueAt(document, jsonPath);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function commandType(document: JsoncDocumentSnapshot, jsonPath: readonly (string | number)[]): string | undefined {
  const commandPath = arrayItemPath(jsonPath, 'commands');
  return commandPath ? stringAt(document, [...commandPath, 'type']) : undefined;
}

function entryFor(
  entries: readonly CatalogEntry[],
  id: string | undefined,
  version: number | undefined,
  exactVersion: boolean
): CatalogEntry | undefined {
  if (!id) return undefined;
  const matches = entries.filter(entry => entry.id === id);
  if (version !== undefined) {
    const exact = matches.find(entry => entry.version === version);
    if (exact || exactVersion) return exact;
  }
  return matches.sort((left, right) => right.version - left.version)[0];
}

function inline(value: unknown): string {
  return `\`${String(value).replace(/`/g, '\\`')}\``;
}

function entryMarkdown(
  reference: Pick<CatalogReference, 'kind' | 'entry'>,
  catalog: CatalogSnapshotState,
  heading = false
): string {
  const { kind, entry } = reference;
  const lines = [
    `${heading ? '#' : '**'}${kindLabels[kind]}${heading ? '' : '**'} ${inline(entry.id)}`,
    '',
    `- Version: ${inline(entry.version)}`
  ];
  if (entry.valueKind) lines.push(`- Value kind: ${inline(entry.valueKind)}`);
  if (entry.requiredServices?.length) {
    lines.push(`- Required services: ${entry.requiredServices.map(inline).join(', ')}`);
  }
  if (entry.requiredCapabilities?.length) {
    lines.push(`- Required capabilities: ${entry.requiredCapabilities.map(inline).join(', ')}`);
  }
  if (entry.command) lines.push(`- Command: ${inline(entry.command)}`);
  if (entry.phase) lines.push(`- Phase: ${inline(entry.phase)}`);
  if (entry.targets?.length) lines.push(`- Targets: ${entry.targets.map(inline).join(', ')}`);
  if (entry.components !== undefined) lines.push(`- Components: ${inline(entry.components)}`);
  if (entry.bytesPerPixel !== undefined) lines.push(`- Bytes per pixel: ${inline(entry.bytesPerPixel)}`);
  if (entry.depth !== undefined) lines.push(`- Depth format: ${inline(entry.depth)}`);
  if (entry.since) lines.push(`- Since: ${inline(entry.since)}`);
  if (entry.deprecated) lines.push('- Deprecated: **yes**');
  lines.push(
    `- Source: ${inline(catalog.source)}`,
    `- Host: ${inline(`${catalog.snapshot.host.displayName} ${catalog.snapshot.host.version}`)}`,
    `- Catalog hash: ${inline(catalog.hash)}`
  );
  if (entry.description) lines.push('', entry.description);
  return lines.join('\n');
}

function virtualUri(kind: CatalogKind, entry: CatalogEntry, catalog: CatalogSnapshotState): string {
  return `dawnlight-catalog://${encodeURIComponent(catalog.snapshot.host.id)}/` +
    `${kind}/${encodeURIComponent(entry.id)}/${entry.version}.md?hash=${catalog.hash}`;
}

export class DawnlightCatalogNavigationService {
  constructor(
    private readonly documents: JsoncDocumentStore,
    private readonly catalog: () => CatalogSnapshotState
  ) {}

  definition(document: TextDocument, position: Position): Location[] | null {
    const reference = this.reference(document, position);
    if (!reference) return null;
    return [Location.create(
      virtualUri(reference.kind, reference.entry, this.catalog()),
      Range.create(0, 0, 0, 0)
    )];
  }

  hover(document: TextDocument, position: Position): Hover | null {
    const reference = this.reference(document, position);
    if (!reference) return null;
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: entryMarkdown(reference, this.catalog())
      },
      range: reference.range
    };
  }

  document(uri: string): string | null {
    const catalog = this.catalog();
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'dawnlight-catalog:' || parsed.searchParams.get('hash') !== catalog.hash) return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 3) return null;
    const kind = parts[0] as CatalogKind;
    if (!(kind in kindLabels)) return null;
    const id = decodeURIComponent(parts[1]);
    const version = Number(parts[2].replace(/\.md$/, ''));
    const entry = this.entries(kind, catalog).find(candidate =>
      candidate.id === id && candidate.version === version);
    return entry ? `${entryMarkdown({ kind, entry }, catalog, true)}\n` : null;
  }

  private reference(document: TextDocument, position: Position): CatalogReference | undefined {
    const catalog = this.catalog();
    if (!catalog.negotiation.compatible || !catalog.hashValid) return undefined;
    const snapshot = this.documents.getByUri(document.uri);
    if (!snapshot || snapshot.version !== document.version) return undefined;
    const offset = snapshot.textDocument.offsetAt(position);
    const jsonPath = snapshot.nodePathAtOffset(offset);
    const node = snapshot.nodeAtPath(jsonPath);
    if (!node) return undefined;
    const property = typeof jsonPath[jsonPath.length - 1] === 'string'
      ? jsonPath[jsonPath.length - 1] as string
      : typeof jsonPath[jsonPath.length - 2] === 'string'
        ? jsonPath[jsonPath.length - 2] as string
        : undefined;
    const context = this.context(snapshot, jsonPath, property, catalog);
    if (!context) return undefined;
    return {
      kind: context.kind,
      entry: context.entry,
      range: Range.create(
        snapshot.textDocument.positionAt(node.offset),
        snapshot.textDocument.positionAt(node.offset + node.length)
      )
    };
  }

  private context(
    document: JsoncDocumentSnapshot,
    jsonPath: readonly (string | number)[],
    property: string | undefined,
    catalog: CatalogSnapshotState
  ): Pick<CatalogReference, 'kind' | 'entry'> | undefined {
    const passPath = arrayItemPath(jsonPath, 'passes');
    const resourcePath = arrayItemPath(jsonPath, 'resources');
    const servicePath = arrayItemPath(jsonPath, 'services');
    const semanticPath = arrayItemPath(jsonPath, 'semantics');
    const providerIndex = jsonPath.lastIndexOf('provider');
    const providerPath = providerIndex >= 0 ? jsonPath.slice(0, providerIndex + 1) : undefined;
    const contentIndex = jsonPath.lastIndexOf('content');
    const contentPath = contentIndex >= 0 ? jsonPath.slice(0, contentIndex + 1) : undefined;
    const stagePath = passPath ? [...passPath, 'stage'] : undefined;
    let kind: CatalogKind | undefined;
    let id: string | undefined;
    let version: number | undefined;
    let exactVersion = true;

    if ((property === 'template' || property === 'version') && stagePath && jsonPath.includes('stage')) {
      kind = 'stageTemplate';
      id = stringAt(document, [...stagePath, 'template']);
      version = numberAt(document, [...stagePath, 'version']);
    } else if ((property === 'semantic' || property === 'version') && semanticPath) {
      kind = 'semantic';
      id = stringAt(document, [...semanticPath, 'semantic']);
      version = numberAt(document, [...semanticPath, 'version']);
    } else if ((property === 'id' || property === 'version') && servicePath) {
      kind = 'service';
      id = stringAt(document, [...servicePath, 'id']);
      version = numberAt(document, [...servicePath, 'version']);
    } else if ((property === 'id' || property === 'version') && providerPath &&
      commandType(document, jsonPath) === 'engineDraw') {
      kind = 'engineDrawProvider';
      id = stringAt(document, [...providerPath, 'id']);
      version = numberAt(document, [...providerPath, 'version']);
    } else if ((property === 'service' || property === 'version') && contentPath) {
      kind = 'service';
      id = stringAt(document, [...contentPath, 'service']);
      version = numberAt(document, [...contentPath, 'version']);
    } else if (property === 'capability') {
      kind = 'capability';
      id = stringAt(document, jsonPath);
      exactVersion = false;
    } else if (property === 'format' && resourcePath) {
      kind = 'resourceFormat';
      id = stringAt(document, jsonPath);
      exactVersion = false;
    }
    if (!kind) return undefined;
    const entry = entryFor(this.entries(kind, catalog), id, version, exactVersion);
    return entry ? { kind, entry } : undefined;
  }

  private entries(kind: CatalogKind, catalog: CatalogSnapshotState): readonly CatalogEntry[] {
    const snapshot = catalog.snapshot;
    const entries: Record<CatalogKind, readonly CatalogEntry[]> = {
      stageTemplate: snapshot.stageTemplates,
      service: snapshot.services,
      semantic: snapshot.semantics,
      engineDrawProvider: snapshot.engineDrawProviders,
      capability: snapshot.capabilities,
      resourceFormat: snapshot.resourceFormats
    };
    return entries[kind];
  }
}
