export const CONTRACT_VERSIONS = Object.freeze({
  languageServerProtocol: 1,
  analyzerProtocol: 1,
  catalogSnapshot: 1,
  catalogSourceRegistration: 1,
  schemaContract: 1,
  manifest: 3,
  sourceComposition: 1,
  settingsUi: 1
} as const);

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

export interface DawnlightInitializeOptions {
  clientProtocolVersion: number;
  catalogSnapshotVersions?: readonly number[];
  catalogPath?: string;
  analyzerPath?: string;
  analyzerTimeoutMs?: number;
  analyzerRestartLimit?: number;
  validationOnSave?: boolean;
}

export interface DawnlightServerCapabilities {
  languageServerProtocolVersion: number;
  analyzerProtocolVersions: readonly number[];
  schemaContractVersion: number;
  catalogSnapshotVersions: readonly number[];
  manifestVersions: readonly number[];
  sourceCompositionVersions: readonly number[];
  settingsUiVersions: readonly number[];
}

export const SERVER_CAPABILITIES: DawnlightServerCapabilities = Object.freeze({
  languageServerProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
  analyzerProtocolVersions: Object.freeze([CONTRACT_VERSIONS.analyzerProtocol]),
  schemaContractVersion: CONTRACT_VERSIONS.schemaContract,
  catalogSnapshotVersions: Object.freeze([CONTRACT_VERSIONS.catalogSnapshot]),
  manifestVersions: Object.freeze([CONTRACT_VERSIONS.manifest]),
  sourceCompositionVersions: Object.freeze([CONTRACT_VERSIONS.sourceComposition]),
  settingsUiVersions: Object.freeze([CONTRACT_VERSIONS.settingsUi])
});
