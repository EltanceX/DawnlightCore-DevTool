# Changelog

## Unreleased - V2-0

- Added npm workspaces and strict TypeScript project references for contracts, Language Server, VS Code client, and shared test utilities.
- Added independent protocol/data contract versions and stable diagnostic namespaces.
- Added a minimal incremental-sync Language Server and an IPC-based VS Code Language Client lifecycle.
- Bundled extension and server runtime code into the VSIX without shipping `node_modules` or TypeScript sources.
- Added contract, empty-workspace LSP lifecycle, VS Code activation, and installed-VSIX regression coverage.

## 0.1.0 - MVP-6

- Added syntax/JSON quality checks exposed as `lint` and `typecheck` scripts.
- Added isolated VSIX installation acceptance testing with a clean VS Code profile.
- Added end-to-end checks for ToonLab, all fragment roles, Hover, and ordinary JSON isolation.
- Added a trimmed Dawnlight v3.1 snapshot, missing-required diagnostics, complete enum completion coverage, and schema-valid snippet expansion tests.
- Recorded the packaged file manifest and internal `0.1.0` acceptance evidence.

## 0.1.0 - MVP-5

- Added Ajv fixture validation for valid and invalid Manifest/Settings documents.
- Added JSON/JSONC property and enum completion tests using the VS Code JSON language service.
- Added static `fileMatch` and snippet registration regression tests.
- Added an optional real VS Code smoke-test harness.

## 0.1.0

- Initial declarative JSON/JSONC Schema and snippet support.
