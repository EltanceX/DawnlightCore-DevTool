# Dawnlight Shader Pack Tools

Declarative VS Code authoring support for Dawnlight shader-pack JSON and JSONC files.

## MVP scope

Version `0.1.0` provides local JSON Schema validation, field/value completion, hover descriptions and authoring snippets for:

- `shaderpack.json`;
- `manifest/options/*.json`;
- `manifest/resources/*.json`;
- `manifest/passes/*.json`;
- `manifest/programs/*.json`;
- `manifest/ui/settings.json`.

The packaged extension requires VS Code `1.90` or newer.

The MVP does not resolve pack-local IDs, Catalog IDs, cross-file references, shader code or production runtime diagnostics. Those capabilities are planned for a later language-server version.

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

The extension is an offline declarative package: the VSIX contains the schemas
and snippets and does not fetch runtime resources or start a background server.

Run the local checks with:

```powershell
npm test
npm run test:vscode
```

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

Fragments stored elsewhere can still use the Schema manually through the workspace `json.schemas` setting. Dynamic fragment discovery is intentionally deferred to the language-server version.
