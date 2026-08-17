# Dawnlight Shader Pack VS Code Extension V2-10 Acceptance

## 1. Scope

V2-10 adds the optional C# Analyzer sidecar boundary and save-triggered
authoritative diagnostics. The Language Server remains fully usable without a
configured Analyzer: Schema, pack-local indexes, Catalog features and fast
L0-L2 diagnostics do not start or wait for a sidecar.

This repository provides the protocol client, lifecycle and VSIX configuration
surface. The production C# Analyzer executable is supplied by the engine/tool
repository and is selected through `dawnlight.shaderPack.analyzer.path`.

## 2. Contracts

The independent Analyzer protocol version is advertised as
`CONTRACT_VERSIONS.analyzerProtocol` and negotiated with:

```text
dawnlight/initialize
dawnlight/getCatalog
dawnlight/validatePack
dawnlight/dumpGraph
dawnlight/explainVariant
dawnlight/shutdown
```

`validatePack` receives:

```json
{
  "packRoot": "E:/shaderpacks/MyPack",
  "catalogHash": "<active-catalog-sha256>",
  "requestVersion": 37,
  "overlays": [
    { "path": "manifest/passes/output.json", "version": 18, "content": "{ ... }" }
  ]
}
```

The client uses JSON-RPC 2.0 `Content-Length` framing over stdin/stdout. stderr
is logged separately and never parsed as protocol data. Messages are capped at
8 MiB. `.js`, `.dll` and native executable paths are launched through explicit
process APIs with `shell: false`.

## 3. Authoritative diagnostics

- [x] `textDocumentSync` advertises save notifications;
- [x] a save of a tracked pack document starts one validation for its owning
  pack when `validation.onSave` is enabled;
- [x] explicit `dawnlight/validatePack` requests validate the selected or first
  discovered pack;
- [x] `DLMAN####` diagnostics use the independent `dawnlight-analyzer` source;
- [x] Analyzer pack-relative files are sandbox-checked before publication;
- [x] RFC 6901 JSON Pointers map to JSONC AST ranges, with nearest-parent
  fallback for a not-yet-existing property;
- [x] related diagnostic locations are mapped to LSP `relatedInformation`;
- [x] response `requestVersion` is checked and stale responses are discarded;
- [x] requests for different packs do not cancel one another;
- [x] Analyzer diagnostics are atomically replaced per pack and merged with
  Schema/fast sources;
- [x] a new save clears the previous authoritative result for that pack while
  validation is pending.

## 4. Lifecycle and degradation

Analyzer states are exposed through `dawnlight/analyzerStatus`:

```text
disabled | starting | ready | validating | offline
```

- [x] no path means `disabled` and no child process;
- [x] the sidecar is started lazily on the first save/explicit validation;
- [x] initialize negotiation failure, timeout, EOF and crash become `offline`;
- [x] stderr and lifecycle failures are written to Language Server output;
- [x] automatic restarts are bounded by `validation.restartLimit` (default 3);
- [x] `dawnlight/restartAnalyzer` resets the retry budget and clears Analyzer
  diagnostics;
- [x] Language Server shutdown sends `dawnlight/shutdown` and terminates the
  child if it does not exit cleanly;
- [x] Analyzer failure never removes Schema, Catalog or fast diagnostics.

## 5. VS Code surface

Configuration:

| Setting | Default | Purpose |
|---|---:|---|
| `dawnlight.shaderPack.analyzer.path` | `""` | external `.exe`, `.js`, `.dll` or native sidecar path |
| `dawnlight.shaderPack.validation.onSave` | `true` | enable save-triggered authority |
| `dawnlight.shaderPack.validation.timeoutMs` | `10000` | per-request timeout |
| `dawnlight.shaderPack.validation.restartLimit` | `3` | bounded automatic restarts |

Commands:

```text
Dawnlight: Validate Shader Pack
Dawnlight: Restart Analyzer
```

## 6. Verification

```powershell
npm test
npm run lint
$env:DAWNLIGHT_RUN_VSCODE_TEST='1'; npm run test:vscode
npm run package
$env:DAWNLIGHT_RUN_VSIX_TEST='1'; npm run test:vsix
```

The V2-10 suite verifies stdio framing, Unicode payloads, protocol negotiation,
timeout/crash degradation, overlay forwarding, pointer ranges, related
information, save-triggered diagnostics, stale save A/B ordering, explicit
validation, source merging and Analyzer configuration. The complete unit
suite contains 73 tests.

## 7. Deferred boundary

- [ ] engine-side C# Analyzer implementation and parity fixtures;
- [ ] platform-specific self-contained Analyzer binaries bundled per VSIX
  target;
- [ ] live configuration reload without Language Server restart;
- [ ] graph/variant virtual documents backed by `dumpGraph` and
  `explainVariant`;
- [ ] Analyzer progress UI and a persistent status bar indicator.
