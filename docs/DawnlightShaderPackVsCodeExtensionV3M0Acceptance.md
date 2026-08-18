# V3-0：生产 Catalog 与 Analyzer parity 验收记录

日期：2026-08-18  
范围：Catalog source-registration v1、生产引擎导出器、Analyzer `getCatalog`
边界和 Language Server parity 状态。

## 1. 本次交付

### 1.1 统一 Catalog source contract

- 新增 `schemas/dawnlight-catalog-source-registration-v1.schema.json`；
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

`dawnlight/catalogSnapshot` 仍以本地 bundled/external Catalog 为权威，只附带
最近一次 Analyzer parity 状态。

## 2. 验收结果

在扩展仓库执行：

```text
npm run typecheck       PASS
npm test                PASS (83 tests)
npm run lint            PASS
npm run catalog:validate PASS
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

对应生成物保存在
`fixtures/catalog/dawnlight-3.1.engine-source-registration.json`，由 V3 parity
测试作为 golden 输入验证。

## 3. 尚未宣称完成的范围

这次是 V3-0 的 Catalog/parity slice，不把以下内容提前算作完成：

- 生产 C# `validatePack` Analyzer sidecar 本身（当前仍是 V2 的可选客户端边界
  和 fake/golden protocol tests）；
- 真实引擎 Analyzer 的 DLMAN 规则、JSON Pointer golden fixture 全量覆盖；
- `dumpGraph`、`explainVariant`、shader source semantic index；
- Catalog/configuration live reload。

下一步应在保持本合同和 hash 不变的前提下，接入生产 Analyzer 的
`initialize/getCatalog/validatePack`，再进入 V3-1 graph contract。
