# V3-0：生产 Catalog 与 Analyzer parity 验收记录

日期：2026-08-18  
范围：Catalog source-registration v1、生产引擎导出器、生产 Analyzer
sidecar、Analyzer `getCatalog` 边界和 Language Server parity 状态。

## 1. 本次交付

### 1.1 统一 Catalog source contract

- 新增 `schemas/dawnlight-catalog-source-registration-v1.schema.json`；
- Snapshot/source 的嵌套 host、formats、registration、reference 字段采用严格
  未知字段校验，格式版本重复项也会被拒绝，避免未知字段被重新 hash 后静默接受；
- 固定 `sourceContractVersion: 1`、host/version/build、三类文件格式、六类
  registration 集合和 limits；
- exporter 拒绝未知字段、重复 `id@version`、非法版本、缺失 semantic
  `valueKind`；
- 依赖支持 `{ id, version }` 与 `id@version` 两种输入，导出时归一化、排序，
  空依赖集合不写入 Snapshot；
- 输出 Snapshot 的 canonical hash 始终由共享 Node contract 计算，避免 C#
  和 TypeScript 各自实现 hash 漂移。

### 1.2 引擎生产 exporter

外部引擎仓库新增：

```text
tools/ShaderPackCatalogExporter/
  ShaderPackCatalogExporter.csproj
  Program.cs
  README.md
```

exporter 直接读取运行时注册表：

| 集合 | 运行时来源 |
| --- | --- |
| stageTemplates | `BuiltInPipelineCatalogs.StageTemplates` |
| services | `BuiltInPipelineCatalogs.Services` |
| semantics | `BuiltInPipelineCatalogs.SemanticProviders` |
| engineDrawProviders | `BuiltInPipelineCatalogs.EngineDrawProviders` |
| capabilities | `BuiltInShaderPackCapabilities.Catalog` |
| resourceFormats | `TextureFormatCatalog.Formats` |

已在 .NET 10 Release 配置构建通过，实际导出计数为：7 / 7 / 34 / 14 / 2 / 9。
`--metadata` 只补充 presentation 字段，不改变运行时 ID 来源。

### 1.3 Analyzer parity

冻结并实现：

- `dawnlight/getCatalog` Analyzer contract；
- `clientSupportedVersions`、`expectedCatalogHash`、selected/server versions；
- Snapshot canonical hash、result hash、contract version 校验；
- 旧 sidecar 的 `-32601` 降级为 `unavailable`，不影响 `validatePack`；
- `dawnlight/analyzerCatalog` LSP 请求和 VS Code 命令；
- `match`、`mismatch`、`incompatible`、`invalid`、`unavailable`、
  `not-requested` 六种状态；
- mismatch 不替换本地 Catalog，并写入明确的 Language Server warning。
- 未配置 Analyzer 时 parity 状态明确为 `unavailable`；并发 Catalog/validate 请求
  复用同一个 sidecar 进程，不会重复启动。

`dawnlight/catalogSnapshot` 仍以本地 bundled/external Catalog 为权威，只附带
最近一次 Analyzer parity 状态。

### 1.4 生产 Analyzer sidecar

外部引擎仓库新增：

```text
tools/ShaderPackAnalyzer/
  ShaderPackAnalyzer.csproj
  Program.cs
  README.md
```

sidecar 复用生产 `ShaderPackManifestLoader`，提供：

- `dawnlight/initialize`、`dawnlight/getCatalog`、`dawnlight/validatePack`、
  `dawnlight/shutdown`；
- stdio `Content-Length` framing，stdout 只输出 JSON-RPC；
- `--catalog`/`DAWNLIGHT_CATALOG_PATH` 读取 Snapshot 或 source-registration，
  未提供时直接从运行时注册表生成 Catalog；
- 保存请求中的 overlays 复制到一次性临时 pack，拒绝绝对路径、越界路径和
  reparse/symlink 路径，不修改原始 pack；
- loader 错误映射为稳定 `DLMAN####`、pack-relative file 和 RFC 6901 pointer，
  并回传 `manifestHash`、`requestVersion`、`catalogHash`。

生产 sidecar commit：`95fa0007 Add production ShaderPack Analyzer sidecar`。

## 2. 验收结果

在扩展仓库执行：

```text
npm run typecheck       PASS
npm test                PASS (86 tests)
npm run lint            PASS
npm run catalog:validate PASS
npm run test:engine-analyzer PASS
git diff --check        PASS
```

Analyzer 专项覆盖：

- stdio Content-Length framing；
- valid Catalog match；
- valid but incompatible negotiation；
- valid alternate hash mismatch；
- malformed/hash-invalid response；
- old sidecar unknown method；
- timeout/crash 后继续保持本地诊断可用。

引擎 exporter 验收：

```text
dotnet build tools/ShaderPackCatalogExporter/ShaderPackCatalogExporter.csproj -c Release PASS
catalog-tool parity <generated-source> catalogs/dawnlight-3.1.catalog.json PASS
```

生产 Analyzer 验收：

```text
dotnet build tools/ShaderPackAnalyzer/ShaderPackAnalyzer.csproj -c Release PASS
dotnet run --project tools/ShaderPackAnalyzer -c Release -- --self-test PASS
runtime/source getCatalog hash 与 TypeScript contract 一致 PASS
真实 Dawnlight_v3.1 validatePack PASS
overlay invalid Manifest 返回 DLMAN0001 + /manifestVersion PASS
```

端到端验收入口：

```powershell
$env:DAWNLIGHT_ENGINE_REPO = 'E:\sc\2.4 Rebuild\1.81-3\SurvivalcraftApi Dawnlight'
npm run test:engine-analyzer
```

脚本会构建生产 sidecar（可用 `DAWNLIGHT_SKIP_ENGINE_BUILD=1` 跳过），通过真实
Language Server client 完成 Catalog parity、Dawnlight_v3.1 valid pack 与 invalid
overlay 三段验证。

对应生成物保存在
`fixtures/catalog/dawnlight-3.1.engine-source-registration.json`，由 V3 parity
测试作为 golden 输入验证。

## 3. 尚未宣称完成的范围

V3-0 的生产边界已经完成，但以下增强项仍不提前算作完成：

- 真实引擎 Analyzer 的全部 DLMAN 规则、JSON Pointer golden fixture 全量覆盖；
- runtime Catalog 自动带 presentation metadata 的发布流水线（当前可通过
  `--catalog` 或 source metadata 注入）；
- `dumpGraph`、`explainVariant`、shader source semantic index；
- Catalog/configuration live reload。

下一步应在保持本合同、hash 和 DLMAN 基础诊断不变的前提下，冻结
`dumpGraph`/`explainVariant`，进入 V3-1 graph contract。
