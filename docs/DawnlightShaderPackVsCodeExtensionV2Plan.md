# Dawnlight Shader Pack VS Code Extension V2 Plan

状态：Proposed  
编写日期：2026-08-16  
目标版本：0.2.0  
第一版基线：0.1.0 / commit `8db352a`  
关联文档：

- [DawnlightShaderPackVsCodeExtensionImplementationPlan.md](DawnlightShaderPackVsCodeExtensionImplementationPlan.md)
- [DawnlightShaderPackVsCodeExtensionMvpPlan.md](DawnlightShaderPackVsCodeExtensionMvpPlan.md)
- [DawnlightShaderPackVsCodeExtensionMvp6Acceptance.md](DawnlightShaderPackVsCodeExtensionMvp6Acceptance.md)

## 1. 文档目的

本文规划 Dawnlight Shader Pack Tools 第二版的推荐功能、架构、实施顺序、测试策略和验收标准。

第一版已经完成基于 JSON Schema 和 snippets 的静态编辑支持，解决了字段、结构、固定 enum、局部诊断和基础模板问题。第二版的重点不再是继续扩充静态 Schema，而是让编辑器理解一个由 root Manifest、多个 fragment、Settings UI、shader 和 asset 共同组成的完整光影包。

第二版定位为：

> 从 declarative Schema-only VSIX 升级为具有工作区模型和跨文件语义能力的 Language Server 扩展。

第二版不以 GLSL 编译、渲染图 Webview 或游戏热重载为主要目标。这些能力必须建立在稳定的工作区模型、符号索引和 Analyzer 协议之上。

## 2. 第一版基线

当前 0.1.0 已具备：

- Manifest v3 root Schema；
- Manifest v3 fragment Schema；
- Settings UI v1 Schema；
- JSON 和 JSONC snippets；
- root、options、resources、programs、passes 和 Settings UI 静态路径关联；
- 固定属性、enum 和 Hover 补全；
- required/type/unknown property/enum 诊断；
- Minimal、Dawnlight v3.1、ToonLab 和负例 fixture；
- Ajv、JSON Language Service 和真实 VS Code/VSIX 验收测试；
- 可离线安装的 declarative VSIX。

第一版明确没有：

- 工作区光影包发现；
- 任意 fragment 路径识别；
- 跨文件 ID 索引；
- 动态 ID 和路径补全；
- 定义跳转、引用查找和重命名；
- Catalog Snapshot；
- C# 生产 Loader 权威诊断；
- GLSL 语义分析。

## 3. 第二版目标

### 3.1 核心目标

第二版推荐完成：

1. 自动发现一个工作区中的一个或多个光影包；
2. 按 `shaderpack.json` 的 `fragments`、`settings` 和 `shaderRoot` 建立文档关系；
3. 对 option、program、resource、pass 和 Settings UI 建立跨文件符号与引用索引；
4. 在 JSON/JSONC 中提供 pack-local ID 和安全路径动态补全；
5. 提供 Definition、References、Hover 和安全 Rename；
6. 提供确定性的跨文件快速诊断；
7. 定义并接入 Catalog Snapshot v1；
8. 为 C# Analyzer sidecar 建立稳定、可降级的协议边界；
9. 保留第一版 Schema/snippets 的离线和无 Analyzer 降级能力。

### 3.2 推荐版本拆分

第二版不应一次性实现所有工具能力，建议拆为：

| 版本 | 重点 |
|---|---|
| 0.2.0 | Language Server、工作区发现、符号索引、动态补全、导航和快速诊断 |
| 0.2.1 | Catalog Snapshot v1、Catalog completion、版本协商和 fallback |
| 0.2.2 | 可选 C# Analyzer sidecar、保存后权威诊断和结构化 Problems |
| 0.3.0+ | GLSL 语义、variant explain、Pipeline Graph、热重载 |

如果希望第二版只发布一次，也应按上述内部里程碑顺序开发和提交，不能同时并行构建不稳定的 LSP、Catalog 和 Analyzer。

## 4. 第二版非目标

0.2.x 暂不实现：

- 自研完整 GLSL parser/compiler；
- shader 编译成功性判断；
- Pipeline Graph Webview；
- 拖拽式管线编辑器；
- 游戏进程热重载；
- GPU 显存预算和资源 aliasing 可视化；
- 自动修改复杂 Hazard；
- 从 JSON 调用任意 C# 类、方法或 callback；
- 把 Dawnlight v3.1 当前 Catalog ID 硬编码到 Schema 或 TypeScript enum；
- 隐式注册未被 root Manifest 引用的 fragment。

## 5. 总体架构

推荐架构：

```text
VS Code Extension Client
  -> Language Client
      -> TypeScript Language Server
          -> JSON Schema Service
          -> Workspace Registry
          -> Pack Composition Model
          -> Symbol/Reference Index
          -> Catalog Snapshot
          -> optional C# Analyzer Client
              -> C# Shader Pack Analyzer
                  -> Production Compiler/Loader
```

### 5.1 分层权威边界

| 层 | 权威范围 | 允许残缺文档 | 主要结果 |
|---|---|---:|---|
| JSON Schema | JSON 结构和局部字段合同 | 是 | 属性/enum 补全、局部诊断、Hover |
| TypeScript Language Server | 工作区文档、组合关系、符号和引用 | 是 | 动态补全、导航、快速跨文件诊断 |
| Catalog Snapshot | 当前宿主公开 ABI | 不适用 | Service/Semantic/Provider/Stage/Capability 元数据 |
| C# Analyzer | 与生产 Loader 一致的完整组合语义 | 通常要求可组合输入 | 权威诊断、图、variant、资源计划 |

原则：

- Schema 不表达跨文件唯一性、Hazard 和活动闭包；
- Language Server 不重新实现全部 C# 生产 Loader；
- completion 和 Hover 不等待 Analyzer；
- Analyzer 离线时 LSP 必须继续提供 Schema、索引、补全和 L0-L2 诊断；
- Catalog 数据来自版本化 Snapshot，不来自 TypeScript 硬编码表。

## 6. 推荐仓库结构

```text
dawnlight-core/
  docs/
  fixtures/
    valid/
    invalid/
    completion/
    workspace/
  packages/
    contracts/
      schemas/
      src/
      test/
    language-server/
      src/
      test/
    vscode-extension/
      src/
      test/
    test-utils/
      src/
  schemas/
  snippets/
  package.json
  tsconfig.base.json
```

模块职责：

| 模块 | 职责 |
|---|---|
| `contracts` | Schema、协议类型、版本常量、diagnostic code 和 Catalog 类型 |
| `language-server` | 文档解析、项目发现、组合、索引、补全、导航和快速诊断 |
| `vscode-extension` | 激活、Language Client、配置、命令、状态栏、Output 和 sidecar 生命周期 |
| `test-utils` | fixture loader、光标标记、LSP harness、snapshot normalizer |

第一步迁移只移动文件和建立兼容导出，不改变现有 Schema URL、snippet prefix 和 0.1.0 行为。

## 7. 核心数据模型

### 7.1 Workspace Model

```text
WorkspaceRegistry
  -> ShaderPackProject[]

ShaderPackProject
  - projectId
  - rootUri
  - manifestDocument
  - fragmentDocuments[]
  - settingsDocument?
  - shaderRootUri?
  - documentGraph
  - symbolIndex
  - referenceIndex
  - catalogSnapshot?
  - projectGeneration
  - diagnosticGeneration
```

### 7.2 文档角色

```text
ManifestRoot
ManifestSingleFile
ManifestFragment
SettingsUi
ShaderSource
Asset
Unknown
```

### 7.3 符号种类

第二版 0.2.0 首批索引：

```text
Option
Program
Resource
Pass
Page
Group
Control
TranslationKey
ShaderFile
AssetFile
```

0.2.1 Catalog 符号：

```text
StageTemplate
Service
Semantic
EngineDrawProvider
Capability
ResourceFormat
```

每个符号至少保存：

- canonical ID；
- symbol kind；
- 所属 pack/project；
- definition URI；
- definition range 和 selection range；
- fragment 顺序和数组局部顺序；
- parsed summary；
- option/program/resource 等过滤所需的类型元数据；
- 来源是 pack、BuiltIn 还是 external Catalog。

## 8. 分阶段实现步骤

### V2-0：Contracts 和工程基础

任务：

1. 初始化 TypeScript workspace；
2. 创建 `contracts`、`language-server`、`vscode-extension` 和 `test-utils`；
3. 保留现有 declarative contribution；
4. 定义独立版本：Schema、LSP、Catalog、Analyzer；
5. 定义 diagnostic 基础类型和命名空间；
6. 建立 LSP 单元测试 harness；
7. 建立 0.1.0 行为回归测试，防止迁移破坏静态补全。

建议依赖：

```text
typescript
vscode-languageserver
vscode-languageserver-textdocument
vscode-languageclient
vscode-json-languageservice
jsonc-parser
```

诊断命名空间：

```text
DLJSONxxxx   JSON/JSONC syntax
DLSCHEMAxxxx JSON Schema
DLSYMBOLxxxx pack-local symbol/reference
DLPATHxxxx   pack-relative path
DLCATxxxx    Catalog
DLMANxxxx    production Manifest analyzer
DLGRAPHxxxx  graph/order/hazard
```

验收：

- Language Client/Server 能启动和关闭；
- 空工作区不会报错；
- 现有 Schema/snippets 测试继续通过；
- LSP 协议和合同版本独立于扩展版本。

### V2-1：Workspace Pack Discovery

任务：

1. 工作区启动时查找 `**/shaderpack.json`；
2. 打开文件时向上查找最近 pack root；
3. 默认排除 `.git`、`node_modules`、`bin` 和 `obj`；
4. 解析 root 中的 `fragments`、`settings` 和 `shaderRoot`；
5. 只跟踪 root 显式引用的 fragment/settings；
6. 支持同一 workspace 多 pack；
7. 检测文档归属歧义；
8. 监听创建、删除、重命名和修改；
9. 使用 pack-relative normalized path；
10. 不递归扫描 workspace 外路径。

必须处理：

- fragment 重复路径；
- self inclusion；
- 缺失文件；
- rooted/drive-qualified path；
- `.`、`..` 和空 segment；
- root 临时不可解析；
- build output 中的包副本与源码包隔离。

验收：

- 任意合法 fragment 路径可以自动使用 fragment Schema；
- `settings` 指向的文件可以自动使用 Settings UI Schema；
- 两个 pack 不会共享项目状态；
- root 修改 fragment 顺序后项目模型原子更新。

### V2-2：JSONC 容错文档与 Composition

任务：

1. 使用 `jsonc-parser` 保存 AST、node path 和精确 range；
2. 支持注释和尾随逗号；
3. 使用未保存文档内容覆盖磁盘内容；
4. 一个 fragment 临时语法错误时保留其他文档索引；
5. 按 root `fragments` 顺序组合 definitions；
6. 引用允许跨文件并指向后续 fragment；
7. 每个文档保存 LSP version；
8. 每个项目保存单调递增 generation；
9. 所有异步结果提交前校验 version/generation；
10. 取消过时的解析和索引任务。

验收：

- 未保存新增 option 可立即进入补全；
- fragment 临时缺少 `}` 时其他 ID 仍可补全；
- 旧 generation 的结果不能覆盖新状态；
- 关闭未保存文档后恢复磁盘版本。

### V2-3：Symbol/Reference Index

任务：

1. 索引 option、program、resource、pass 和 Settings UI 符号；
2. 索引 JSON path 上的引用种类；
3. 保存定义和引用 range；
4. 检测明确 duplicate ID；
5. 同一 project 内 canonical ID 唯一；
6. 多 pack 严格隔离；
7. 为 shader/asset 路径建立文件符号；
8. 使用 immutable snapshot 或原子替换索引；
9. 仅增量重建受影响项目；
10. 不自行声明生产 canonical hash。

验收：

- 当前 Dawnlight v3.1 初次索引目标小于 1 秒；
- 修改单个 fragment 后索引目标小于 300 ms；
- duplicate ID 有两个 definition range；
- option、resource、program、pass 引用数量准确。

### V2-4：动态 Completion

Schema completion 保留，Language Server 在确定的 AST path 上添加动态候选。

| JSON 位置 | 候选来源 | 过滤规则 |
|---|---|---|
| `fragments[]` | pack 内 JSON 文件 | 排除 root、自身、重复和越界路径 |
| `settings` | pack 内 JSON 文件 | 排除已作为 fragment 的文件 |
| Program shader path | `shaderRoot` 文件 | graphics/compute 和扩展名过滤 |
| define `option` | option index | 显示 type、default、impact |
| define `map` key | selected option | boolean/allowed 可枚举值 |
| pass `programs[]` | program index | 排除数组重复项 |
| command `program` | containing pass programs | fullscreen/present graphics，compute compute |
| binding `resource` | resource index | 按 sampler/image/buffer 和 access 过滤 |
| target `resource` | resource index | color/depth attachment 过滤 |
| copy source/destination | resource index | 排除自身，按 kind/aspect 过滤 |
| history commit resource | resource index | 仅 history lifetime |
| condition option | option index | 排除明显自引用 |
| condition value | selected option | 按 type/default/allowed 补全 |
| UI control option | option index | 标记或过滤重复引用 |
| UI widget | selected option | boolean/toggle，number/slider，allowed/choice |
| translation key | Settings translations | 按字段用途过滤 |

合并排序：

1. 当前 pack 类型匹配符号；
2. 当前 Catalog 精确版本；
3. BuiltIn fallback；
4. Schema 固定 enum；
5. snippets。

去重 key：

```text
label + kind + insertion range + insertText
```

验收：

- completion 断言 label、kind、detail、sortText、insertText 和 range；
- warm completion p95 小于 50 ms；
- completion 不等待 Analyzer；
- 多 pack 候选不串包；
- 不确定候选在 detail 中解释限制，而不是静默误删合法扩展。

### V2-5：Definition、References、Hover 和 Rename

任务：

1. option/program/resource/pass 定义跳转；
2. fragment/settings/shader/asset 路径跳转；
3. Find References 跨所有 fragment 和 Settings UI；
4. Hover 展示符号摘要和 definition fragment；
5. Rename 更新定义和所有确认引用；
6. Rename 结果使用 `WorkspaceEdit`；
7. duplicate、语法错误或不确定引用时拒绝 Rename；
8. 文件路径 Rename 只建议更新 JSON，不默认移动文件；
9. Catalog entry 后续跳转到虚拟只读文档；
10. Hover 不运行或等待 Analyzer。

验收：

- definition URI/range 精确；
- references 数量有 fixture snapshot；
- Rename 不修改其他 pack；
- Rename 可由 VS Code 预览和撤销；
- 不安全 Rename 返回清晰拒绝原因。

### V2-6：快速跨文件诊断

Language Server 即时诊断：

- fragment/settings/shader/asset 不存在；
- pack path 越界或格式非法；
- duplicate definition；
- unknown pack-local ID；
- Program kind 与 command type 不匹配；
- command program 未列入 containing pass；
- historyCommit 指向非 history resource；
- target/binding 的资源 kind 明确不兼容；
- UI control option unknown；
- UI widget 与 option type 不匹配；
- UI option 明确重复或遗漏；
- translation key 缺失；
- ordering self-reference；
- Catalog ID/version unknown（0.2.1）。

调度建议：

| 层级 | 触发 | debounce | 数据源 |
|---|---|---:|---|
| L0 syntax | 每次编辑 | 0-50 ms | jsonc-parser |
| L1 schema | 每次编辑 | 100-150 ms | JSON Language Service |
| L2 symbol | 相关文档变化 | 150-250 ms | workspace index |
| L3 authoritative | 保存/显式命令 | 750-1000 ms | optional C# Analyzer |

验收：

- 各诊断 source 独立发布，不互相清空；
- 新 generation 原子替换旧结果；
- stale 结果丢弃；
- 修改一个 fragment 只重算所属 pack；
- Analyzer Offline 时 L0-L2 不受影响。

## 9. Catalog Snapshot v1（0.2.1）

### 9.1 推荐数据结构

```json
{
  "contractVersion": 1,
  "host": {
    "id": "dawnlight",
    "displayName": "Dawnlight",
    "version": "3.1",
    "build": "<commit-or-build-id>"
  },
  "supportedFormats": {
    "manifest": [3],
    "sourceComposition": [1],
    "settingsUi": [1]
  },
  "stageTemplates": [],
  "services": [],
  "semantics": [],
  "engineDrawProviders": [],
  "capabilities": [],
  "resourceFormats": [],
  "limits": {},
  "hash": "<canonical-hash>"
}
```

### 9.2 要求

- Snapshot 只包含数据，不包含程序集、类型名或 callback；
- 排序确定；
- 具有 canonical hash；
- 同 ID 多版本分别列出；
- 支持第三方 Mod 增加条目；
- 导出数据和运行时验证使用同一个 Catalog 注册集合；
- 缺少说明时可降级展示 ID/version/value kind；
- 无 external Catalog 时使用 bundled official fallback；
- fallback 的来源和 hash 在 Output/Hover 中可见；
- Catalog 不可用时不能破坏 pack-local 补全。

### 9.3 Catalog completion

支持：

- Stage Template ID/version；
- Service ID/version；
- Semantic ID/version/value kind/required services；
- EngineDraw Provider ID/version；
- Capability ID/value kind；
- Resource format 和宿主限制。

禁止把这些 ID 固化到 Schema enum。

## 10. C# Analyzer Sidecar（0.2.2）

### 10.1 协议

推荐 JSON-RPC 2.0 over stdio，优先使用 `Content-Length` framing。

最低方法：

```text
dawnlight/initialize
dawnlight/getCatalog
dawnlight/validatePack
dawnlight/dumpGraph
dawnlight/explainVariant
dawnlight/shutdown
```

`validatePack` 输入至少包含：

```json
{
  "packRoot": "E:/shaderpacks/MyPack",
  "catalogHash": "...",
  "requestVersion": 37,
  "overlays": []
}
```

diagnostic 至少包含：

```json
{
  "severity": "error",
  "code": "DLMAN1024",
  "file": "manifest/passes/output.json",
  "pointer": "/passes/0/commands/2/program",
  "message": "Program 'example:missing' is not declared.",
  "related": []
}
```

### 10.2 协议要求

- diagnostic code 稳定；
- `file` 为 normalized pack-relative path；
- `pointer` 统一使用 RFC 6901 JSON Pointer；
- 返回原始 `requestVersion`；
- 支持 cancellation 和 timeout；
- stdout 只传协议，日志走 stderr；
- 限制消息和 overlay 总大小；
- 不传递或执行任意 C# 类型名/方法；
- Analyzer 崩溃后只自动重启有限次数；
- stale response 不发布；
- Analyzer 离线时保留 L0-L2 能力。

### 10.3 Overlay

协议从第一天保留未保存文档：

```json
{
  "path": "manifest/passes/output.json",
  "version": 18,
  "content": "{ ... }"
}
```

Compiler 最终通过 `IShaderPackSourceProvider` 读取：

1. overlay 优先；
2. 其他文件读取磁盘；
3. 所有路径继续受生产沙箱约束；
4. 不把未保存内容写回用户文件。

### 10.4 发布形态

开发阶段允许：

```powershell
dotnet run --project tools/ShaderPackAnalyzer
```

内部发布优先为 Windows x64 self-contained sidecar，使作者不需要安装 .NET SDK。VSIX 只包含当前平台所需 sidecar。

## 11. VS Code Client

### 11.1 激活

建议激活条件：

```json
{
  "activationEvents": [
    "workspaceContains:**/shaderpack.json",
    "onLanguage:json",
    "onLanguage:jsonc"
  ]
}
```

不要因为普通 JSON 文件无条件启动 Analyzer。Language Server 可以按 workspaceContains 激活，Analyzer 在首次权威验证或 Catalog 请求时懒启动。

### 11.2 推荐命令

```text
Dawnlight: Validate Shader Pack
Dawnlight: Rebuild Workspace Index
Dawnlight: Restart Language Server
Dawnlight: Restart Analyzer
Dawnlight: Show Output
Dawnlight: Open Catalog Entry
```

### 11.3 推荐配置

```text
dawnlight.shaderPack.workspace.exclude
dawnlight.shaderPack.validation.onSave
dawnlight.shaderPack.validation.debounceMs
dawnlight.shaderPack.catalog.path
dawnlight.shaderPack.analyzer.path
dawnlight.shaderPack.trace.server
```

默认值必须保持最少配置即可使用。外部 path 的来源必须在状态和日志中明确显示。

### 11.4 状态和降级

状态栏只显示需要用户注意的状态：

```text
Dawnlight: Ready
Dawnlight: Indexing
Dawnlight: Validating
Dawnlight: Analyzer Offline
Dawnlight: Catalog Mismatch
```

Output Channel 至少记录：

- pack 发现和移除；
- Schema/Catalog 来源和 hash；
- Analyzer 启停、重启和 stderr；
- validation generation 和耗时；
- trace 模式下的 LSP/Analyzer 细节。

## 12. 测试计划

### 12.1 Workspace Fixtures

新增：

```text
fixtures/workspace/
  single-pack/
  composed-pack/
  arbitrary-fragment-path/
  two-packs/
  nested-pack/
  missing-fragment/
  duplicate-id/
  unknown-reference/
  path-escape/
  malformed-overlay/
  catalog-version-mismatch/
  analyzer-offline/
```

### 12.2 Language Server 单元测试

覆盖：

- pack discovery；
- document role；
- fragment order；
- JSONC 容错；
- overlay 优先级；
- symbol/reference index；
- dynamic completion label/kind/detail/sortText/insertText/range；
- definition URI/range；
- references 数量；
- Rename WorkspaceEdit；
- path normalization/sandbox；
- duplicate/unknown/type mismatch diagnostics；
- 多 pack 隔离；
- stale generation；
- root/fragment 删除和重建；
- fragment 临时损坏时的稳定索引保留。

### 12.3 Catalog 合同测试

覆盖：

- Snapshot Schema；
- stable ordering/hash；
- 同 ID 多版本；
- third-party entry；
- external/bundled fallback；
- host/format version negotiation；
- unknown/deprecated entry；
- Catalog completion 类型过滤。

### 12.4 Analyzer 合同测试

覆盖：

- initialize/version negotiation；
- valid pack；
- invalid path；
- duplicate/unknown Catalog ID；
- graph Hazard；
- History 时序；
- overlay；
- cancellation；
- timeout/crash/EOF；
- stderr 不污染 stdout；
- requestVersion/stale response；
- source map file/pointer。

### 12.5 Parity 测试

同一 fixture 经过：

```text
JSON Schema
TypeScript fast diagnostics
C# production Analyzer
```

要求：

- 所有生产有效 fixture 通过 Schema；
- Schema 拒绝的确定结构错误不被生产 Loader 接受；
- TypeScript 不将合法动态 Catalog 条目标为硬错误；
- C# diagnostic code/file/pointer snapshot 稳定；
- 当前 Dawnlight v3.1、ToonLab 和 Minimal 无新增 error。

### 12.6 VS Code 集成测试

覆盖：

- workspaceContains 激活；
- Language Client/Server 启动和关闭；
- arbitrary fragment 自动关联 Schema；
- 动态 ID/path completion；
- Definition/References/Rename；
- Problems diagnostics；
- Validate 命令；
- Analyzer Offline 降级；
- workspace restart 后索引恢复；
- 干净 profile 安装 VSIX；
- 普通 JSON 不启动 Dawnlight 项目模型。

## 13. 性能目标

以当前 Dawnlight v3.1 规模为基准：

| 项目 | 目标 |
|---|---:|
| warm completion p95 | 50 ms 内 |
| 单文档 syntax/schema diagnostics | 250 ms 内 |
| 单 fragment 增量索引 | 300 ms 内 |
| 初次索引 Dawnlight v3.1 | 1 s 内，不含 Analyzer 冷启动 |
| 保存后 Analyzer warm response | 2 s 内 |
| 无编辑时 CPU | 接近 0，不轮询 |
| Analyzer 进程数 | 每个 VS Code window 最多 1 个 |

实现原则：

- 只解析变更文档；
- immutable snapshot + 原子替换；
- Catalog 按 hash 缓存；
- completion 不等待 Analyzer；
- watcher 只覆盖已发现 pack；
- 不在每次编辑时计算权威 canonical hash；
- 不在 Hover 中同步读取磁盘。

## 14. 安全和可靠性

### 14.1 文件系统

- 所有 pack path 统一规范化；
- 拒绝 rooted、drive-qualified、`.`、`..` 和空 segment；
- 不跟随 workspace 外路径递归扫描；
- symlink/reparse point 最终路径不能逃出 pack root；
- 插件不自动改写 Manifest/shader；
- Rename/Code Action 使用 `WorkspaceEdit`；
- 临时文件位于 extension storage，不写入 pack root。

### 14.2 并发

- 文档使用 LSP version；
- pack 使用 project generation；
- Analyzer 使用 requestVersion；
- 异步结果发布前同时验证当前 generation/version；
- workspace folder 删除后丢弃晚到结果；
- Extension deactivate 后停止发布 diagnostics。

### 14.3 Sidecar

- 使用进程 API 参数数组，不拼接 shell command；
- 不把 Manifest 字段解释成命令或程序集路径；
- 限制协议消息大小；
- 支持 timeout/cancel；
- 无效响应只使当前请求失败，不使 Extension Host 崩溃；
- Catalog 仅作为数据读取。

## 15. 推荐提交顺序

1. `Scaffold language server and contracts packages`
2. `Add workspace shader pack discovery`
3. `Add JSONC document overlays and composition model`
4. `Add pack symbol and reference indexes`
5. `Add dynamic path and ID completion`
6. `Add definition references hover and rename`
7. `Add fast cross-file diagnostics`
8. `Add Catalog Snapshot v1 contracts`
9. `Add bundled and external Catalog completion`
10. `Add optional analyzer JSON-RPC client`
11. `Add multi-pack overlay and stale-state tests`
12. `Package and accept extension 0.2.0`

每个提交必须保持第一版 Schema/snippets 回归测试通过。不要在同一提交中同时完成目录迁移、协议设计和大范围行为修改。

## 16. 0.2.0 验收清单

- [ ] 工作区可自动发现一个或多个光影包；
- [ ] root composition 可识别任意合法 fragment/settings 路径；
- [ ] JSONC 未保存内容参与项目模型；
- [ ] 单 fragment 临时语法错误不会清空整个 pack 索引；
- [ ] option/resource/program/pass 支持跨文件动态补全；
- [ ] shader/asset/fragment/settings 支持路径补全和跳转；
- [ ] 支持 pack-local Definition、References 和 Hover；
- [ ] 安全 Rename 可生成可预览/撤销的 WorkspaceEdit；
- [ ] duplicate、unknown reference、path escape 和类型不匹配有快速诊断；
- [ ] 多 pack 符号、引用和诊断严格隔离；
- [ ] completion 不等待 C# Analyzer；
- [ ] Analyzer 不存在时 Schema、补全、导航和 L0-L2 诊断可用；
- [ ] Catalog 可使用 bundled fallback 并显示来源/hash；
- [ ] Dawnlight v3.1 初次索引和 warm completion 达到性能目标；
- [ ] 现有 0.1.0 Schema、snippets 和普通 JSON 隔离测试无回归；
- [ ] VSIX 在干净 profile 安装并通过多 pack 集成测试。

## 17. 立即开始的推荐工作

下一阶段优先完成以下三个里程碑：

1. **V2-0 Contracts/Language Server scaffold**：建立 TypeScript workspace 和可启动的空 LSP；
2. **V2-1 Workspace Discovery**：从 `shaderpack.json` 建立多 pack 项目模型；
3. **V2-2/V2-3 Composition + Symbol Index**：让未保存 JSONC fragment 中的符号进入稳定索引。

在这三个里程碑完成前，不开始 Catalog exporter、C# Analyzer、GLSL parser 或 Webview。动态补全、导航和快速诊断必须共享同一份 Workspace/Symbol Model，避免为每个功能重复解析 Manifest。
