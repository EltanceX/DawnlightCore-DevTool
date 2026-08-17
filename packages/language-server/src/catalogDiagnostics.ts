import {
  CatalogEntryBase,
  CatalogSnapshotState,
  createDiagnosticCode
} from '@dawnlight/contracts';
import { getNodeValue } from 'jsonc-parser';
import {
  Diagnostic,
  DiagnosticSeverity,
  Range
} from 'vscode-languageserver/node';
import { PackComposition } from './composition';
import { JsoncDocumentSnapshot } from './jsoncDocuments';
import { ShaderPackProject } from './workspaceDiscovery';

type JsonPath = readonly (string | number)[];
type VersionedCatalogKind = 'Stage Template' | 'Service' | 'Semantic' | 'EngineDraw Provider';
type UnversionedCatalogKind = 'Capability' | 'Resource Format';
type CatalogKind = VersionedCatalogKind | UnversionedCatalogKind;

type RequiredServiceEntry = CatalogEntryBase & {
  requiredServices?: readonly string[];
};

interface CatalogReference {
  kind: CatalogKind;
  id: string;
  version?: number;
  idPath: JsonPath;
  versionPath?: JsonPath;
  entries: readonly RequiredServiceEntry[];
}

interface ResolvedReference {
  reference: CatalogReference;
  entry: RequiredServiceEntry;
}

const SOURCE = 'dawnlight-catalog';

function rangeAt(document: JsoncDocumentSnapshot, path: JsonPath): Range {
  const node = document.nodeAtPath(path);
  if (!node) return Range.create(0, 0, 0, 0);
  const range = document.rangeForNode(node);
  return Range.create(range.start.line, range.start.character, range.end.line, range.end.character);
}

function valueAt(document: JsoncDocumentSnapshot, path: JsonPath): unknown {
  const node = document.nodeAtPath(path);
  return node ? getNodeValue(node) : undefined;
}

function stringAt(document: JsoncDocumentSnapshot, path: JsonPath): string | undefined {
  const value = valueAt(document, path);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function integerAt(document: JsoncDocumentSnapshot, path: JsonPath): number | undefined {
  const value = valueAt(document, path);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function arrayLength(document: JsoncDocumentSnapshot, path: JsonPath): number {
  const value = valueAt(document, path);
  return Array.isArray(value) ? value.length : 0;
}

function objectKeys(document: JsoncDocumentSnapshot, path: JsonPath): readonly string[] {
  const value = valueAt(document, path);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  code: number,
  message: string,
  range: Range,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error
): void {
  if (diagnostics.some(item => item.code === createDiagnosticCode('catalog', code) &&
    item.message === message &&
    item.range.start.line === range.start.line &&
    item.range.start.character === range.start.character)) return;
  diagnostics.push({
    source: SOURCE,
    code: createDiagnosticCode('catalog', code),
    severity,
    message,
    range
  });
}

function versionedReference(
  document: JsoncDocumentSnapshot,
  kind: VersionedCatalogKind,
  objectPath: JsonPath,
  idProperty: string,
  entries: readonly RequiredServiceEntry[]
): CatalogReference | undefined {
  const idPath = [...objectPath, idProperty];
  const id = stringAt(document, idPath);
  if (!id) return undefined;
  const versionPath = [...objectPath, 'version'];
  return {
    kind,
    id,
    version: integerAt(document, versionPath),
    idPath,
    versionPath,
    entries
  };
}

function unversionedReference(
  document: JsoncDocumentSnapshot,
  kind: UnversionedCatalogKind,
  idPath: JsonPath,
  entries: readonly RequiredServiceEntry[]
): CatalogReference | undefined {
  const id = stringAt(document, idPath);
  return id ? { kind, id, idPath, entries } : undefined;
}

function collectReferences(
  document: JsoncDocumentSnapshot,
  catalog: CatalogSnapshotState
): CatalogReference[] {
  const references: CatalogReference[] = [];
  const snapshot = catalog.snapshot;
  for (let resourceIndex = 0; resourceIndex < arrayLength(document, ['resources']); resourceIndex += 1) {
    const resourcePath: JsonPath = ['resources', resourceIndex];
    const format = unversionedReference(
      document, 'Resource Format', [...resourcePath, 'format'], snapshot.resourceFormats);
    if (format) references.push(format);
    if (stringAt(document, [...resourcePath, 'content', 'type']) === 'service') {
      const service = versionedReference(
        document, 'Service', [...resourcePath, 'content'], 'service', snapshot.services);
      if (service) references.push(service);
    }
  }
  for (let programIndex = 0; programIndex < arrayLength(document, ['programs']); programIndex += 1) {
    const definesPath: JsonPath = ['programs', programIndex, 'defines'];
    for (const define of objectKeys(document, definesPath)) {
      const capability = unversionedReference(
        document, 'Capability', [...definesPath, define, 'capability'], snapshot.capabilities);
      if (capability) references.push(capability);
    }
  }
  for (let passIndex = 0; passIndex < arrayLength(document, ['passes']); passIndex += 1) {
    const passPath: JsonPath = ['passes', passIndex];
    const template = versionedReference(
      document, 'Stage Template', [...passPath, 'stage'], 'template', snapshot.stageTemplates);
    if (template) references.push(template);
    for (let serviceIndex = 0;
      serviceIndex < arrayLength(document, [...passPath, 'services']);
      serviceIndex += 1) {
      const service = versionedReference(
        document, 'Service', [...passPath, 'services', serviceIndex], 'id', snapshot.services);
      if (service) references.push(service);
    }
    for (let commandIndex = 0;
      commandIndex < arrayLength(document, [...passPath, 'commands']);
      commandIndex += 1) {
      const commandPath: JsonPath = [...passPath, 'commands', commandIndex];
      if (stringAt(document, [...commandPath, 'type']) === 'engineDraw') {
        const provider = versionedReference(
          document, 'EngineDraw Provider', [...commandPath, 'provider'], 'id', snapshot.engineDrawProviders);
        if (provider) references.push(provider);
      }
      for (let semanticIndex = 0;
        semanticIndex < arrayLength(document, [...commandPath, 'semantics']);
        semanticIndex += 1) {
        const semantic = versionedReference(
          document,
          'Semantic',
          [...commandPath, 'semantics', semanticIndex],
          'semantic',
          snapshot.semantics
        );
        if (semantic) references.push(semantic);
      }
    }
  }
  return references;
}

function validateReference(
  document: JsoncDocumentSnapshot,
  reference: CatalogReference,
  diagnostics: Diagnostic[]
): ResolvedReference | undefined {
  const matchingId = reference.entries.filter(entry => entry.id === reference.id);
  if (matchingId.length === 0) {
    addDiagnostic(
      diagnostics,
      1,
      `Unknown Catalog ${reference.kind} '${reference.id}'.`,
      rangeAt(document, reference.idPath)
    );
    return undefined;
  }
  let entry: RequiredServiceEntry;
  if (reference.version !== undefined) {
    const exact = matchingId.find(candidate => candidate.version === reference.version);
    if (!exact) {
      const versions = [...new Set(matchingId.map(candidate => candidate.version))].sort((a, b) => a - b);
      addDiagnostic(
        diagnostics,
        2,
        `Catalog ${reference.kind} '${reference.id}' does not support version ${reference.version}. ` +
          `Available versions: ${versions.join(', ')}.`,
        rangeAt(document, reference.versionPath ?? reference.idPath)
      );
      return undefined;
    }
    entry = exact;
  } else {
    entry = [...matchingId].sort((left, right) => right.version - left.version)[0];
  }
  if (entry.deprecated) {
    addDiagnostic(
      diagnostics,
      3,
      `Catalog ${reference.kind} '${entry.id}' version ${entry.version} is deprecated.`,
      rangeAt(document, reference.idPath),
      DiagnosticSeverity.Warning
    );
  }
  return { reference, entry };
}

function parseServiceRequirement(requirement: string): { id: string; version?: number } {
  const separator = requirement.lastIndexOf('@');
  if (separator <= 0) return { id: requirement };
  const version = Number(requirement.slice(separator + 1));
  return Number.isInteger(version)
    ? { id: requirement.slice(0, separator), version }
    : { id: requirement };
}

function addRequiredServiceDiagnostics(
  document: JsoncDocumentSnapshot,
  passIndex: number,
  resolved: readonly ResolvedReference[],
  diagnostics: Diagnostic[]
): void {
  const passPath: JsonPath = ['passes', passIndex];
  const declared = new Set<string>();
  for (let index = 0; index < arrayLength(document, [...passPath, 'services']); index += 1) {
    const id = stringAt(document, [...passPath, 'services', index, 'id']);
    const version = integerAt(document, [...passPath, 'services', index, 'version']);
    if (id) {
      declared.add(id);
      if (version !== undefined) declared.add(`${id}@${version}`);
    }
  }
  for (const item of resolved) {
    for (const requirementText of item.entry.requiredServices ?? []) {
      const requirement = parseServiceRequirement(requirementText);
      const key = requirement.version === undefined ? requirement.id : `${requirement.id}@${requirement.version}`;
      if (declared.has(key)) continue;
      addDiagnostic(
        diagnostics,
        6,
        `Catalog ${item.reference.kind} '${item.entry.id}' requires Service '${key}' in the containing pass.`,
        rangeAt(document, item.reference.idPath),
        DiagnosticSeverity.Warning
      );
    }
  }
}

function addFormatDiagnostic(
  document: JsoncDocumentSnapshot,
  path: JsonPath,
  label: string,
  supported: readonly number[],
  host: string,
  diagnostics: Diagnostic[]
): void {
  const version = integerAt(document, path);
  if (version === undefined || supported.includes(version)) return;
  addDiagnostic(
    diagnostics,
    5,
    `${label} version ${version} is not supported by Catalog host '${host}'. ` +
      `Supported versions: ${supported.length > 0 ? supported.join(', ') : 'none'}.`,
    rangeAt(document, path)
  );
}

export function computeCatalogDiagnostics(
  pack: ShaderPackProject,
  project: PackComposition,
  catalog: CatalogSnapshotState
): ReadonlyMap<string, readonly Diagnostic[]> {
  const byUri = new Map<string, readonly Diagnostic[]>();
  const root = project.documents.find(document => document.absolutePath === pack.manifestPath);
  if (!catalog.negotiation.compatible || !catalog.hashValid) {
    if (root) {
      const diagnostics: Diagnostic[] = [];
      const message = !catalog.negotiation.compatible
        ? 'Catalog contract negotiation is incompatible ' +
          `(client versions [${catalog.negotiation.clientSupportedVersions.join(', ')}], ` +
          `server versions [${catalog.negotiation.serverSupportedVersions.join(', ')}]); ` +
          'Catalog entry diagnostics are disabled.'
        : 'Catalog snapshot hash is invalid; Catalog entry diagnostics are disabled.';
      addDiagnostic(
        diagnostics,
        4,
        message,
        Range.create(0, 0, 0, 0),
        DiagnosticSeverity.Warning
      );
      byUri.set(root.uri, diagnostics);
    }
    return byUri;
  }

  if (root && root.errors.length === 0) {
    const diagnostics: Diagnostic[] = [];
    const host = `${catalog.snapshot.host.displayName} ${catalog.snapshot.host.version}`;
    addFormatDiagnostic(
      root, ['manifestVersion'], 'Manifest', catalog.snapshot.supportedFormats.manifest, host, diagnostics);
    addFormatDiagnostic(
      root,
      ['sourceFormatVersion'],
      'Source Composition',
      catalog.snapshot.supportedFormats.sourceComposition,
      host,
      diagnostics
    );
    if (diagnostics.length > 0) byUri.set(root.uri, diagnostics);
  }

  for (const document of project.documents) {
    if (document.errors.length > 0) continue;
    const diagnostics = [...(byUri.get(document.uri) ?? [])];
    if (pack.settings?.absolutePath === document.absolutePath) {
      const host = `${catalog.snapshot.host.displayName} ${catalog.snapshot.host.version}`;
      addFormatDiagnostic(
        document,
        ['schemaVersion'],
        'Settings UI',
        catalog.snapshot.supportedFormats.settingsUi,
        host,
        diagnostics
      );
    }
    const resolved = collectReferences(document, catalog)
      .map(reference => validateReference(document, reference, diagnostics))
      .filter((item): item is ResolvedReference => item !== undefined);
    for (let passIndex = 0; passIndex < arrayLength(document, ['passes']); passIndex += 1) {
      const passReferences = resolved.filter(item =>
        item.reference.idPath[0] === 'passes' && item.reference.idPath[1] === passIndex);
      addRequiredServiceDiagnostics(document, passIndex, passReferences, diagnostics);
    }
    if (diagnostics.length > 0) byUri.set(document.uri, diagnostics);
  }
  return byUri;
}
