import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CatalogSnapshotInfo,
  parseCatalogSnapshot,
  verifyCatalogSnapshotHash
} from '@dawnlight/contracts';

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
