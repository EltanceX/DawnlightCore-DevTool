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

The MVP does not resolve pack-local IDs, Catalog IDs, cross-file references, shader code or production runtime diagnostics. Those capabilities are planned for a later language-server version.

## Local development

```powershell
npm install
npm run package
```

The generated VSIX can be installed from VS Code with **Extensions: Install from VSIX...**.

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
