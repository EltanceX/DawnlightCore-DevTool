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

The fixtures exercise Schema shape and editor completion only. They are not production runtime validation cases.
