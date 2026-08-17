import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONTRACT_VERSIONS,
  CatalogSnapshotInfo,
  CatalogSnapshotState,
  CatalogVersionNegotiation,
  parseCatalogSnapshot,
  verifyCatalogSnapshotHash
} from '@dawnlight/contracts';

export interface CatalogResolutionOptions {
  externalPath?: string;
  clientSupportedVersions?: readonly number[];
}

export function loadCatalogSnapshot(filePath: string, source: CatalogSnapshotInfo['source']): CatalogSnapshotInfo {
  const absolutePath = path.resolve(filePath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const snapshot = parseCatalogSnapshot(JSON.parse(text));
  return Object.freeze({
    source,
    path: absolutePath,
    hash: snapshot.hash,
    hashValid: verifyCatalogSnapshotHash(snapshot),
    snapshot
  });
}

export function loadBundledCatalogSnapshot(catalogDirectory: string): CatalogSnapshotInfo {
  return loadCatalogSnapshot(path.join(catalogDirectory, 'dawnlight-3.1.catalog.json'), 'bundled');
}

export function negotiateCatalogSnapshotVersion(
  clientSupportedVersions: readonly number[] = [CONTRACT_VERSIONS.catalogSnapshot],
  serverSupportedVersions: readonly number[] = [CONTRACT_VERSIONS.catalogSnapshot]
): CatalogVersionNegotiation {
  const client = [...new Set(clientSupportedVersions.filter(Number.isInteger))].sort((a, b) => a - b);
  const server = [...new Set(serverSupportedVersions.filter(Number.isInteger))].sort((a, b) => a - b);
  const selectedVersion = [...client].reverse().find(version => server.includes(version));
  return Object.freeze({
    clientSupportedVersions: Object.freeze(client),
    serverSupportedVersions: Object.freeze(server),
    selectedVersion,
    compatible: selectedVersion !== undefined
  });
}

export function resolveCatalogSnapshot(
  catalogDirectory: string,
  options: CatalogResolutionOptions = {}
): CatalogSnapshotState {
  const negotiation = negotiateCatalogSnapshotVersion(options.clientSupportedVersions);
  const requestedPath = options.externalPath?.trim() || undefined;
  let selected: CatalogSnapshotInfo | undefined;
  let fallbackReason: string | undefined;

  if (requestedPath && negotiation.compatible) {
    try {
      const external = loadCatalogSnapshot(requestedPath, 'external');
      if (!external.hashValid) throw new Error('canonical hash does not match the snapshot content');
      selected = external;
    } catch (error) {
      fallbackReason = `External Catalog '${requestedPath}' was not used: ${(error as Error).message}`;
    }
  }

  if (!selected) {
    selected = loadBundledCatalogSnapshot(catalogDirectory);
    if (!selected.hashValid) throw new Error(`Bundled Catalog '${selected.path}' has an invalid canonical hash.`);
  }

  return Object.freeze({
    ...selected,
    requestedPath,
    fallbackReason,
    negotiation
  });
}
