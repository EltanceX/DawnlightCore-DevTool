# MVP Fixtures

These fixtures are intentionally small and do not contain shader sources or large texture assets.

## Valid fixtures

- `valid/minimal`: composed Manifest with one option, resource, graphics Program, fullscreen pass and settings UI.
- `valid/dawnlight-v3.1`: trimmed contract snapshot derived from the current Dawnlight v3.1 external pack.
- `valid/toonlab`: single-file Manifest with a small graphics pipeline.

## Invalid fixtures

- `invalid/wrong-type`: `manifestVersion` has the wrong JSON type.
- `invalid/unknown-property`: root contains an unsupported property.
- `invalid/invalid-enum`: resource `kind` uses an unsupported value.
- `invalid/missing-required`: root omits the required `version` property.

## Workspace fixtures

- `workspace/arbitrary-fragment-path`: a composed pack whose fragment and Settings UI files are deliberately outside the first-version static directory layout; it also contains an untracked JSON isolation case.

The valid/invalid fixtures exercise Schema shape and editor completion. Workspace fixtures exercise Language Server discovery and document-role association. They are not production runtime validation cases.
