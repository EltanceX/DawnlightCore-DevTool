# Dawnlight Shader Pack VS Code Extension V2-6 验收记录

## 1. 范围

V2-6 在 V2-2 JSONC Composition、V2-3 Symbol/Reference Index、V2-4 动态 completion 和 V2-5 导航/Rename 之上增加快速跨文件诊断。实现只消费现有 Workspace、Composition、Symbol snapshots，不运行 C# Analyzer，也不实现 Catalog ID 诊断。

已实现的 owner：

| Owner/source | 层级 | 数据源 |
|---|---|---|
| `dawnlight-json` | L0 | JSONC Composition parse errors |
| `dawnlight-schema` | L1 | JSON Language Service |
| `dawnlight-path` | L2 | Workspace discovery + path references |
| `dawnlight-symbol` | L2 | Symbol/Reference Index |
| `dawnlight-graph` | L2 | Composition definitions + Settings UI |

Catalog ID/version (`DLCAT`) 和 Analyzer authoritative diagnostics (`DLMAN`) 仍留到后续里程碑。

## 2. 诊断规则

### Path

- fragment、Settings、shader、asset 文件缺失；
- rooted、drive-qualified、反斜杠、空 segment、`.`/`..` 和越界路径；
- discovery 已发现的重复/歧义/错误路径；
- 每条诊断使用 JSON string 或 root Manifest path 的精确 range。

### Symbol

- duplicate canonical ID (`DLSYMBOL0001`)；
- unknown option/resource/program/pass ID (`DLSYMBOL0002`)；
- ambiguous ID reference (`DLSYMBOL0003`)；
- `hiddenOptions` 也进入 option reference index；
- 解析错误文档不生成不可靠的 unknown-ID 噪声。

### Graph/resource

- `fullscreen`/`present` 必须使用 graphics program；
- `compute` 必须使用 compute program；
- command 的 program 必须列在 containing pass 的 `programs`；
- `historyCommit` 必须指向 `lifetime: history` resource；
- sampler/image/buffer binding 与资源 kind 不兼容；
- color/depth target 与资源 format/kind 不兼容；
- pass ordering `before`/`after`/`requires` 自引用。

### Settings UI

- control option unknown；
- 同一 option 被多个 control 控制；
- option 同时出现在 control 和 `hiddenOptions`；
- boolean/number/allowed option 与 widget 不匹配；
- dotted translation key 在任何 locale 中缺失；
- option 既没有 control 也没有 `hiddenOptions` 时发 Warning coverage 诊断。

## 3. 发布和 stale 防护

服务端为每个 URI 维护 Schema 与 L2 owner 的最新结果，并在发送 `publishDiagnostics` 前合并它们。因此后到的 Schema、JSONC 或 L2 结果不会清空其他 source。

L2 使用 175 ms debounce，并按 pack root 缓存诊断快照；单文件变化只重算受影响 pack。每次 rebuild 捕获：

- discovery snapshot；
- Composition generation；
- Symbol Index generation。

计时器执行前后只要 request、Composition generation 或 Symbol generation 发生变化，就丢弃结果并重新调度。Schema validation 也检查 LSP document version，旧版本结果不会覆盖新 overlay。

关闭文档时只移除该文档的 Schema owner，磁盘文档仍可保留 Workspace L2 诊断；移除 pack 后旧 URI 会发布空的合并结果。

## 4. 自动化验收

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

新增 `test/v2/diagnostics.test.cjs` 覆盖：

- 同一 URI 的 `dawnlight-schema`、`dawnlight-path`、`dawnlight-symbol`、`dawnlight-graph` source 共存；
- path 缺失、unknown/duplicate ID、command graph、history、binding、target、ordering 诊断；
- Settings widget、重复/unknown/omitted option 和 missing translation key；
- JSONC malformed overlay 的 L0 诊断；
- 修复 overlay 后旧 L0/schema 结果被清除、L2 symbol 结果恢复；
- 多文件、跨 fragment、Settings UI 精确 range。

当前单元与 LSP 回归结果：`53/53 passed`。真实 VS Code smoke test 也已通过。

## 5. VSIX

完成 `npm run package` 和干净 profile `npm run test:vsix` 后最终产物为：

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
大小：262080 bytes
SHA-256：2DCCA9D50F229E401F3F52BD759F177868C00A1B1F47C9A08045C4ABF0D2F441
```


## 6. 验收结论

- [x] L0 JSONC syntax diagnostics；
- [x] L1 Schema diagnostics 保持独立并丢弃 stale version；
- [x] fragment/settings/shader/asset path diagnostics；
- [x] duplicate/unknown/ambiguous pack-local ID diagnostics；
- [x] command/program/history/resource/target/order graph diagnostics；
- [x] Settings UI unknown/duplicate/widget/translation/coverage diagnostics；
- [x] source 合并发布不会互相清空；
- [x] generation、version、overlay 和多 pack 隔离；
- [x] Analyzer Offline 不影响 L0-L2；
- [ ] Catalog ID/version diagnostics（V2-7 / Catalog Snapshot）。
