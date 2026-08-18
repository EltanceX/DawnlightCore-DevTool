# Dawnlight Shader Pack VS Code Extension V2 完成度与 V3 路线

更新日期：2026-08-18
当前发布版本：`0.2.0`
当前里程碑：V3-1 功能实现完成，发布级最终验收进行中

## 1. 结论

仓库内 V2-0 至 V2-10 已全部完成，且已经合并到 `0.2.0` 发布线。V2 的目标是让 VS Code Language Server 建立稳定的 workspace/composition/symbol model，并在此之上提供动态补全、导航、快速诊断、Catalog authoring 和可选 Analyzer 边界；这些目标均有实现代码、单元/LSP 测试、验收文档和发布产物。

需要明确的边界是：V2-10 完成的是 C# Analyzer 的协议客户端、生命周期、overlay 转发和权威诊断接入；V3-0 在外部 Survivalcraft 仓库加入生产 C# Analyzer sidecar 与 Catalog parity，V3-1 再把生产 resolver 的 runtime graph 和 program variant 结果接入编辑器。shader-code include/interface 语义分析和交互式 Graph Webview 仍属于后续 V3 阶段，而不是 V2 未完成项。

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

V3-1 当前已通过 6 个 graph/variant 定向测试：4 个 contract/Schema 测试和 2 个 Analyzer client/LSP 集成测试。发布级 `npm test`、lint、benchmark、生产 sidecar、VS Code smoke、VSIX acceptance 的最终结果将在
`docs/DawnlightShaderPackVsCodeExtensionV3M1Acceptance.md` 由主线验收后登记；本节不沿用 V3-0 数值冒充 V3-1 结果。

## 4. V2 延期项在 V3 的状态

以下能力不是 V2 发布阻塞项，统一进入 V3：

- 已在 V3-0 完成从引擎/Mod 注册集合导出 Catalog、bundled snapshot 的 hash/registration parity 与生产 C# Analyzer 基础边界；
- 已在 V3-1 完成 `dumpGraph`、`explainVariant`、LSP 编排、虚拟文档、graph hazard 诊断和基础 graph 导航；
- Survivalcraft 引擎侧生产 C# Analyzer 的完整 DLMAN 规则、发布和全量 parity fixtures；
- Catalog 文件和配置的 live reload；
- shader source 的 include、uniform、binding、stage interface 和 variant 语义分析；
- pass/resource graph Webview、variant 对比和交互式修复；
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

当前进度（2026-08-18）：功能范围已经实现，最终发布级验收结果待主线填写。
Runtime Graph Snapshot v1 与 Program Variant Explanation v1 合同、生产 Analyzer
resolver、LSP/VS Code 命令和只读视图形成闭环。详细合同见
`docs/DawnlightShaderPackRuntimeGraphVariantContractV3M1.md`，验收记录见
`docs/DawnlightShaderPackVsCodeExtensionV3M1Acceptance.md`。

- `dawnlight/dumpGraph` 和 `dawnlight/explainVariant` 已实现严格请求/响应解析、独立版本协商、超时、标准取消、stale guard 和有界缓存；
- 请求必须先通过 Analyzer/Language Server Catalog hash parity；不匹配时明确拒绝生成可能错误的运行时视图；
- `Dawnlight: Open Runtime Graph` 和 `Dawnlight: Explain Program Variant` 打开 `dawnlight-graph:`、`dawnlight-variant:` 只读 Markdown；程序不唯一时通过 Quick Pick 选择；
- graph 文档展示执行顺序、节点、resource lifetime、events、draw buffers、texture/buffer binding、依赖边、hazards、canonical JSON 和 DOT；variant 文档展示 source、resolved options/capabilities、defines、includes、active/inactive reason 和 graph node links；
- Analyzer graph hazard 映射到独立 `dawnlight-analyzer-graph` Problems source，不覆盖 Schema、L0-L2 或保存后的 `dawnlight-analyzer` 诊断；
- pack-local pass/program/resource Definition 与 Hover 可附加最新 graph 节点状态和跳转，同时保留既有语义导航；
- overlay 文本、Catalog hash、输入参数、Analyzer process epoch 和 request generation 共同参与缓存/stale 判定，输入改变后旧虚拟 URI 不再返回内容。

验收重点：对同一 pack 和 variant，graph 文档稳定、节点可跳转，Analyzer 错误只影响当前请求而不清空 L0-L2 诊断。

V3-1 有意不实现交互式 Webview，也不在 TypeScript 侧重新解释 shader include。生产
Analyzer 尚未提供 shader include 语义时，variant 的 `includes` 可以为空；这不是拿路径
级信息猜测 include 关系，而是 V3-2 要补齐的明确合同边界。

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
V3-0 Catalog exporter + Analyzer parity                         [done]
  -> V3-1 dumpGraph/explainVariant + graph diagnostics         [implemented]
  -> V3-2 shader source semantic index                         [next]
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
- [x] V3-1 所需的 graph/variant contract 已冻结并有最小样例。

## 8. V3-1 完成定义

- [x] Runtime Graph 与 Variant Explain 使用相互独立的 v1 contract、严格 JSON Schema、版本协商和 domain-failure envelope；
- [x] 生产 Analyzer 通过实际 runtime resolver 输出执行节点、边、events、resources、bindings、draw buffers、hazards、variant inputs 和 defines，而不是由编辑器猜测；
- [x] Catalog parity gate、unsaved overlays、`$/cancelRequest`、timeout/crash 降级、request/process/input stale guards 和有界 immutable cache 已接入；
- [x] 两个 VS Code 命令、程序 Quick Pick、Markdown/JSON/DOT 虚拟文档和过期 URI 失效行为已接入；
- [x] graph hazard 独立诊断、Manifest Definition/graph Definition 合并和 runtime Hover 已接入，不清空 L0-L2/Schema/保存后 Analyzer 诊断；
- [x] 4 个 contract/Schema 与 2 个 Analyzer client/LSP 定向测试已通过；
- [ ] 完整 `npm test`、lint、benchmark strict、生产 sidecar、VS Code smoke、VSIX acceptance 结果待主线最终验收后写入 V3M1 验收文档。

因此 V3-1 的功能实现已完成；最后一项是发布级证据登记，不再扩张本里程碑的
功能范围。若最终矩阵发现回归，应修复后再把最后一项勾选，而不是把失败隐藏为
“Analyzer 可选”。

## 9. 下一步：V3-2 推荐切片

V3-2 应先建立可增量、可降级的 shader source semantic index，再增加跨 Manifest
诊断。推荐按以下顺序推进：

1. 冻结 shader 文件、include edge、declaration、stage interface 和 diagnostic 的
   contract/code namespace；同时选定 Dawnlight 实际 GLSL/HLSL 方言与预处理边界；
2. 实现 comments/string/preprocessor 安全的 include 与声明扫描器，建立文件级
   snapshot、依赖 DAG、cycle/missing include 诊断和内容 hash 缓存；
3. 将 program stage、resolved defines/variant inputs 与 shader snapshot 组合，逐步
   校验 uniform、sampler/image、buffer、fragment output、compute local size 和
   vertex/fragment interface；
4. 增加 shader Definition、References、Hover；Rename 仅在符号无歧义且宏展开不会
   改变含义时开放，否则明确拒绝；
5. 建立 valid/invalid/cycle/macro/overlay/large-file fixtures，并为 warm incremental
   parse、单文件失效范围和 Analyzer/TypeScript parity 设置性能与一致性门槛。

V3-2 第一批验收应优先覆盖 include DAG、program-to-source 关联和 Manifest
binding 对 shader declaration 的类型检查。复杂宏求值可作为后续小切片，但 parser
失败不得阻塞 JSON/JSONC、Catalog、graph 或其他 pack 的编辑能力。
