# Dawnlight Shader Pack VS Code Extension V2-2 Acceptance

状态：已完成
日期：2026-08-16
里程碑：V2-2 JSONC 容错文档与 Composition
VSIX 版本：0.1.0
V2 workspace package 版本：0.2.0

## 1. 目标和边界

V2-2 在 V2-1 discovery snapshot 上增加统一的 JSONC 文档层和 pack composition。它完成：

- 使用 `jsonc-parser` 保存 AST、parse errors、node path 和精确 range；
- 注释和尾随逗号可参与 composition；
- 打开的未保存文档 overlay 优先于磁盘内容；
- 每个文档保存 LSP version 和 source（disk/overlay）；
- 按 root `fragments` 顺序组合 options/resources/programs/passes；
- fragment 可指向后续文件，composition 不因声明顺序限制 forward reference；
- 一个 fragment 临时语法错误时保留其他 fragment 的 definitions；
- root overlay 修改 fragment 顺序时原子替换 discovery/composition snapshot；
- project generation、composition request generation 和 AbortSignal 防止 stale 结果发布。

V2-2 不实现 symbol/reference index、duplicate ID 语义、dynamic ID completion、Definition/References/Rename、Catalog 或 C# Analyzer。它只建立这些能力共享的文档和 composition 基础。

## 2. JSONC Document Snapshot

`JsoncDocumentStore` 对每个 file URI 维护一份当前快照：

```text
JsoncDocumentSnapshot
  uri / absolutePath
  version
  source: disk | overlay
  text
  value
  root Node
  parse errors: offset / length / code
  nodeAtPath(path)
  nodePathAtOffset(offset)
  rangeForNode(node)
```

磁盘读取使用 version `0`；`textDocument/didOpen` 和 `didChange` 使用 LSP version。`didClose` 移除 overlay 并重新读取磁盘内容。Watcher 事件只使没有 overlay 的磁盘 cache 失效，因此未保存内容不会被磁盘事件覆盖。

解析使用 `{ allowTrailingComma: true }`。parseTree 即使存在 syntax error 也会保留可确定的局部 Node，供 composition 提取局部 definition；错误位置通过 TextDocument 的 `positionAt` 转换为精确 LSP range。

## 3. Composition Model

`WorkspaceCompositionManager` 接收 V2-1 `WorkspaceDiscoverySnapshot` 和 `JsoncDocumentStore`，对每个 pack 产生：

```text
PackComposition
  rootUri
  discoveryGeneration
  documents[]
  definitions.options[]
  definitions.resources[]
  definitions.programs[]
  definitions.passes[]
  diagnostics[]
```

每个 definition 保存：

- canonical `id`；
- kind；
- source URI；
- definition range 和 `id` selection range；
- fragment order；
- fragment 内数组 local order。

composed root 只从有序显式 fragment 提取 definitions；single-file root 直接从 root 文档提取。引用可以指向后续 fragment，因为 composition 在 discovery 已确定的顺序上完整读取后再生成 snapshot。

## 4. Overlay 和原子更新

root overlay 通过 discovery 的 overlay map 重新解析 `fragments/settings/shaderRoot`，因此未保存 root 修改会立即影响项目关系；新 overlay fragment 即使尚未存在于磁盘，也可以参与 composition。fragment/settings overlay 不重新扫描 workspace，只触发 composition 重建。

每次 rebuild 先等待一个异步 checkpoint，再检查：

1. composition request generation 是否仍是最新；
2. AbortSignal 是否已取消。

任一条件不满足，结果返回 `applied: false`，当前 snapshot 不变。通过新 request 或 `cancel()` 可丢弃旧结果。文档 version 存在 composition document snapshot 中，后续异步 analyzer/index 只允许发布对应 version 的结果。

## 5. 语法错误隔离

单个 fragment 出现临时缺失括号、注释未闭合或其他 JSONC syntax error 时：

- 该 fragment 仍保存 parse errors 和可确定 AST；
- 可确定的局部 definitions 可以保留；
- 其他 fragment 的 definitions 不会被清空；
- composition diagnostic 使用 `DLJSON0001`，带有错误 URI/range；
- composition snapshot 仍可原子发布。

root 无法解析时，V2-1 discovery 会暂时没有新的 fragment 列表；V2-2 不伪造生产 composition，root 恢复后由下一次 overlay/save/watcher refresh 重建。

## 6. Language Server 接入

服务器现在处理：

- `textDocument/didOpen`：创建 overlay、解析 AST、触发 composition；
- `textDocument/didChange`：更新 overlay/version、触发 composition；
- `textDocument/didClose`：移除 overlay、恢复磁盘快照、触发 composition；
- `workspace/didChangeWatchedFiles`：失效磁盘 cache 并重建受影响项目；
- `dawnlight/workspaceSnapshot`：V2-1 discovery DTO；
- `dawnlight/compositionSnapshot`：当前 composition DTO。

动态 Schema completion/hover/diagnostics 继续使用 VS Code 当前文档内容，不会等待 composition 或 Analyzer。

## 7. 自动化测试

可复现命令：

```powershell
npm install
npm run lint
npm run typecheck
npm test

$env:DAWNLIGHT_RUN_VSCODE_TEST = '1'
$env:DAWNLIGHT_RUN_VSIX_TEST = '1'
$env:DAWNLIGHT_VSCODE_PATH = 'D:\Software\VSCode\Microsoft VS Code\bin\code.cmd'
npm run test:vscode
npm run package
npm run test:vsix
```

当前验收结果：

| 检查项 | 结果 |
|---|---|
| `npm run lint` | 通过，15 个 CommonJS 文件、44 个 JSON 文件 |
| `npm run typecheck` | 通过 |
| `npm test` | 通过，43/43 |
| 原有 MVP 21 项回归 | 通过 |
| JSONC comments/trailing comma | 通过 |
| AST node path/range | 通过 |
| disk/overlay priority and close restore | 通过 |
| ordered composition and forward fragment | 通过 |
| malformed fragment sibling isolation | 通过 |
| root overlay reorder without disk write | 通过 |
| document version and composition generation | 通过 |
| cancellation/stale result rejection | 通过 |
| Language Server composition snapshot | 通过 |
| 开发态 VS Code smoke | 通过 |
| VSIX packaging and installed profile smoke | 通过 |

## 8. VSIX 产物

文件：`dawnlight-shader-pack-tools-0.1.0.vsix`  
大小：246214 bytes  
SHA-256：`ab22c33588ab3cbc3a33498ca3dafd27f732407eab4becd773dbed0690016a51`

## 9. V2-2 验收结论

- [x] JSONC AST、parse errors、node path 和 precise ranges 已统一保存；
- [x] comments/trailing commas 可参与 composition；
- [x] 未保存 overlay 优先于磁盘且关闭后恢复磁盘；
- [x] 每个文档保存 LSP version/source；
- [x] root fragments 按声明顺序组合 definitions；
- [x] forward fragment 可被组合；
- [x] 单 fragment syntax error 不清空 sibling definitions；
- [x] project/composition generation 原子替换；
- [x] stale request/cancellation 不覆盖最新 snapshot；
- [x] 现有 V2-1 discovery 和 MVP Schema 行为无回归；
- [ ] symbol/reference index、dynamic completion、rename 和 analyzer（延期至 V2-3/V2-4）。

下一里程碑是 V2-3 Symbol/Reference Index。它应直接消费本阶段的 `JsoncDocumentStore` 和 `PackComposition`，不要为每个功能重复解析磁盘或忽略 overlay version。
