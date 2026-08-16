import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getLanguageService,
  LanguageService
} from 'vscode-json-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';

export type DynamicSchemaRole = 'fragment' | 'settings';

function schemaFileName(role: DynamicSchemaRole): string {
  return role === 'fragment'
    ? 'shaderpack-manifest-v3-fragment.schema.json'
    : 'shaderpack-settings-ui-v1.schema.json';
}

export class DawnlightSchemaService {
  private readonly services: Readonly<Record<DynamicSchemaRole, LanguageService>>;
  private readonly roles = new Map<string, DynamicSchemaRole | undefined>();

  constructor(private readonly schemaDirectory: string) {
    this.services = Object.freeze({
      fragment: this.createService('fragment'),
      settings: this.createService('settings')
    });
  }

  complete(document: TextDocument, position: { line: number; character: number }) {
    const role = this.roleFor(document);
    if (!role) return null;
    const service = this.services[role];
    return service.doComplete(document, position, service.parseJSONDocument(document));
  }

  hover(document: TextDocument, position: { line: number; character: number }) {
    const role = this.roleFor(document);
    if (!role) return null;
    const service = this.services[role];
    return service.doHover(document, position, service.parseJSONDocument(document));
  }

  validate(document: TextDocument, role: DynamicSchemaRole) {
    const service = this.services[role];
    return service.doValidation(document, service.parseJSONDocument(document));
  }

  setRole(document: TextDocument, role: DynamicSchemaRole | undefined): void {
    if (role) this.roles.set(document.uri, role);
    else this.roles.delete(document.uri);
  }

  private roleFor(document: TextDocument): DynamicSchemaRole | undefined {
    return this.roles.get(document.uri);
  }

  private createService(role: DynamicSchemaRole): LanguageService {
    const schemaPath = path.join(this.schemaDirectory, schemaFileName(role));
    const service = getLanguageService({
      schemaRequestService: uri => {
        let requestedPath: string;
        try {
          requestedPath = new URL(uri).protocol === 'file:'
            ? path.join(this.schemaDirectory, path.basename(new URL(uri).pathname))
            : path.join(this.schemaDirectory, path.basename(uri));
        } catch {
          requestedPath = path.join(this.schemaDirectory, path.basename(uri));
        }
        return fs.promises.readFile(requestedPath, 'utf8');
      }
    });
    service.configure({
      schemas: [{
        uri: pathToFileURL(schemaPath).toString(),
        fileMatch: ['**/*']
      }]
    });
    return service;
  }
}
