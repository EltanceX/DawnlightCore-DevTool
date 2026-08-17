# Dawnlight Shader Pack VS Code Extension V2-8 Acceptance

## 1. Scope

V2-8 consumes the V2-7 Catalog Snapshot contract and completes four authoring
capabilities: Catalog version negotiation, bundled/external selection,
context-aware completion, and Catalog Hover/Definition. It does not add unknown
Catalog diagnostics or C# Analyzer authority.

## 2. Version negotiation and fallback

- [x] the VS Code client advertises supported Catalog Snapshot versions;
- [x] the Language Server selects the highest common contract version;
- [x] `dawnlight.shaderPack.catalog.path` selects an external Snapshot;
- [x] relative paths resolve from the first workspace folder;
- [x] invalid JSON, unsupported contracts, missing files and hash mismatch fall back to bundled data;
- [x] source, path, hash, fallback reason and negotiation result are exposed by `dawnlight/catalogSnapshot`;
- [x] source/hash and mismatch information are written to the Language Server output;
- [x] Catalog incompatibility disables Catalog authoring features without affecting pack-local features.

The Catalog path is read at Language Server startup. Changing it currently
requires restarting the Language Server or reloading the VS Code window.

## 3. Completion coverage

| Manifest context | Catalog collection | Version behavior |
|---|---|---|
| `stage.template` | `stageTemplates` | paired `stage.version` |
| `passes[].services[].id` | `services` | paired service `version` |
| `content.service` | `services` | paired content `version` |
| `semantics[].semantic` | `semantics` | paired semantic `version` |
| `engineDraw.provider.id` | `engineDrawProviders` | paired provider `version` |
| `defines.*.capability` | `capabilities` | unversioned manifest reference |
| resource `format` | `resourceFormats` | unversioned manifest reference |

- [x] ID candidates display kind, latest version, value kind, dependencies, source and deprecation state;
- [x] version completion only displays versions registered for the paired ID;
- [x] external Catalog items sort before bundled fallback items;
- [x] pack-local candidates retain their existing highest priority;
- [x] cubemap format completion excludes depth formats;
- [x] resource formats are no longer hard-coded as a structural Schema enum;
- [x] completion never starts or waits for the C# Analyzer.

## 4. Hover and Definition

- [x] Hover resolves exact `id + version` entries;
- [x] unversioned Capability and Resource Format references resolve the latest entry;
- [x] Hover shows description, value kind, dependencies, source, host and canonical hash;
- [x] Definition returns a stable `dawnlight-catalog:` URI tied to the current hash;
- [x] the VS Code extension registers a readonly virtual document provider;
- [x] stale virtual URIs from a different Catalog hash are rejected;
- [x] virtual documents never load assemblies, callbacks or executable Catalog content;
- [x] Schema, pack-local and Catalog Hover content remains mergeable.

## 5. Bundled Dawnlight 3.1 baseline

The bundled Snapshot contains the registrations currently present in the
Dawnlight engine source:

- 7 Stage Templates;
- 7 Services;
- 34 Semantics;
- 14 EngineDraw Providers;
- 2 Capabilities;
- 9 Resource Formats.

The Snapshot hash is generated from canonical data and verified at Language
Server startup. Future production Catalog export should replace the manually
maintained fallback data and add engine/plugin parity tests.

## 6. Verification

```powershell
npm test
npm run lint
npm run package
$env:DAWNLIGHT_RUN_VSCODE_TEST='1'; npm run test:vscode
```

Unit/LSP coverage includes version negotiation, external selection, fallback,
all completion contexts, exact-version Hover, virtual Definition content and
existing MVP/V2 regressions. The real VS Code smoke test opens a returned
`dawnlight-catalog:` document through the registered content provider.

## 7. Deferred

- [ ] live Catalog reload after configuration/file changes;
- [ ] `DLCAT` unknown ID/version and host-format diagnostics;
- [ ] Catalog exporter and parity verification against the C# registration set;
- [ ] C# Analyzer sidecar and authoritative validation.
