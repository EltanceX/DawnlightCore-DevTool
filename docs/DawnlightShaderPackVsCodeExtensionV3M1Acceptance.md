# V3-1：运行时 Graph 与 Variant Explain 验收记录

日期：2026-08-18
状态：V3-1 发布级验收完成（0.2.0 主线）
范围：Runtime Graph/Variant Explain v1 contract、生产 Analyzer resolver、Language
Server 编排、VS Code 只读视图、graph diagnostics 与 runtime navigation。

## 1. 本次交付

### 1.1 独立版本合同

V3-1 冻结两个独立合同，均不能与 VSIX、Language Server protocol、Analyzer
protocol 或 Catalog Snapshot 版本混用：

| 合同 | 版本 | Analyzer 方法 |
| --- | ---: | --- |
| Runtime Graph Snapshot | 1 | `dawnlight/dumpGraph` |
| Program Variant Explanation | 1 | `dawnlight/explainVariant` |

TypeScript contract、严格 parser 与 JSON Schema 位于：

```text
packages/contracts/src/analyzerRuntime.ts
schemas/dawnlight-runtime-graph-v1.schema.json
schemas/dawnlight-variant-explain-v1.schema.json
```

合同边界包括：

- `clientSupportedVersions`/`serverSupportedVersions`/`selectedVersion` 协商；
- `compatible` 与 `success` 分离，能区分版本不兼容和 pack domain failure；
- `requestVersion`、`catalogHash`、`manifestHash` 和 contract payload 一致性；
- pack-relative overlay/provenance/source/include 路径与 RFC 6901 pointer；
- graph node/edge/event/resource/binding/draw-buffer 引用完整性；
- 稳定 `DLMAN####`/`DLGRAPH####` code、重复 ID/字段和未知字段拒绝；
- graph canonical JSON SHA-256，省略 `graphHash` 后排序对象 key、保留数组顺序。

合同的完整字段和 canonical 规则见
`docs/DawnlightShaderPackRuntimeGraphVariantContractV3M1.md`。

### 1.2 生产 Analyzer runtime resolver

外部 Survivalcraft 仓库的 `tools/ShaderPackAnalyzer` 增加 graph protocol 和 runtime
analysis。它复用生产加载/解析链，而不是在编辑器或 sidecar 中维护另一套简化图：

```text
ShaderPackConfigurationResolver
ShaderPackRuntimePlanResolver
ResolvedPipelineFactoryServicePlanResolver
PipelineStageExecutionScopePlanResolver
PipelineResourceAccessGraphBuilder
ShaderPackCandidateResourceSetResolver
```

生产结果覆盖 active/inactive closure、执行顺序、program/pass/resource 节点、访问
事件、resource lifetime、binding、draw buffer、依赖/访问边、hazard provenance、
resolved option/capability inputs、program sources、projected defines 和 variant
fingerprint。

stdio 仍使用 `Content-Length` JSON-RPC framing。运行时请求支持标准
`$/cancelRequest`；生产解析阶段之间检查 cancellation token，请求响应写入保持串行，
并发请求复用同一个 sidecar 进程。unsaved overlays 仍通过 V3-0 的安全临时 pack
边界进入 production loader，不修改原始 pack。

### 1.3 Analyzer client 与 Language Server 编排

`DawnlightAnalyzerClient` 增加两个强类型方法，并在边界再次解析请求/响应。请求
取消会发送 `$/cancelRequest`；method-not-found、malformed payload、timeout、EOF
和进程崩溃按照既有 restart/offline 策略降级，不会让 VS Code Language Server
退出。

Language Server 在发起 runtime analysis 前完成以下检查：

1. 等待最新 workspace discovery、composition 和 symbol index generation；
2. 从 active document/packRoot 解析唯一 pack；
3. 要求 Analyzer Catalog 与当前 bundled/external Catalog hash 为 `match`；
4. 以稳定顺序转发 pack-local overlays 与 option/capability inputs；
5. 同时记录 request generation、Analyzer process epoch、Catalog hash 和精确输入
   fingerprint；任何一个发生变化都丢弃旧响应；
6. 只缓存已通过 contract parser 的成功结果。

缓存是进程内有界 LRU（当前最多 64 个 immutable snapshot）。fingerprint 包含
pack root、Catalog hash、operation/program selector、inputs 以及每个 composition
document 的路径、来源、版本和文本 SHA-256。文件/overlay、workspace、pack 或
Analyzer process 变化会使对应快照失效；旧 URI 随后返回 `null`，不会伪装成最新
graph。

### 1.4 VS Code 作者体验

新增命令：

```text
Dawnlight: Open Runtime Graph
Dawnlight: Explain Program Variant
```

命令从 active JSON/JSONC 文档和光标位置构造请求。variant 无法从位置唯一确定时，
Language Server 返回 pack-local program candidates，扩展使用 Quick Pick 选择后再
发起 explain 请求。

成功结果以 readonly Markdown 虚拟文档打开：

- `dawnlight-graph:`：hash、执行顺序、节点、resources/lifetimes、events、bindings、
  draw buffers、edges、hazards、diagnostics、canonical JSON 和 DOT；
- `dawnlight-variant:`：program/kind/active state、compile mode、fingerprint、source
  stages、resolved inputs、defines、includes、graph node IDs、diagnostics 和 canonical
  JSON。

provenance/source file 使用 pack-local `file:` 链接。Graph 节点拥有稳定 declared ID
时，Manifest 中 pass/program/resource 的 Definition 会保留原有 pack-local 位置并
追加 `dawnlight-graph:` 位置；Hover 追加最新 graph 的 node kind、active state、
execution order、edge/event/hazard 摘要和 graph hash。

### 1.5 独立诊断所有权

Graph response diagnostics 与 hazards 映射到 Problems 时使用独立 source：

```text
dawnlight-analyzer-graph
```

provenance pointer 通过现有 JSONC AST 映射精确 range，并可携带 related
information。只有成功或合同兼容的 graph domain result 更新这一诊断 owner；
variant view 不会清空最近 graph hazards。取消、stale、Catalog mismatch、transport
error 或 malformed result 只返回当前请求的消息，不清空：

- Schema/JSONC diagnostics；
- `dawnlight-fast` L0-L2 diagnostics；
- 保存后 `dawnlight-analyzer` 权威诊断；
- 其他 pack 的 graph diagnostics。

## 2. 当前自动化证据

以下定向命令已经执行并通过：

```powershell
npm run build
node --test --test-timeout=15000 `
  test/v3/runtime-contracts.test.cjs `
  test/v3/runtime-analysis.test.cjs
```

结果：`7 passed, 0 failed`。

其中 4 个 contract/Schema 测试覆盖：

- 独立版本常量和 Analyzer/LSP method 注册；
- request/result negotiation、domain failure 与 stale-safe envelope；
- graph hash、悬空引用、重复 ID、provenance、路径安全和未知字段；
- variant inputs/defines 来源、inactive 约束与 JSON Schema 边界。

3 个 Analyzer client/LSP/cache 集成测试覆盖：

- framed sidecar graph/variant 请求、严格解析、取消和 client 可继续使用；
- graph/variant immutable URI、Markdown/JSON/DOT 内容、program candidates、graph
  hazard source、Definition/Hover graph 导航、overlay 变更后 URI 失效。
- 有界 LRU 快照缓存的命中、淘汰和不可变 URI 边界。

这些是 V3-1 定向证据，不替代下面的完整发布级矩阵。

## 3. 发布级最终验收矩阵

主线合并生产 sidecar 后已执行下列命令；结果、测试总数、产物大小和必要的
commit 已记录如下。

| 验收项 | 命令 | 最终结果 |
| --- | --- | --- |
| 全量单元/LSP | `npm test` | 通过，93/93 |
| 静态检查 | `npm run lint` | 通过，28 个 CommonJS、50 个 JSON |
| 性能门槛 | `$env:DAWNLIGHT_BENCHMARK_STRICT='1'; npm run benchmark` | 通过；fingerprint p95 0.3 ms、Graph render p95 5.4 ms、Variant render p95 0.6 ms、cache get p95 <0.001 ms |
| 生产 Analyzer | `$env:DAWNLIGHT_ENGINE_REPO='<engine>'; npm run test:engine-analyzer` | 通过；sidecar commit `8803a507`，真实 Dawnlight_v3.1，Catalog `b5898125…`、graph `e4bcf778…`、variant `79cee6c9…` |
| VSIX 构建 | `npm run package` | 通过；`dawnlight-shader-pack-tools-0.2.0.vsix`，19 files，308.51 KB |
| 真实 VS Code | `$env:DAWNLIGHT_RUN_VSCODE_TEST='1'; npm run test:vscode` | 通过，exit 0 |
| 干净 profile VSIX | `$env:DAWNLIGHT_RUN_VSIX_TEST='1'; npm run test:vsix` | 通过，exit 0；测试进程退出时报告一个 Windows 临时 profile 锁定警告，不影响安装/验收 |
| diff 卫生 | `git diff --check` | 通过（提交前） |

生产 Analyzer Release build 输出 16 个既有 `NU1902`（NCalc）漏洞警告、0 个错误；
该警告不属于 V3-1 协议或运行时失败。

生产 Analyzer 验收至少必须确认：

- Release build 与 `--self-test` 通过；
- 同一个真实 Dawnlight v3.1 pack、相同 Catalog 与 inputs 连续两次产生相同
  `graphHash` 和 `variantFingerprint`；
- graph 至少包含 nodes、execution order 和 resources，所有引用通过 v1 parser；
- 已知 program 的 explanation 包含实际 source stage、input/define provenance；
- unsaved overlay 或 input 改变会产生新的 snapshot，旧响应不能覆盖新响应；
- Catalog mismatch、取消和 sidecar 故障不清空 L0-L2 或已保存 Analyzer 诊断。

## 4. 手工验收步骤

1. 构建生产 `ShaderPackAnalyzer`，在 VS Code 中设置
   `dawnlight.shaderPack.analyzer.path` 并打开 Dawnlight v3.1 workspace；
2. 执行 **Dawnlight: Refresh Analyzer Catalog**，确认状态为 `match`；
3. 在 `shaderpack.json` 或 fragment 中执行 **Dawnlight: Open Runtime Graph**，确认
   Markdown 的执行顺序、resource/binding/draw-buffer、JSON 和 DOT 均存在；
4. 在 program ID 上执行 **Dawnlight: Explain Program Variant**，或从 Quick Pick
   选择 program，确认 sources、inputs、defines、fingerprint 和 graph node IDs；
5. 从已生成 graph 对应的 pass/program/resource ID 请求 Definition/Hover，确认原始
   Manifest Definition 仍保留，并能打开 graph node/看到 runtime 摘要；
6. 制造一个可定位 graph hazard，确认 Problems source 为
   `dawnlight-analyzer-graph` 且 range/related information 指向正确 fragment；
7. 编辑未保存 overlay 后重新打开 graph，确认 URI/hash 更新且旧 URI 不再提供内容；
8. 故意造成 Catalog mismatch 或停止 sidecar，确认命令显示明确错误，同时普通
   completion、Definition、Hover、Rename 和 fast diagnostics 继续工作。

## 5. 已知边界与后续工作

- 当前视图是 readonly Markdown、canonical JSON 和 DOT；交互式 DAG/variant diff
  Webview 属于 V3-4；
- V3-1 只展示生产 Analyzer 已解析的 include 记录，不在 Language Server 中猜测
  shader include；完整 include/preprocessor/uniform/interface semantics 属于 V3-2；
- graph snapshot 是请求时快照，不是持续运行的引擎遥测；live Catalog/config
  reload 和状态/trace UX 属于 V3-3；
- runtime graph 必须通过 Catalog parity gate。Analyzer 离线或 mismatch 时不使用
  旧 snapshot 伪造当前结果；
- 当前 sidecar 的 `--catalog` snapshot/hash 用于协议协商和 presentation metadata，
  runtime resolver 的语义注册集合仍来自引擎编译期 registry；两者的统一 metadata
  parity pipeline 属于后续工作，不能把本地生成 hash 当作引擎注册表版本号；
- 当前 sidecar 仍采用开发时外部路径配置，self-contained/platform VSIX packaging
  属于 V3-5。

## 6. 完成判定

V3-1 功能实现、7 个定向测试和第 3 节完整矩阵均已完成。生产 Analyzer 的 graph
hash、contract parser、取消恢复、stale/diagnostic isolation 均有自动化证据；后续
若修改 resolver 或协议字段，应重新运行本矩阵，不得以“Analyzer 可选”为理由跳过。
