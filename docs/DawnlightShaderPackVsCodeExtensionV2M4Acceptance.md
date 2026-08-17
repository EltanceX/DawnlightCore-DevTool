# Dawnlight Shader Pack VS Code Extension V2-4 验收记录

## 1. 范围

V2-4 在 V2-3 Symbol/Reference Index 之上增加确定 JSON path 的动态 completion。Schema completion、snippets 和普通 JSON 隔离行为继续保留。动态 completion 只消费当前 pack 的 composition/symbol snapshot，不等待 Catalog、C# Analyzer 或其他外部进程。

## 2. Completion 合并

Language Server 的 `textDocument/completion` 现在执行：

1. 请求现有 `DawnlightSchemaService` completion；
2. 从当前文档 AST path 解析动态上下文；
3. 使用当前 pack 的 composition definitions 和 `dawnlight/symbolSnapshot` 可用性检查生成候选；
4. 按 `label + kind + insertion range + insertText` 去重；
5. 动态候选使用 `sortText` 前缀 `0_`，Schema 候选保留原行为。

动态候选均提供 `label`、`kind`、`detail`、`sortText`、`insertText`、`textEdit.range`。字符串候选插入 JSON quoted text，数值/布尔候选插入 JSON literal。

## 3. 已实现上下文

| JSON path/context | 行为 |
|---|---|
| root `fragments[]` | 扫描 pack 内 JSON/JSONC，排除 root、自身、settings、越界和重复路径 |
| root `settings` | 扫描 pack 内 JSON/JSONC，排除 root、fragment 和自身 |
| Program `vertex/fragment/geometry/compute` | 从 shaderRoot 扫描文件，按 stage 扩展名和 graphics/compute 过滤 |
| `defines.*.option`、condition `option`、Settings control `option` | option symbol 候选，detail 包含 type/default/impact |
| pass `programs[]` | program 候选，排除数组内已有 ID |
| command `program` | 按 command type 和 containing pass programs 过滤 graphics/compute |
| resource binding | 按 sampler/image/buffer binding kind 过滤 resource |
| target resource | colors 排除 depth format，depth 优先 depth format |
| copy source/destination | 排除当前 source/destination 自身 |
| historyCommit resource | 仅提示 history lifetime resource |
| pass `before/after/requires` | pass 候选，排除当前 pass |
| condition `equals/notEquals/in` | 使用 option allowed/default/type 生成 JSON 值 |
| Settings `widget` | boolean -> toggle，number/integer -> slider/number，allowed -> choice |
| Settings choice `value` | 使用 selected option allowed/default 值 |
| Settings title/label/description | 从 translations locale keys 生成候选 |

不确定上下文不会静默删除 Schema 合法候选；Schema 结果仍作为后备返回。

## 4. 普通 JSON 与多 pack 隔离

普通 JSON、未归属文档和 workspace 外文件不会产生 Dawnlight 动态候选。候选只来自当前 document association 对应的 pack；另一个 pack 的同名 option/program/resource 不会串入当前补全列表。

路径候选使用 pack-relative forward slash，不写回磁盘。文件扫描使用 V2-1 的排除目录集合，并在 watcher/overlay 事件后失效缓存。

## 5. 自动化验收

执行：

```powershell
npm install
npm run lint
npm run typecheck
npm test

$env:DAWNLIGHT_RUN_VSCODE_TEST = '1'
$env:DAWNLIGHT_VSCODE_PATH = 'D:\Software\VSCode\Microsoft VS Code\bin\code.cmd'
npm run test:vscode

npm run package
$env:DAWNLIGHT_RUN_VSIX_TEST = '1'
npm run test:vsix
```

V2-4 测试覆盖：

- dynamic option/program/resource/path/shader candidates；
- graphics/compute stage and command filtering；
- Settings option/widget/translation candidates；
- completion item detail/insertText/textEdit range/sortText；
- Schema + dynamic merge and duplicate removal；
- unsaved overlay and multi-pack isolation；
- V2-1 discovery、V2-2 composition、V2-3 index 和 MVP regression。

VSIX 安装态产物：

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
大小：253427 bytes
SHA-256：839502f4510536f9c3270332de93c25b26517b1c5cd34c603aa8449600ba8d0d
```

## 6. 性能与边界

动态 provider 同步消费内存 snapshot；pack 文件候选使用按 pack 缓存的目录扫描结果，watcher/overlay 变更时失效。实现不执行 Analyzer，不计算 canonical hash，不修改 Manifest/shader 文件。

后续可继续优化 warm completion p95 50 ms 目标，并在 Catalog Snapshot 完成后追加版本/服务过滤。

## 7. 验收结论

- [x] Schema completion 和 snippets 无回归；
- [x] 动态 ID/path/shader completion 已接入 LSP；
- [x] 候选包含 detail、sortText、insertText 和精确 textEdit range；
- [x] graphics/compute、resource kind、history lifetime 和 Settings widget 过滤已实现；
- [x] 普通 JSON 和多 pack 候选严格隔离；
- [x] 动态 completion 不等待 Analyzer；
- [ ] Catalog completion、Definition/References/Rename 和 Hover 扩展延期至后续里程碑。
