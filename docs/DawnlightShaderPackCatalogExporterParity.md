# Catalog Exporter 与 Analyzer Parity（V3-0）

V3-0 的第一步冻结了一个与 Language Server `CatalogSnapshot v1` 解耦的
`source-registration v1` 输入合同。生产引擎、Mod 注册器或 Analyzer exporter
只需要输出注册数据；Node 工具负责规范化、生成 canonical hash、转换为
`CatalogSnapshot v1`，并与 bundled/external snapshot 做 parity diff。

## Source registration v1

最小结构：

```json
{
  "sourceContractVersion": 1,
  "host": {
    "id": "dawnlight",
    "displayName": "Dawnlight",
    "version": "3.1",
    "build": "<engine-build>"
  },
  "supportedFormats": {
    "manifest": [3],
    "sourceComposition": [1],
    "settingsUi": [1]
  },
  "registrations": {
    "stageTemplates": [],
    "services": [],
    "semantics": [],
    "engineDrawProviders": [],
    "capabilities": [],
    "resourceFormats": []
  },
  "limits": {}
}
```

每个 registration 至少包含 `id` 和非负整数 `version`；Semantic 必须包含
`valueKind`。依赖可写成规范化字符串（例如 `dawnlight:point_lights@1`）或
`{ "id": "...", "version": 1 }`，导出时统一为字符串并排序。重复的
`id@version`、未知字段、非法版本和缺失必需字段都会使导出失败。

## CLI

```powershell
# source-registration -> Catalog Snapshot v1
node tools/catalog/catalog-tool.cjs export engine-catalog.json catalogs/generated.catalog.json

# 验证 Snapshot 的结构和 canonical hash
node tools/catalog/catalog-tool.cjs validate catalogs/generated.catalog.json

# 与现有 bundled snapshot 做逐项 parity
node tools/catalog/catalog-tool.cjs parity engine-catalog.json catalogs/dawnlight-3.1.catalog.json
```

`parity` 会比较 host、supported formats、limits 和六类注册集合，报告缺失、
新增或内容变化的 `path`，同时再次验证双方 hash。它不把 description 的缺失
静默当成相等，也不会因为数组顺序不同产生噪声。

## 当前引擎接入边界

引擎侧 exporter 已落在外部 Survivalcraft 仓库：
`tools/ShaderPackCatalogExporter/ShaderPackCatalogExporter.csproj`。它直接读取
`BuiltInPipelineCatalogs.StageTemplates/Services/SemanticProviders/EngineDrawProviders`、
`BuiltInShaderPackCapabilities.Catalog` 和 `TextureFormatCatalog.Formats`，不会从
手工复制的 ID 列表生成生产数据。`--version`、`--build` 会写入 host 元数据，
`--metadata` 可注入作者可读的 description/since/deprecated 字段。

```powershell
dotnet run --project tools/ShaderPackCatalogExporter -c Release -- `
  --metadata E:\Projects\vscode\dawnlight-core\catalogs\dawnlight-3.1.catalog.json `
  --output artifacts/catalog-source-v1.json --version 3.1 --build <engine-build>
node E:\Projects\vscode\dawnlight-core\tools\catalog\catalog-tool.cjs `
  parity artifacts/catalog-source-v1.json `
  E:\Projects\vscode\dawnlight-core\catalogs\dawnlight-3.1.catalog.json
```

当前生成结果已固化为
`fixtures/catalog/dawnlight-3.1.engine-source-registration.json`，并由
`test/v3/catalog-parity.test.cjs` 做 strict parity golden test。没有 metadata
时仍会生成合法 source-registration；parity 会明确列出缺失的 presentation
字段，而不会静默把它们当作相等。

## Analyzer getCatalog

V3-0 同时冻结 `dawnlight/getCatalog`：

- 客户端传递 `clientSupportedVersions` 和可选 `expectedCatalogHash`；
- Analyzer 返回完整 Snapshot、`catalogHash`、协商版本和 `compatible`；
- Language Server 校验 Snapshot canonical hash、`catalogHash` 与 contract version；
- 旧 sidecar 的 `-32601 Method not found` 视为能力降级，不会使 Analyzer 离线；
- hash/contract 不匹配不会替换本地 Catalog，调用方可显示 mismatch 状态；
- `dawnlight/analyzerCatalog` 请求返回 `not-requested`、`unavailable`、
  `match`、`mismatch`、`incompatible` 或 `invalid` 状态。

这样可以先让作者检查“编辑器 Catalog 与引擎 Catalog 是否一致”，再进入
V3-1 graph/variant 语义；任何 mismatch 都不能静默继续使用旧数据。

## 生产 Analyzer sidecar

外部引擎仓库的
`tools/ShaderPackAnalyzer/ShaderPackAnalyzer.csproj` 是当前 V3-0 的生产协议
实现。它复用 `ShaderPackManifestLoader`，而不是在 sidecar 中复制一份 Manifest
parser：

```powershell
dotnet build tools/ShaderPackAnalyzer/ShaderPackAnalyzer.csproj -c Release
dotnet run --project tools/ShaderPackAnalyzer -c Release -- --self-test
```

`--catalog FILE` 或 `DAWNLIGHT_CATALOG_PATH` 可载入 Snapshot 或
source-registration；不提供时则从引擎运行时注册表生成 Snapshot。若需要与
作者 bundled Snapshot 做完整 presentation parity，先用 Catalog exporter 的
`--metadata` 生成 source-registration，再通过 `--catalog` 注入 sidecar。没有
metadata 的 runtime Catalog 仍然是合法且可 hash 的权威注册集合，但会明确报告
presentation 字段差异。

`validatePack` 的 overlays 在临时目录中 materialize，原始 pack 不会被写入；
路径越界、绝对路径、重复 overlay 和 reparse/symlink 会被拒绝。loader fatal
errors 映射到 `DLMAN####`，并尽可能转换为 pack-relative 文件和 RFC 6901 pointer。
复杂 graph/hazard、shader 编译和完整结构化 golden diagnostics 进入 V3-1/V3-2。
