# Changelog

## Unreleased - V2-8

- Added Catalog contract-version negotiation and configurable external Snapshot loading with hash validation and bundled fallback.
- Added context-aware ID/version completion for Stage Templates, Services, Semantics, EngineDraw Providers, Capabilities, and resource formats.
- Moved resource-format values out of the structural Schema enum and into the active Catalog.
- Added Catalog metadata Hover with exact version, value kind, dependencies, source, host, and canonical hash.
- Added Definition into readonly `dawnlight-catalog:` virtual documents served by the Language Server.

## Unreleased - V2-7

- Added Catalog Snapshot v1 TypeScript and JSON Schema contracts with deterministic canonical SHA-256 hashing.
- Added a bundled Dawnlight 3.1 fallback Snapshot and `dawnlight/catalogSnapshot` status request.
- Added runtime validation for host, supported formats, entry collections, versions, and duplicate IDs.

## Unreleased - V2-6

- Added fast cross-file JSONC, path, symbol, and graph diagnostics with a 175 ms generation-safe refresh.
- Added missing/invalid fragment, Settings, shader, and asset path diagnostics with pack-relative ranges.
- Added duplicate/unknown/ambiguous pack-local ID diagnostics and Settings `hiddenOptions`/coverage references.
- Added command program kind/list membership, historyCommit lifetime, resource binding/target compatibility, and ordering self-reference diagnostics.
- Added Settings UI unknown option, duplicate control, widget/type, missing translation-key, and uncovered-option diagnostics.
- Merged independent diagnostic owners before publishing so Schema, syntax, and L2 results do not erase one another; stale Schema results are discarded.
- Added LSP integration and VS Code smoke coverage for diagnostic source isolation, malformed overlays, stale results, and multi-file graph rules.

## Unreleased - V2-5

- Added pack-local Definition and References for option, resource, program, and pass IDs across fragments and Settings UI.
- Added Definition for fragment, Settings, shader, and asset paths with normalized pack-relative path Hover.
- Added symbol-aware Hover summaries for option/resource/program/pass metadata and definition fragments, merged with Schema Hover.
- Added prepare Rename and previewable `WorkspaceEdit` results for confirmed IDs and JSON paths without moving files.
- Added explicit Rename rejection for duplicate IDs, JSONC syntax errors, unresolved/ambiguous references, invalid names, collisions, and stale indexes.
- Added pass ordering references and multi-pack/overlay/stale-generation isolation tests.

## Unreleased - V2-4

- Added dynamic JSON/JSONC completion merged with existing Schema completion.
- Added pack-local fragment/settings/shader path completion and option/resource/program/pass ID candidates.
- Added graphics/compute, binding/resource kind, history lifetime, Settings widget and translation key filtering.
- Added completion item details, sort order, JSON-safe insert text and precise replacement ranges.

## Unreleased - V2-3

- Added pack-local Symbol/Reference Index snapshots for options, resources, programs, passes, Settings UI, shader paths, and asset paths.
- Added duplicate canonical ID detection with precise definition ranges and `DLSYMBOL0001` diagnostics.
- Added strict multi-pack isolation and incremental affected-project rebuilds with immutable atomic snapshots.
- Added `dawnlight/symbolSnapshot` and tests for resolved references, file symbols, duplicates, overlays, and incremental reuse.

## Unreleased - V2-2

- Added JSONC document snapshots with comments, trailing commas, syntax errors, precise AST ranges, source kind, and LSP document versions.
- Added unsaved overlay priority over disk content without writing edits back to pack files.
- Added ordered root-fragment composition for options, resources, programs, and passes, including forward references and local definition ranges.
- Added malformed-fragment isolation, atomic composition generations, cancellation, and stale-result rejection.
- Added composition snapshot LSP contract and tests for root reorder, document version changes, and unsaved definitions.

## Unreleased - V2-1

- Added multi-root workspace discovery for one or more `shaderpack.json` projects.
- Added normalized pack-relative fragment, settings, and shader-root references with default build/dependency directory exclusions.
- Added stable discovery diagnostics for invalid, duplicate, self-including, missing, escaping, and ambiguously owned paths.
- Added atomic workspace generations and refresh handling for roots, tracked files, and workspace-folder changes.
- Added Language Server Schema completion, Hover, and diagnostics for explicitly referenced fragment/settings files outside the first-version static directory layout.
- Added isolated multi-pack, nested-pack, malformed-root, file-event, LSP process, real VS Code, and installed-VSIX coverage.

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
