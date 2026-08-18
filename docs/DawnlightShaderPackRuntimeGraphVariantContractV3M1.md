# Dawnlight Runtime Graph 与 Variant Explain Contract（V3-1）

本文冻结 V3-1 的 Analyzer 数据合同。它只定义生产 Analyzer 与 Language
Server 之间的 JSON-RPC payload，不规定 VS Code 的 Webview、虚拟文档或具体
渲染方式。编辑器可以在 Analyzer 不可用时继续使用 V2 的 Schema、索引、补全和
L0-L2 诊断。

## 1. 方法和独立版本

V3-1 沿用 V2-10 已注册的方法名：

```text
dawnlight/dumpGraph
dawnlight/explainVariant
```

Graph 与 Variant Explain 是两个相互独立的合同版本：

| 合同 | 当前版本 | TypeScript 常量 |
| --- | ---: | --- |
| Runtime Graph Snapshot | 1 | `RUNTIME_GRAPH_CONTRACT_VERSION` |
| Program Variant Explanation | 1 | `VARIANT_EXPLAIN_CONTRACT_VERSION` |

它们不能与 VSIX 版本、Analyzer protocol 版本或 Catalog Snapshot 版本混用。
服务端支持列表分别通过 `DEFAULT_RUNTIME_GRAPH_VERSIONS` 和
`DEFAULT_VARIANT_EXPLAIN_VERSIONS` 表达。

## 2. 请求基类

两个方法都携带以下字段：

```json
{
  "packRoot": "E:/shaderpacks/Dawnlight_v3.1",
  "catalogHash": "<64 hex sha256>",
  "requestVersion": 42,
  "overlays": [],
  "clientSupportedVersions": [1],
  "expectedManifestHash": "<optional 64 hex sha256>",
  "inputs": {
    "options": {"dawnlight:volumetric": true},
    "capabilities": {"dawnlight:compute": true}
  }
}
```

`dumpGraph` 额外要求 `includeInactive: boolean`。`explainVariant` 额外要求
`programId: string`，并可选携带同名 `includeInactive` 以控制其 graph node links。
输入值只能是 string、finite number、boolean 或 null；
不能通过协议传递 C# 类型、表达式或可执行内容。

`requestVersion` 是客户端单调递增的请求世代，不是合同版本。客户端收到较旧
世代的响应时必须丢弃它，不得覆盖新的 graph/variant 文档。`overlays` 的路径
必须是 pack-relative、使用 `/`、无 `.`/`..`、无重复项。

## 3. 响应 envelope 和协商

响应共同包含：

```json
{
  "requestVersion": 42,
  "catalogHash": "<echoed hash>",
  "manifestHash": "<resolved manifest hash>",
  "compatible": true,
  "success": true,
  "serverSupportedVersions": [1],
  "selectedVersion": 1,
  "analyzerVersion": "3.1.0",
  "diagnostics": [],
  "graph": {}
}
```

规则如下：

1. `compatible=true` 时必须有 `selectedVersion`，且它必须同时出现在
   `serverSupportedVersions` 中并等于 payload 的 `contractVersion`。
2. `compatible=false` 时必须省略 `selectedVersion` 和 payload；不得拿旧版本
   payload 冒充新版本。
3. `compatible=true, success=false` 表示合同协商成功但当前 pack/程序解析失败。
   此时保留 `selectedVersion`，返回至少一个稳定诊断，不返回 payload。
4. `compatible=true, success=true` 必须返回 `manifestHash` 和对应 payload。
5. 参数格式错误、内部协议错误或取消请求可以使用标准 JSON-RPC error；程序
   不存在、variant 条件冲突、graph hazard 等 pack 语义错误应留在 result 的
   `diagnostics`/`hazards` 中。

这样可以把“版本不兼容”“当前请求失败”和“成功但有 warning”区分开，且单个
请求失败不会清除已有 L0-L2 诊断。

## 4. Runtime Graph Snapshot v1

`graph` 的字段为：

```text
contractVersion
graphHash
variantFingerprint
nodes[]
edges[]
executionOrder[]
events[]
resources[]
bindings[]
drawBuffers[]
hazards[]
```

### 4.1 节点和边

节点使用稳定 ID，而不是数组下标：

```json
{
  "id": "pass:shadow",
  "kind": "pass",
  "label": "Shadow",
  "active": true,
  "order": 3,
  "declaredId": "dawnlight:shadow",
  "stage": "fragment",
  "phase": "opaque",
  "provenance": [{
    "kind": "fragment",
    "file": "manifest/passes/shadow.json",
    "pointer": "/passes/0"
  }],
  "properties": [{"name": "target", "value": "shadowMap"}]
}
```

v1 的 node kind 为 `pass`、`command`、`program`、`resource`、`stage`、`service`、
`drawProvider`、`barrier` 和 `external`。新增种类必须升级合同版本。

边通过 `from`/`to` 引用节点，kind 包括 `sequence`、`dependsOn`、`invokes`、
`reads`、`writes`、`readWrites`、`binds`、`provides`、`requires`、`transitions`、
`commitsHistory` 和 `targets`。Parser 会拒绝重复 ID 和悬空引用。

### 4.2 Event、resource lifetime、binding 和 draw buffer

`events[].order` 是运行时执行序号；`executionOrder` 是稳定的节点顺序。Resource
使用 `lifetime.firstOrder/lastOrder` 表达可复用区间，并用 `persistent/history`
标记跨 pass 或历史资源。Binding 和 DrawBuffer 单独建模，避免 UI 重新解释
Manifest：

```json
{
  "id": "binding:shadow-depth",
  "nodeId": "pass:shadow",
  "resourceId": "resource:shadowDepth",
  "kind": "texture",
  "slot": 0,
  "access": "write",
  "stage": "fragment"
}
```

所有 `nodeId`、`resourceId`、`bindingId`、`drawBufferId` 都在合同边界进行存在性
校验。`DLGRAPH####` hazard 必须列出至少一个相关 `nodeIds`，并可携带
`provenance` 与 related information。

### 4.3 Hash 和稳定性

`graphHash` 是省略 `graphHash` 字段后的 canonical JSON SHA-256：对象 key 按
Unicode key 排序，数组顺序保持不变，undefined 字段不进入 JSON。TypeScript
实现通过 `canonicalizeRuntimeGraph`、`computeRuntimeGraphHash` 和
`verifyRuntimeGraphHash` 暴露同一算法。

Analyzer 应按稳定 ID 和执行顺序生成数组；客户端缓存键至少包含：

```text
packRoot + catalogHash + manifestHash + variantFingerprint + includeInactive
```

不能只使用文件时间戳或数组位置作为缓存键。

## 5. Variant Explanation v1

`explanation` 的核心字段：

```text
contractVersion
programId
kind                 // graphics | compute
active
inactiveReason?
compileMode?
variantFingerprint
sourceFiles[]
inputs.options[] / inputs.capabilities[]
defines[]
includes[]
graphNodeIds[]
```

每个 resolved input 记录 `id`、最终 `value`、来源（`request`、`default`、`catalog`、
`runtime`）和可选 provenance。每个 define 记录是否定义、最终值、来源类型
（`literal`、`option`、`capability`、`engineDefault`、`runtime`）、来源 ID、映射
状态和位置。这样 Hover/虚拟文档可以解释“为什么是这个值”，而不是只显示最终
宏文本。

`sourceFiles[].file` 和 `includes[].file` 都是 pack-relative 路径；
`graphNodeIds` 用于从程序解释跳转到 graph 节点。inactive program 必须给出
`inactiveReason`。`variantFingerprint` 是程序、resolved inputs、defines 和
source 列表的 SHA-256 指纹，不能与 graphHash 混淆。

## 6. Provenance 和路径安全

Provenance 的 kind 为 `manifest`、`fragment`、`shader`、`catalog`、`generated`
或 `runtime`。`pointer` 统一使用 RFC 6901（空指针或以 `/` 开头，`~` 只能组成
`~0`/`~1`），不混用 `$.a[0]`。Parser 严格拒绝未知字段、绝对路径、反斜杠、
路径穿越、重复 ID、重复 property/input/define/include 和悬空引用。

## 7. 取消、超时和降级

- Language Server 为每次请求分配 `requestVersion`，只发布最新世代；
- 超时、EOF、sidecar 崩溃和取消只影响当前 graph/variant 请求；
- 已发布的 graph/variant snapshot 可以保留并标记 stale，但不能伪装成当前
  manifest hash；
- Analyzer 离线时继续提供 Schema、动态 completion、Definition、Hover、Rename
  和快速诊断；
- Webview/虚拟文档只消费已解析 snapshot，不自行读取或重新解释 Manifest。

## 8. 参考实现和测试

TypeScript 合同及严格 parser 位于：

```text
packages/contracts/src/analyzerRuntime.ts
schemas/dawnlight-runtime-graph-v1.schema.json
schemas/dawnlight-variant-explain-v1.schema.json
test/v3/runtime-contracts.test.cjs
```

定向测试覆盖：版本常量、请求/响应协商、成功与 domain failure、hash 校验、
悬空引用、路径穿越、provenance、define 来源和 JSON Schema 未知字段拒绝。
