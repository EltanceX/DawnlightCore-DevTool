export const CONTRACT_VERSIONS = Object.freeze({
  languageServerProtocol: 1,
  analyzerProtocol: 1,
  catalogSnapshot: 1,
  schemaContract: 1,
  manifest: 3,
  sourceComposition: 1,
  settingsUi: 1
} as const);

export type ContractVersionName = keyof typeof CONTRACT_VERSIONS;

export interface DawnlightInitializeOptions {
  clientProtocolVersion: number;
}

export interface DawnlightServerCapabilities {
  languageServerProtocolVersion: number;
  schemaContractVersion: number;
  manifestVersions: readonly number[];
  sourceCompositionVersions: readonly number[];
  settingsUiVersions: readonly number[];
}

export const SERVER_CAPABILITIES: DawnlightServerCapabilities = Object.freeze({
  languageServerProtocolVersion: CONTRACT_VERSIONS.languageServerProtocol,
  schemaContractVersion: CONTRACT_VERSIONS.schemaContract,
  manifestVersions: Object.freeze([CONTRACT_VERSIONS.manifest]),
  sourceCompositionVersions: Object.freeze([CONTRACT_VERSIONS.sourceComposition]),
  settingsUiVersions: Object.freeze([CONTRACT_VERSIONS.settingsUi])
});
