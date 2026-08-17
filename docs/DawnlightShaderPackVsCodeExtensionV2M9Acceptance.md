# Dawnlight Shader Pack VS Code Extension V2-9 Acceptance

## 1. Scope

V2-9 adds fast Catalog diagnostics to the Language Server. The diagnostics use
the same negotiated Catalog Snapshot, JSONC overlays, pack composition and
incremental scheduling as V2-6 through V2-8. They are authoring feedback only;
the future C# Analyzer remains authoritative for runtime and engine-specific
validation.

## 2. Diagnostic contract

Catalog diagnostics have the independent `dawnlight-catalog` source and stable
`DLCAT` namespace:

| Code | Severity | Meaning |
|---|---|---|
| `DLCAT0001` | Error | Catalog ID is unknown for the referenced entry kind |
| `DLCAT0002` | Error | ID exists, but the requested version is unavailable |
| `DLCAT0003` | Warning | The resolved Catalog entry is deprecated |
| `DLCAT0004` | Warning | Catalog contract negotiation or snapshot integrity is incompatible |
| `DLCAT0005` | Error | Manifest, Source Composition or Settings UI format is unsupported by the host |
| `DLCAT0006` | Warning | A resolved entry requires a Service missing from the containing pass |

Version errors list all versions available for the referenced ID. Entry and
version ranges are taken from the JSONC AST, including unsaved overlays.

## 3. Catalog reference coverage

| Manifest context | Catalog collection | Validation |
|---|---|---|
| `passes[].stage.template/version` | `stageTemplates` | ID, version, deprecation |
| `passes[].services[].id/version` | `services` | ID, version, deprecation, required Services |
| `resources[].content.service/version` | `services` | ID, version, deprecation |
| `commands[].semantics[].semantic/version` | `semantics` | ID, version, deprecation, required Services |
| `engineDraw.provider.id/version` | `engineDrawProviders` | ID, version, deprecation, required Services |
| `programs[].defines.*.capability` | `capabilities` | ID, latest-entry deprecation |
| `resources[].format` | `resourceFormats` | ID, latest-entry deprecation |

The root `manifestVersion` and `sourceFormatVersion`, plus the discovered
Settings document `schemaVersion`, are checked against
`CatalogSnapshot.supportedFormats`.

## 4. Scheduling and isolation

- [x] `dawnlight-catalog` is merged independently from Schema, JSON, path,
  symbol and graph diagnostics;
- [x] the existing 175 ms debounce, generation check and stale-result discard
  apply unchanged;
- [x] the per-pack cache is invalidated when the Catalog hash or negotiation
  result changes;
- [x] changed documents recompute only their owning pack;
- [x] malformed JSONC documents keep syntax diagnostics and suppress Catalog
  cascades for that document;
- [x] independent packs do not share Catalog diagnostics;
- [x] editing an invalid reference to a valid entry clears the diagnostic
  without saving the file.

## 5. Failure and fallback behavior

Detailed entry diagnostics run only when both conditions are true:

```text
catalog.negotiation.compatible == true
catalog.hashValid == true
```

When negotiation fails or snapshot integrity is invalid, every pack root gets
one `DLCAT0004` warning and detailed entry/format diagnostics are disabled. This
prevents a missing or incompatible Catalog from turning all valid extension IDs
into false unknown-ID errors. Invalid external Catalog files that already fell
back to the valid bundled snapshot continue to use that bundled data.

## 6. Verification

```powershell
npm test
npm run lint
$env:DAWNLIGHT_RUN_VSCODE_TEST='1'; npm run test:vscode
npm run package
$env:DAWNLIGHT_RUN_VSIX_TEST='1'; npm run test:vsix
```

The V2-9 LSP suite covers all seven reference contexts, unknown IDs,
unsupported versions with available-version text, deprecated external entries,
all three supported-format contracts, required Services, JSONC recovery,
overlay clearing, incompatible negotiation suppression and multi-pack
isolation. The complete unit suite contains 68 tests after V2-9.

## 7. Deferred

- [ ] C# Analyzer authoritative `DLMAN` validation and diagnostic merge;
- [ ] Catalog exporter and parity verification against engine/plugin
  registrations;
- [ ] live Catalog reload after configuration or Catalog file changes;
- [ ] engine runtime capability and resource-limit validation;
- [ ] graph hazard and shader-interface checks that require Analyzer state.
