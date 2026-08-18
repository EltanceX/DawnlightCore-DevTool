# Dawnlight Shader Pack VS Code Extension V2 完成度与 V3 路线

更新日期：2026-08-17  
当前发布版本：`0.2.0`  
当前提交：`dd69d48 Document V3-0 Catalog parity acceptance`

## 1. 结论

仓库内 V2-0 至 V2-10 已全部完成，且已经合并到 `0.2.0` 发布线。V2 的目标是让 VS Code Language Server 建立稳定的 workspace/composition/symbol model，并在此之上提供动态补全、导航、快速诊断、Catalog authoring 和可选 Analyzer 边界；这些目标均有实现代码、单元/LSP 测试、验收文档和发布产物。

需要明确的边界是：V2-10 完成的是 C# Analyzer 的协议客户端、生命周期、overlay 转发和权威诊断接入；V3-0 进一步在外部 Survivalcraft 仓库加入了最小生产 C# Analyzer sidecar。shader-code 语义分析和 graph/variant 视图仍属于后续 V3 阶段，而不是 V2 未完成项。

## 2. V2 里程碑核对

| 里程碑 | 状态 | 已交付能力 | 主要证据 |
| --- | --- | --- | --- |
| V2-0 Contracts 和工程基础 | 已完成 | npm workspaces、TypeScript project references、协议/诊断 contract、最小 LSP、VS Code client 生命周期 | `49cf743`、`docs/*V2M0Acceptance.md`、`test/v2/contracts.test.cjs` |
| V2-1 Workspace Pack Discovery | 已完成 | 多 workspace root、多 pack/nested pack、路径规范化、引用归属、文件事件和 generation | `f0539b2`、`docs/*V2M1Acceptance.md`、`test/v2/workspace-discovery.test.cjs` |
| V2-2 JSONC 与 Composition | 已完成 | comments/trailing commas、AST ranges、磁盘/overlay 优先级、ordered composition、取消和 stale generation | `3c106e1`、`docs/*V2M2Acceptance.md`、`test/v2/composition.test.cjs` |
| V2-3 Symbol/Reference Index | 已完成 | pack-local symbols/references、duplicate、解析结果、增量重建和跨 pack 隔离 | `4b0700a`、`docs/*V2M3Acceptance.md`、`test/v2/symbol-index.test.cjs` |
| V2-4 动态 Completion | 已完成 | fragment/settings/shader/asset 路径、ID、类型过滤、精确 edit range、Catalog 接入前的动态候选 | `d3dd3bf`、`docs/*V2M4Acceptance.md`、`test/v2/dynamic-completion.test.cjs` |
| V2-5 Definition/References/Hover/Rename | 已完成 | pack-local 定义、引用、语义 Hover、安全 Rename、拒绝不安全编辑 | `846631e`、`docs/*V2M5Acceptance.md`、`test/v2/navigation.test.cjs` |
| V2-6 快速跨文件诊断 | 已完成 | JSONC/path/symbol/graph/schema source 隔离、generation-safe debounce、跨文件规则和多 pack 隔离 | `9ae8b18`、`docs/*V2M6Acceptance.md`、`test/v2/diagnostics.test.cjs` |
| V2-7 Catalog Snapshot v1 | 已完成 | contract、canonical hash、重复 ID/version 拒绝、bundled Dawnlight 3.1 fallback | `cb7473e`、`docs/*V2M7Acceptance.md`、`test/v2/catalog.test.cjs` |
| V2-8 Catalog authoring | 已完成 | 版本协商、external/bundled fallback、Catalog completion、Hover、readonly Definition | `ce79517`、`464df23`、`0e44524`、`docs/*V2M8Acceptance.md` |
| V2-9 Catalog diagnostics | 已完成 | unknown ID/version、deprecated、format/host、required Service、hash/negotiation failure diagnostics | `92c4cc6`、`dc09095`、`docs/*V2M9Acceptance.md`、`test/v2/catalog-diagnostics.test.cjs` |
| V2-10 Analyzer sidecar | 已完成（客户端边界） | JSON-RPC stdio、initialize/validate/shutdown、save 后权威诊断、overlay、pointer range、stale/timeout/crash 降级 | `c910f44`、`eecfabf`、`3be18e4`、`docs/*V2M10Acceptance.md`、`test/v2/analyzer.test.cjs` |
| V2-0.2.0 发布验收 | 已完成 | 版本统一、benchmark、VSIX 构建、真实 VS Code smoke、干净 profile 安装验收 | `420254b`、`docs/DawnlightShaderPackVsCodeExtensionV2Benchmark.md` |

## 3. 当前验收结果

最近一次本地验证（V3-0 parity slice）：

```text
npm test                         86 passed, 0 failed
npm run lint                     passed
DAWNLIGHT_BENCHMARK_STRICT=1 npm run benchmark  passed
npm run catalog:validate         passed
```

Benchmark 结果（临时合成 pack）：

| 指标 | 实测 | 目标 | 结果 |
| --- | ---: | ---: | --- |
| 初次 discovery/index | 约 26.7 ms | < 1000 ms | 通过 |
| 增量 fragment rebuild | 约 8.5 ms | < 300 ms | 通过 |
| warm completion p95 | 约 0.2 ms | < 50 ms | 通过 |
| fast diagnostics | 约 2.3 ms | < 250 ms | 通过 |
| Analyzer warm response | 约 0.2 ms | < 2000 ms | 通过 |

`0.2.0` VSIX 已生成并通过：

```text
dawnlight-shader-pack-tools-0.2.0.vsix
17 files, approximately 284 KB
```

真实 VS Code smoke 和 `DAWNLIGHT_RUN_VSIX_TEST=1 npm run test:vsix` 均已通过。Windows 上 VS Code 退出时偶尔留下锁定的临时 profile，这是测试清理警告，不影响 exit code 和安装验收结果。

## 4. V2 明确延期项

以下能力不是 V2 发布阻塞项，统一进入 V3：

- Survivalcraft 引擎侧生产 C# Analyzer 的完整规则、发布和全量 parity fixtures；
- 从引擎/Mod 注册集合自动导出 Catalog，并与 bundled snapshot 做 hash/registration parity；
- Catalog 文件和配置的 live reload；
- `dumpGraph`、`explainVariant` 的 Analyzer 请求及对应 LSP/虚拟文档（`getCatalog` 已在 V3-0 完成）；
- shader source 的 include、uniform、binding、stage interface 和 variant 语义分析；
- pass/resource graph Webview、变体解释视图和交互式修复；
- 平台自包含 sidecar、Marketplace 发布和跨平台 VSIX 矩阵。

## 5. V3 推荐目标

V3 的主题应从“理解 JSON pack”转向“理解引擎实际运行结果”。推荐版本目标仍保持小步可验收，每个阶段都复用 V2 的 snapshot、diagnostic source 和 Analyzer contract。

### V3-0：生产 Catalog 与 Analyzer parity（最高优先级）

先建立可信数据源，否则后续 graph 和 shader 诊断都会建立在手工 Catalog 上。

当前进度（2026-08-18）：Catalog source-registration v1、引擎侧生产 exporter、
Node canonical exporter/parity、生产 Analyzer sidecar、Analyzer `getCatalog` 和
LSP parity 状态已经完成 V3-0 基础闭环；完整 DLMAN 规则和 graph 解析仍是后续阶段。
详细验收见
`docs/DawnlightShaderPackVsCodeExtensionV3M0Acceptance.md`。

- 在 Survivalcraft/ShaderTest 侧实现 Catalog exporter，导出 host/version/build、formats、stage templates、services、semantics、draw providers、capabilities、resource formats 和 limits；
- 为 exporter 和 TypeScript `CatalogSnapshot` 建立 canonical hash 与 registration parity 测试；
- 实现 Analyzer sidecar 的 `getCatalog`，验证 catalog hash，不匹配时明确降级；
- 已接入 `validatePack` 的生产 loader、基础诊断 code、JSON Pointer 和安全 overlay；完整 DLMAN 规则与 golden snapshot 继续扩展；
- 明确 .NET runtime/self-contained、Windows x64 首发和 sidecar 路径发现策略。

验收重点：同一份真实 Dawnlight v3.1 pack 同时通过 engine Analyzer、TypeScript fast diagnostics 和 Catalog contract；Catalog 改变可被识别且不会静默使用旧数据。

### V3-1：运行时 graph 与变体解释（高优先级）

在 Analyzer 已可信后暴露真实执行图，而不是只根据 JSON 结构猜测。

- 完成 `dawnlight/dumpGraph` 和 `dawnlight/explainVariant` 的请求/响应 contract、超时、取消、stale 和缓存；
- 提供 `dawnlight-graph:`、`dawnlight-variant:` 只读虚拟文档；
- 展示 pass 顺序、resource lifetime、draw buffers、texture/buffer binding、stage/service 依赖、capability/define 选择；
- 将 Analyzer graph hazard 映射到 Problems、Definition、Hover 和相关位置；
- 允许从 pass/program/resource 跳到 graph 节点，并保留 pack-local 语义导航。

验收重点：对同一 pack 和 variant，graph 文档稳定、节点可跳转，Analyzer 错误只影响当前请求而不清空 L0-L2 诊断。

### V3-2：Shader source 语义与接口分析（高优先级）

V2 只理解 shader 文件路径，V3 应理解 shader 和 Manifest 之间的接口。

- 解析 GLSL/HLSL 方言的 include、uniform、sampler/image、buffer、attribute/varying、fragment outputs 和 compute local size；
- 建立 shader symbol index，并将程序 stage 与 shader source 关联；
- 校验 Manifest resource/binding 与 shader 声明的类型、格式、binding、location 和 stage interface；
- 解析 defines/variant 条件，报告未使用、缺失或冲突的 resources/capabilities；
- 对 shader 文件提供 Definition、References、Hover 和安全 Rename；
- parser 不可恢复时保留文本级和 JSON 级诊断，不阻塞其他 pack 功能。

验收重点：valid/invalid shader fixtures 的诊断 code、range 和关联 resource 稳定；大型 shader 文件的增量解析满足性能预算。

### V3-3：实时反馈、Code Action 与可运维性（中优先级）

把 V2 的“能发现问题”推进到“能快速修复和观察系统状态”。

- Catalog/configuration/file watcher live reload，显示来源、hash、generation 和 fallback reason；
- `Dawnlight: Rebuild Workspace Index`、`Restart Language Server`、`Show Output` 和 graph/variant 打开命令；
- 针对可确定问题提供 Code Action：补齐 version、替换 deprecated ID、添加缺失 Settings control、修复 pass ordering、创建缺失目录/fragment（默认仅预览）；
- 状态栏显示 Ready/Indexing/Validating/Analyzer Offline/Catalog Mismatch，并提供耗时和最近错误；
- 为 LSP 和 Analyzer 增加 trace 开关、结构化日志和诊断计数，不记录 shader 内容或路径之外的敏感数据。

验收重点：所有自动修复都有 WorkspaceEdit、预览和撤销；live reload 不产生 stale diagnostics；普通 JSON 仍不会启动完整 pack 模型。

### V3-4：Graph Webview 与作者工作流（中低优先级）

只有 V3-1 graph contract 稳定后再做可视化，避免 UI 先于运行时语义固化。

- pass/resource/program DAG 视图，支持按 stage、phase、resource lifetime 和 variant 过滤；
- 点击节点跳转 Definition，悬停显示 Catalog/Analyzer 元数据；
- graph hazard、未连接 output、资源生命周期冲突可直接定位到 JSONC/shader；
- variant 对比视图显示 defines、Catalog capability 和 graph 差异；
- Webview 与 Language Server 通过版本化 snapshot 通信，不直接读取文件或执行引擎代码。

### V3-5：发布与规模化（持续项）

- Windows x64 self-contained Analyzer 首发，随后补 Linux/macOS（若引擎工具链需要）；
- VSIX 平台依赖拆包、签名、Marketplace metadata、版本兼容矩阵和升级/回滚测试；
- 使用真实 Dawnlight v3.1、ToonLab、Minimal 和多 pack 大型 workspace 做性能基线；
- 增加 crash recovery、磁盘缓存、取消和长时间编辑 soak test；
- CI 固定运行 unit、real VS Code、VSIX、benchmark strict 和 Analyzer parity。

## 6. 推荐实施顺序

```text
V3-0 Catalog exporter + Analyzer parity
  -> V3-1 dumpGraph/explainVariant + graph diagnostics
  -> V3-2 shader source semantic index
  -> V3-3 live reload + Code Actions + status/trace
  -> V3-4 graph/variant Webview
  -> V3-5 sidecar/platform packaging + scale/CI hardening
```

V3 不建议一开始开发 Webview 或大规模 UI。先锁定真实 Catalog、Analyzer contract 和 parity fixtures，再扩展 graph、shader 语义和可视化；否则编辑器会重复实现一套与引擎运行时不一致的推断逻辑。

## 7. V3-0 完成定义

- [x] 真实引擎 Catalog exporter 生成合法、可复现的 source-registration，并由共享工具生成可 hash Snapshot；
- [x] bundled/external Catalog 与引擎注册集合通过 strict parity golden test；
- [x] Analyzer `getCatalog` contract、hash 校验、版本协商和明确降级状态已冻结；
- [x] 生产 Analyzer 可完成 initialize、getCatalog、validatePack，并返回稳定 DLMAN code/pointer；
- [x] 客户端 valid/invalid/overlay/stale/timeout/crash 与 parity fixture 通过；
- [x] `npm test`、VS Code smoke、VSIX acceptance 和 benchmark strict 在 sidecar 接入后再次锁定；
- [ ] V3-1 所需的 graph/variant contract 已冻结并有最小样例。
