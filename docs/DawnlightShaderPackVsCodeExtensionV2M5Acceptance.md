# Dawnlight Shader Pack VS Code Extension V2-5 验收记录

## 1. 范围

V2-5 在 V2-3 Symbol/Reference Index 和 V2-4 动态 completion 之上增加跨文件导航、语义 Hover 和安全 Rename。所有查询只消费当前内存中的 Workspace、Composition、JSONC overlay 和 Symbol Index，不重新解析 Manifest，不启动或等待 C# Analyzer。

本阶段实现：

- option、resource、program、pass ID Definition；
- fragment、Settings、shader、asset 路径 Definition；
- 跨 fragment 和 Settings UI 的 References；
- symbol/path Hover；
- ID 和 JSON 路径的 prepare Rename/Rename；
- duplicate、syntax error、uncertain reference、collision 和 stale index 安全拒绝。

Catalog entry 虚拟只读文档尚未实现，随 Catalog Snapshot 里程碑完成。

## 2. LSP 能力

Language Server 现在声明：

```json
{
  "definitionProvider": true,
  "referencesProvider": true,
  "hoverProvider": true,
  "renameProvider": {
    "prepareProvider": true
  }
}
```

`textDocument/definition` 对 ID 返回唯一 symbol 的 `selectionRange`；对 fragment、Settings、shader 和 asset 路径返回目标文件 URI 与文件起点。未解析、歧义或跨 pack 的目标不产生跳转。

`textDocument/references` 使用当前 pack 的 immutable reference snapshot。`includeDeclaration` 只对 ID symbol 添加定义位置；文件引用按 normalized pack-relative target 聚合。

## 3. Hover

语义 Hover 包含：

| Symbol | 摘要 |
|---|---|
| option | type、default、allowed、range、impact |
| resource | kind、format、lifetime、size、content |
| program | kind、shader files、compile mode、define count |
| pass | stage、target、phase、command count |
| path | normalized pack-relative path、存在状态、Rename 行为 |

所有 ID Hover 显示 definition fragment。动态 Hover 与原 Schema Hover 合并；查询不读取额外目录、不执行 Analyzer，也不等待外部进程。

## 4. Rename 安全模型

ID Rename 仅支持 option、resource、program 和 pass：

1. 目标必须有唯一确定定义；
2. 新 ID 必须符合 namespaced identifier 规则；
3. 新 ID 不得与当前 pack 中已有 canonical ID 冲突；
4. 定义及所有匹配引用必须处于当前 pack；
5. 所有匹配引用必须 resolved 且 non-ambiguous；
6. 返回标准 `WorkspaceEdit.changes`，由 VS Code 预览、应用和撤销。

路径 Rename 只修改同类、同目标的确认 JSON 引用。结果不包含 `RenameFile`、`CreateFile`、`DeleteFile` 或任何磁盘操作，因此不会移动 fragment、Settings、shader 或 asset 文件。新路径必须为使用 `/` 的安全相对路径。

以下情况使用 LSP `InvalidRequest` 和明确原因拒绝：

- 任一 pack 文档存在 JSONC syntax error；
- pack 存在 duplicate canonical ID；
- 当前引用 unresolved 或 ambiguous；
- Composition/Symbol Index generation 不一致；
- 打开的 overlay version 尚未进入索引；
- 文档归属多个 pack；
- 新 ID/path 非法或 ID 已存在。

## 5. Overlay、generation 与多 pack 隔离

导航服务在每次请求时验证：

- 打开文档版本等于 JSONC store overlay 版本；
- Symbol Index 中的文档版本等于 overlay 版本；
- Symbol Index composition generation 等于当前 Composition generation；
- 当前 URI 只属于一个 indexed project。

因此旧 generation 不会对新 overlay 返回错误位置，另一个 pack 中相同 ID 不会进入 Definition、References 或 Rename edit。

## 6. 自动化验收

执行：

```powershell
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

新增 `test/v2/navigation.test.cjs` 覆盖：

- LSP capability 声明；
- option/resource/program/pass 精确 Definition URI/range；
- fragment/Settings/shader/asset Definition；
- References 数量、声明包含开关和 Settings UI 跨文件引用；
- option metadata/definition fragment Hover；
- path normalized/existence Hover；
- prepare Rename placeholder/range；
- ID Rename `WorkspaceEdit`、多 pack 隔离和 JSON-safe replacement；
- path Rename 更新所有同类 JSON 引用且不产生文件操作；
- 未保存 definition/usage/Settings overlay 的跨文件 Definition；
- duplicate、syntax error、unresolved reference 和 collision 拒绝。

当前单元与 LSP 回归结果：`51/51 passed`。

真实 VS Code smoke test 与干净 profile VSIX 安装态验收均通过。安装包：

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
大小：257478 bytes
SHA-256：8DB03234F4B2F76C40C6F4D927176BED455525F15D7EF32662E6E832EB66E2A0
```

## 7. 验收结论

- [x] option/resource/program/pass Definition 已完成；
- [x] fragment/Settings/shader/asset Definition 已完成；
- [x] References 跨 fragment 和 Settings UI；
- [x] Hover 显示 symbol 摘要与 definition fragment；
- [x] Rename 返回可预览、可撤销的 `WorkspaceEdit`；
- [x] Rename 不修改其他 pack，不移动文件；
- [x] 不安全 Rename 返回明确拒绝原因；
- [x] Hover 不运行或等待 Analyzer；
- [ ] Catalog entry 虚拟文档随后续 Catalog Snapshot 实现。
