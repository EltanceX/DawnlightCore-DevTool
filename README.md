# Dawnlight Shader Pack Tools

Declarative VS Code authoring support for Dawnlight shader-pack JSON and JSONC files.

## Current scope

Version `0.1.0` provides local JSON Schema validation, field/value completion, hover descriptions and authoring snippets for:

- `shaderpack.json`;
- `manifest/options/*.json`;
- `manifest/resources/*.json`;
- `manifest/passes/*.json`;
- `manifest/programs/*.json`;
- `manifest/ui/settings.json`.

The packaged extension requires VS Code `1.90` or newer.

The V2-3 development milestone adds a pack-local Symbol/Reference Index. The bundled Language Server now indexes manifest definitions, Settings UI symbols, ID references, shader/asset paths, duplicate IDs, and per-pack immutable snapshots while retaining unsaved JSONC overlays.

Dynamic completion, Catalog IDs, cross-file navigation, shader code and production runtime diagnostics remain planned work beginning with V2-4.

## Local development

```powershell
npm install
npm run package
```

The generated VSIX can be installed from VS Code with **Extensions: Install from VSIX...**.

For a clean-profile command-line install during local acceptance testing:

```powershell
code --user-data-dir .vscode-acceptance-user `
  --extensions-dir .vscode-acceptance-extensions `
  --install-extension .\dawnlight-shader-pack-tools-0.1.0.vsix --force
```

The extension remains offline: the VSIX contains schemas, snippets and bundled
client/server JavaScript and does not fetch runtime resources. In a workspace
containing `shaderpack.json`, it starts the bundled Language Server process and
stops it when the extension deactivates.

Run the local checks with:

```powershell
npm test
npm run test:vscode
```

`npm test` builds the TypeScript projects and bundles, runs the original Schema
regression suite, and exercises the Language Server as an independent stdio
process, including JSONC overlays and composition. `npm run typecheck` performs
a strict TypeScript project build.

`test:vscode` is skipped by default. To run the real VS Code smoke test, set
`DAWNLIGHT_RUN_VSCODE_TEST=1` and optionally `DAWNLIGHT_VSCODE_PATH` to the
VS Code `code` executable.

To validate the packaged VSIX itself in an isolated profile, run
`npm run package` followed by `DAWNLIGHT_RUN_VSIX_TEST=1 npm run test:vsix`.

## Pack layout

The first version uses static VS Code file matching. The recommended layout is:

```text
MyPack/
  shaderpack.json
  manifest/
    options/*.json
    resources/*.json
    passes/*.json
    programs/*.json
    ui/settings.json
```

Fragments and Settings UI files stored elsewhere receive their Schema automatically when their normalized pack-relative paths are explicitly listed by `shaderpack.json`. Unreferenced JSON files remain ordinary JSON, even when they are located inside a shader pack.
