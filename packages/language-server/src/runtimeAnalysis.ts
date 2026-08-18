import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** A bounded in-process cache for immutable graph/variant documents. */
export interface RuntimeSnapshotCacheEntry {
  uri: string;
  operation: 'graph' | 'variant';
  packRoot: string;
  fingerprint: string;
  content: string;
  result: unknown;
}

export class RuntimeSnapshotCache {
  private readonly entries = new Map<string, RuntimeSnapshotCacheEntry>();

  constructor(private readonly maxEntries = 64) {}

  get(uri: string): RuntimeSnapshotCacheEntry | undefined {
    const entry = this.entries.get(uri);
    if (!entry) return undefined;
    this.entries.delete(uri);
    this.entries.set(uri, entry);
    return entry;
  }

  has(uri: string): boolean {
    return this.entries.has(uri);
  }

  set(entry: RuntimeSnapshotCacheEntry): void {
    this.entries.delete(entry.uri);
    this.entries.set(entry.uri, Object.freeze(entry));
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  invalidatePack(packRoot: string): void {
    for (const [uri, entry] of this.entries) {
      if (samePath(entry.packRoot, packRoot)) this.entries.delete(uri);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface RuntimeDocumentKey {
  sourceUri: string;
  programId?: string;
}

export function encodeRuntimeDocumentUri(
  scheme: 'dawnlight-graph' | 'dawnlight-variant',
  key: RuntimeDocumentKey,
  fingerprint?: string
): string {
  const encoded = encodeURIComponent(JSON.stringify(key));
  const suffix = fingerprint ? `-${fingerprint.slice(0, 16)}` : '';
  return `${scheme}:/snapshot${suffix}.md?key=${encoded}`;
}

export function decodeRuntimeDocumentUri(uri: string): RuntimeDocumentKey | undefined {
  try {
    const queryIndex = uri.indexOf('?');
    if (queryIndex < 0) return undefined;
    const query = new URLSearchParams(uri.slice(queryIndex + 1));
    const raw = query.get('key');
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.sourceUri !== 'string' || value.sourceUri.length === 0) {
      return undefined;
    }
    if (value.programId !== undefined && typeof value.programId !== 'string') return undefined;
    return {
      sourceUri: value.sourceUri,
      programId: value.programId as string | undefined
    };
  } catch {
    return undefined;
  }
}

/**
 * Build an input fingerprint from the exact pack-local documents supplied as
 * overlays. Disk-backed documents carry their current text as well, so a
 * watcher event cannot accidentally reuse a stale runtime snapshot.
 */
export function runtimeInputFingerprint(
  packRoot: string,
  catalogHash: string,
  operation: 'graph' | 'variant',
  selector: string | undefined,
  inputs: unknown,
  project: { documents?: readonly RuntimeDocumentLike[] } | undefined
): string {
  const documents = (project?.documents ?? []).map(document => ({
    path: relativePath(packRoot, document.absolutePath),
    source: document.source,
    version: document.version,
    textSha256: sha256(document.text)
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return sha256(stableStringify({
    packRoot: path.resolve(packRoot),
    catalogHash: catalogHash.toLowerCase(),
    operation,
    selector: selector ?? null,
    inputs: inputs ?? {},
    documents
  }));
}

export interface RuntimeDocumentLike {
  absolutePath: string;
  source: string;
  version: number;
  text: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Canonical JSON used for cache keys and human-readable snapshot payloads. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function renderRuntimeGraph(result: unknown, packRoot: string): string {
  const envelope = asRecord(result);
  const graph = asRecord(envelope?.graph) ?? envelope ?? {};
  const lines: string[] = [
    '# Dawnlight Runtime Graph',
    '',
    `- Graph hash: \`${stringValue(graph.graphHash) ?? 'unknown'}\``,
    `- Manifest hash: \`${stringValue(envelope?.manifestHash) ?? 'unknown'}\``,
    `- Catalog hash: \`${stringValue(envelope?.catalogHash) ?? 'unknown'}\``,
    `- Variant fingerprint: \`${stringValue(graph.variantFingerprint) ?? 'default'}\``,
    ''
  ];
  appendList(lines, 'Execution order', graph.executionOrder);
  appendObjects(lines, 'Nodes', graph.nodes, node => {
    const label = stringValue(node.label) ?? stringValue(node.id) ?? 'node';
    const active = node.active === false ? 'inactive' : 'active';
    return `- **${escapeMarkdown(label)}** (${stringValue(node.kind) ?? 'node'}, ${active})${provenanceSuffix(node.provenance, packRoot)}`;
  });
  appendObjects(lines, 'Resources', graph.resources, resource => {
    const id = stringValue(resource.id) ?? 'resource';
    const lifetime = asRecord(resource.lifetime);
    const range = lifetime ? ` [${lifetime.firstOrder ?? '?'}..${lifetime.lastOrder ?? '?'}]` : '';
    return `- \`${escapeMarkdown(id)}\`${range}${provenanceSuffix(resource.provenance, packRoot)}`;
  });
  appendObjects(lines, 'Events', graph.events, event => {
    const id = stringValue(event.id) ?? 'event';
    const kind = stringValue(event.kind) ?? 'access';
    const resource = stringValue(event.resourceId);
    return `- \`${escapeMarkdown(id)}\`: ${escapeMarkdown(kind)}${resource ? ` → \`${escapeMarkdown(resource)}\`` : ''}${provenanceSuffix(event.provenance, packRoot)}`;
  });
  appendObjects(lines, 'Bindings', graph.bindings, binding => {
    const id = stringValue(binding.id) ?? 'binding';
    const resource = stringValue(binding.resourceId) ?? 'unresolved';
    return `- \`${escapeMarkdown(id)}\`: ${String(binding.kind ?? 'binding')} slot \`${escapeMarkdown(String(binding.slot ?? '?'))}\` → \`${escapeMarkdown(resource)}\` (${String(binding.access ?? 'read')})${provenanceSuffix(binding.provenance, packRoot)}`;
  });
  appendObjects(lines, 'Draw buffers', graph.drawBuffers, drawBuffer => {
    const id = stringValue(drawBuffer.id) ?? 'draw-buffer';
    const resource = stringValue(drawBuffer.resourceId) ?? 'unresolved';
    return `- \`${escapeMarkdown(id)}\`: location \`${String(drawBuffer.location ?? '?')}\` → \`${escapeMarkdown(resource)}\` (${drawBuffer.enabled === false ? 'disabled' : 'enabled'})${provenanceSuffix(drawBuffer.provenance, packRoot)}`;
  });
  appendObjects(lines, 'Edges', graph.edges, edge => {
    const from = stringValue(edge.from) ?? '?';
    const to = stringValue(edge.to) ?? '?';
    return `- \`${escapeMarkdown(from)}\` → \`${escapeMarkdown(to)}\` (${stringValue(edge.kind) ?? 'dependency'})`;
  });
  appendObjects(lines, 'Hazards', graph.hazards, hazard => {
    const code = stringValue(hazard.code) ?? 'DLGRAPH';
    const message = stringValue(hazard.message) ?? 'Runtime hazard';
    return `- **${escapeMarkdown(code)}** ${escapeMarkdown(message)}${provenanceSuffix(hazard.provenance, packRoot)}`;
  });
  appendObjects(lines, 'Diagnostics', envelope?.diagnostics, diagnostic => {
    const code = stringValue(diagnostic.code) ?? 'DLGRAPH';
    const message = stringValue(diagnostic.message) ?? 'Runtime graph diagnostic';
    return `- **${escapeMarkdown(code)}** ${escapeMarkdown(message)}${provenanceSuffix(diagnostic.provenance, packRoot)}`;
  });
  lines.push('', '## Canonical snapshot', '', '```json', stablePrettyJson(graph), '```', '', '## DOT', '', '```dot', renderDot(graph), '```', '');
  return lines.join('\n');
}

export function renderVariantExplanation(result: unknown, packRoot: string): string {
  const envelope = asRecord(result);
  const explanation = asRecord(envelope?.explanation) ?? envelope ?? {};
  const lines: string[] = [
    '# Dawnlight Program Variant',
    '',
    `- Program: \`${stringValue(explanation.programId) ?? 'unknown'}\``,
    `- Kind: \`${stringValue(explanation.kind) ?? 'unknown'}\``,
    `- Active: \`${explanation.active === true ? 'true' : 'false'}\``,
    `- Compile mode: \`${stringValue(explanation.compileMode) ?? 'default'}\``,
    `- Variant fingerprint: \`${stringValue(explanation.variantFingerprint) ?? 'unknown'}\``,
    `- Manifest hash: \`${stringValue(envelope?.manifestHash) ?? 'unknown'}\``,
    `- Catalog hash: \`${stringValue(envelope?.catalogHash) ?? 'unknown'}\``,
    ''
  ];
  if (explanation.inactiveReason) lines.push(`Inactive reason: ${escapeMarkdown(String(explanation.inactiveReason))}`, '');
  appendObjects(lines, 'Source files', explanation.sourceFiles, source => {
    const stage = stringValue(source.stage) ?? 'stage';
    const file = stringValue(source.file) ?? 'unknown';
    return `- **${escapeMarkdown(stage)}** [${escapeMarkdown(file)}](${provenanceUrl(source.provenance, packRoot, file)})`;
  });
  appendObjects(lines, 'Inputs', [
    ...recordsFrom(explanation.inputs, 'options', 'option'),
    ...recordsFrom(explanation.inputs, 'capabilities', 'capability')
  ], input => `- \`${escapeMarkdown(String(input.id ?? 'input'))}\` = \`${escapeMarkdown(String(input.value ?? 'null'))}\` (${String(input.source ?? 'unknown')})${provenanceSuffix(input.provenance, packRoot)}`);
  appendObjects(lines, 'Defines', explanation.defines, define => {
    const name = stringValue(define.name) ?? 'DEFINE';
    const value = define.defined === false ? '(omitted)' : (stringValue(define.value) ?? '(flag)');
    const source = asRecord(define.source);
    return `- \`${escapeMarkdown(name)}\` = \`${escapeMarkdown(value)}\` (${String(source?.kind ?? 'unknown')}${source?.id ? `: ${source.id}` : ''})${provenanceSuffix(source?.provenance, packRoot)}`;
  });
  appendList(lines, 'Graph node IDs', explanation.graphNodeIds);
  appendObjects(lines, 'Includes', explanation.includes, include => {
    const file = stringValue(include.file) ?? 'unknown';
    return `- [${escapeMarkdown(file)}](${provenanceUrl(include.provenance, packRoot, file)})`;
  });
  appendObjects(lines, 'Diagnostics', envelope?.diagnostics, diagnostic => {
    const code = stringValue(diagnostic.code) ?? 'DLGRAPH';
    const message = stringValue(diagnostic.message) ?? 'Variant diagnostic';
    return `- **${escapeMarkdown(code)}** ${escapeMarkdown(message)}${provenanceSuffix(diagnostic.provenance, packRoot)}`;
  });
  lines.push('', '## Canonical explanation', '', '```json', stablePrettyJson(explanation), '```', '');
  return lines.join('\n');
}

function appendList(lines: string[], title: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return;
  lines.push(`## ${title}`, '');
  for (const item of value) lines.push(`- \`${escapeMarkdown(String(item))}\``);
  lines.push('');
}

function appendObjects(
  lines: string[],
  title: string,
  value: unknown,
  render: (record: Record<string, unknown>) => string
): void {
  if (!Array.isArray(value) || value.length === 0) return;
  lines.push(`## ${title}`, '');
  for (const item of value) {
    if (isRecord(item)) lines.push(render(item));
  }
  lines.push('');
}

function recordsFrom(owner: unknown, property: string, fallbackKind: string): Record<string, unknown>[] {
  const value = asRecord(owner)?.[property];
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(item => ({ ...item, kind: item.kind ?? fallbackKind }));
}

function renderDot(graph: Record<string, unknown>): string {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRecord) : [];
  const lines = ['digraph dawnlight_runtime {'];
  for (const node of nodes) {
    const id = stringValue(node.id);
    if (!id) continue;
    const label = stringValue(node.label) ?? id;
    lines.push(`  "${dotEscape(id)}" [label="${dotEscape(label)}"];`);
  }
  for (const edge of edges) {
    const from = stringValue(edge.from);
    const to = stringValue(edge.to);
    if (!from || !to) continue;
    lines.push(`  "${dotEscape(from)}" -> "${dotEscape(to)}";`);
  }
  lines.push('}');
  return lines.join('\n');
}

function provenanceSuffix(value: unknown, packRoot: string): string {
  const provenance = firstProvenance(value);
  if (!provenance) return '';
  const file = stringValue(provenance.file);
  if (!file) return provenance.description ? ` — ${escapeMarkdown(String(provenance.description))}` : '';
  return ` — [${escapeMarkdown(file)}](${provenanceUrl(provenance, packRoot, file)})`;
}

function provenanceUrl(value: unknown, packRoot: string, fallbackFile?: string): string {
  const provenance = firstProvenance(value);
  const file = stringValue(provenance?.file) ?? fallbackFile;
  if (!file) return '#';
  const absolute = path.resolve(packRoot, ...file.replace(/\\/g, '/').split('/'));
  const url = pathToFileURL(absolute).toString();
  const pointer = stringValue(provenance?.pointer);
  return pointer ? `${url}#${encodeURIComponent(pointer)}` : url;
}

function firstProvenance(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return value.find(isRecord);
  return asRecord(value);
}

function relativePath(root: string, file: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(file)).replace(/\\/g, '/');
  return relative || '.';
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function stablePrettyJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJson(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&');
}

function dotEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
