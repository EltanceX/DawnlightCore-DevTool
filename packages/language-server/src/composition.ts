import {
  createDiagnosticCode,
  DawnlightCompositionDefinitionSnapshot,
  DawnlightWorkspaceCompositionSnapshot
} from '@dawnlight/contracts';
import {
  JsoncDocumentSnapshot,
  JsoncRange,
  JsoncDocumentStore
} from './jsoncDocuments';
import { getNodeValue } from 'jsonc-parser';
import { ShaderPackProject, WorkspaceDiscoverySnapshot } from './workspaceDiscovery';

type DefinitionKind = 'option' | 'resource' | 'program' | 'pass';
export type CompositionDefinitionKind = DefinitionKind;
export type DefinitionRecord = DawnlightCompositionDefinitionSnapshot & { value: Record<string, unknown> };

export interface CompositionDiagnostic {
  code: string;
  message: string;
  uri: string;
  range?: JsoncRange;
}

export interface PackComposition {
  rootUri: string;
  discoveryGeneration: number;
  documents: readonly JsoncDocumentSnapshot[];
  definitions: Readonly<Record<DefinitionKind, readonly DefinitionRecord[]>>;
  diagnostics: readonly CompositionDiagnostic[];
}

export interface CompositionRebuildResult {
  applied: boolean;
  snapshot: WorkspaceCompositionSnapshot;
}

export interface WorkspaceCompositionSnapshot extends DawnlightWorkspaceCompositionSnapshot {
  readonly internalProjects: readonly PackComposition[];
}

const definitionProperties: Readonly<Record<DefinitionKind, string>> = Object.freeze({
  option: 'options',
  resource: 'resources',
  program: 'programs',
  pass: 'passes'
});

function emptyDefinitions(): Record<DefinitionKind, DefinitionRecord[]> {
  return { option: [], resource: [], program: [], pass: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyWorkspaceSnapshot(): WorkspaceCompositionSnapshot {
  return Object.freeze({
    generation: 0,
    projects: Object.freeze([]),
    internalProjects: Object.freeze([])
  });
}

export class WorkspaceCompositionManager {
  private current: WorkspaceCompositionSnapshot = emptyWorkspaceSnapshot();
  private projectGeneration = 0;
  private requestGeneration = 0;

  constructor(private readonly documents: JsoncDocumentStore) {}

  get snapshot(): WorkspaceCompositionSnapshot {
    return this.current;
  }

  cancel(): void {
    this.requestGeneration += 1;
  }

  async rebuild(
    discovery: WorkspaceDiscoverySnapshot,
    signal?: AbortSignal
  ): Promise<CompositionRebuildResult> {
    const request = ++this.requestGeneration;
    await Promise.resolve();
    if (signal?.aborted || request !== this.requestGeneration) {
      return { applied: false, snapshot: this.current };
    }
    const projects = discovery.packs.map(pack => this.composePack(pack, discovery.generation));
    if (signal?.aborted || request !== this.requestGeneration) {
      return { applied: false, snapshot: this.current };
    }
    this.projectGeneration += 1;
    const next = Object.freeze({
      generation: this.projectGeneration,
      projects: Object.freeze(projects.map(project => this.toTransport(project))),
      internalProjects: Object.freeze(projects)
    });
    this.current = next;
    return { applied: true, snapshot: next };
  }

  private composePack(pack: ShaderPackProject, discoveryGeneration: number): PackComposition {
    const diagnostics: CompositionDiagnostic[] = [];
    const definitions = emptyDefinitions();
    const documents: JsoncDocumentSnapshot[] = [];
    const root = this.documents.getByPath(pack.manifestPath);
    if (root) {
      documents.push(root);
      this.addParseDiagnostics(root, diagnostics);
    }

    const hasFragments = pack.fragments.length > 0;
    if (hasFragments) {
      for (let fragmentOrder = 0; fragmentOrder < pack.fragments.length; fragmentOrder += 1) {
        const reference = pack.fragments[fragmentOrder];
        const fragment = this.documents.getByPath(reference.absolutePath);
        if (!fragment) continue;
        documents.push(fragment);
        this.addParseDiagnostics(fragment, diagnostics);
        this.collectDefinitions(fragment, fragmentOrder, definitions);
      }
    } else if (root) {
      this.collectDefinitions(root, 0, definitions);
    }

    if (pack.settings) {
      const settings = this.documents.getByPath(pack.settings.absolutePath);
      if (settings) {
        documents.push(settings);
        this.addParseDiagnostics(settings, diagnostics);
      }
    }

    return Object.freeze({
      rootUri: pack.rootPath,
      discoveryGeneration,
      documents: Object.freeze(documents),
      definitions: Object.freeze({
        option: Object.freeze(definitions.option),
        resource: Object.freeze(definitions.resource),
        program: Object.freeze(definitions.program),
        pass: Object.freeze(definitions.pass)
      }),
      diagnostics: Object.freeze(diagnostics.map(diagnostic => Object.freeze(diagnostic)))
    });
  }

  private collectDefinitions(
    document: JsoncDocumentSnapshot,
    fragmentOrder: number,
    definitions: Record<DefinitionKind, DefinitionRecord[]>
  ): void {
    for (const kind of Object.keys(definitionProperties) as DefinitionKind[]) {
      const property = definitionProperties[kind];
      const value = document.nodeAtPath([property]);
      if (!value || value.type !== 'array' || !value.children) continue;
      value.children.forEach((item, localOrder) => {
        const itemValue = getNodeValue(item);
        if (!isRecord(itemValue) || typeof itemValue.id !== 'string') return;
        const idNode = document.nodeAtPath([property, localOrder, 'id']);
        const record: DefinitionRecord = {
          id: itemValue.id,
          kind,
          uri: document.uri,
          range: document.rangeForNode(item),
          selectionRange: idNode ? document.rangeForNode(idNode) : document.rangeForNode(item),
          fragmentOrder,
          localOrder,
          value: itemValue
        };
        definitions[kind].push(Object.freeze(record));
      });
    }
  }

  private addParseDiagnostics(
    document: JsoncDocumentSnapshot,
    diagnostics: CompositionDiagnostic[]
  ): void {
    for (const error of document.errors) {
      const nodeRange = {
        start: document.textDocument.positionAt(error.offset),
        end: document.textDocument.positionAt(error.offset + error.length)
      };
      diagnostics.push({
        code: createDiagnosticCode('json', 1),
        message: 'JSONC document contains a syntax error.',
        uri: document.uri,
        range: nodeRange
      });
    }
  }

  private toTransport(project: PackComposition) {
    return Object.freeze({
      rootUri: project.rootUri,
      discoveryGeneration: project.discoveryGeneration,
      documents: Object.freeze(project.documents.map(document => ({
        uri: document.uri,
        version: document.version,
        source: document.source,
        parseErrorCount: document.errors.length
      }))),
      definitions: Object.freeze({
        options: Object.freeze(project.definitions.option.map(this.toDefinition)),
        resources: Object.freeze(project.definitions.resource.map(this.toDefinition)),
        programs: Object.freeze(project.definitions.program.map(this.toDefinition)),
        passes: Object.freeze(project.definitions.pass.map(this.toDefinition))
      }),
      diagnostics: Object.freeze(project.diagnostics)
    });
  }

  private readonly toDefinition = (definition: DefinitionRecord) => Object.freeze({
    id: definition.id,
    kind: definition.kind,
    uri: definition.uri,
    range: definition.range,
    selectionRange: definition.selectionRange,
    fragmentOrder: definition.fragmentOrder,
    localOrder: definition.localOrder
  });
}
