# Dawnlight Shader Pack VS Code Extension V2-7 Acceptance

## Scope

V2-7 adds the Catalog Snapshot v1 data contract and a bundled Dawnlight 3.1
fallback. It is intentionally limited to immutable data loading and source/hash
visibility. Catalog-aware completion, external Catalog selection and Analyzer
diagnostics remain later milestones.

## Implemented

- [x] Catalog Snapshot v1 TypeScript contracts are exported from `@dawnlight/contracts`;
- [x] host, supported format, entry collection and limits fields are runtime validated;
- [x] duplicate `id` + `version` entries are rejected;
- [x] canonical JSON serialization sorts object keys deterministically;
- [x] SHA-256 canonical hash excludes the embedded `hash` field;
- [x] bundled `catalogs/dawnlight-3.1.catalog.json` is packaged with the extension;
- [x] bundled Catalog loading reports `source`, path, hash and hash validity;
- [x] Language Server exposes `dawnlight/catalogSnapshot`;
- [x] Catalog loading does not require a workspace or C# Analyzer;
- [x] existing V2 and MVP tests remain in the unit test command.

## Verification

```text
npm test
```

The V2-7 tests verify contract hashing, duplicate rejection, bundled loading and
the LSP request response. The bundled snapshot contains no guessed production
IDs; it supplies only the official host/format baseline until the engine Catalog
export is available.

## Deferred

- [ ] external Catalog discovery and configuration;
- [ ] Catalog ID/version completion, Hover and virtual Definition;
- [ ] Catalog compatibility diagnostics (`DLCAT`);
- [ ] C# Analyzer Catalog export parity.
