# MVP Fixtures

These fixtures are intentionally small and do not contain shader sources or large texture assets.

## Valid fixtures

- `valid/minimal`: composed Manifest with one option, resource, graphics Program, fullscreen pass and settings UI.
- `valid/toonlab`: single-file Manifest with a small graphics pipeline.

## Invalid fixtures

- `invalid/wrong-type`: `manifestVersion` has the wrong JSON type.
- `invalid/unknown-property`: root contains an unsupported property.
- `invalid/invalid-enum`: resource `kind` uses an unsupported value.

The fixtures exercise Schema shape and editor completion only. They are not production runtime validation cases.
