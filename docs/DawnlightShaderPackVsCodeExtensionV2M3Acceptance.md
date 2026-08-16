# Dawnlight Shader Pack VS Code Extension V2-3 验收记录

## 1. 范围

V2-3 在 V2-2 JSONC 文档存储和 ordered composition 之上建立 pack-local Symbol/Reference Index。索引不重复读取或解析 Manifest，而是直接消费 `PackComposition` 中的定义值和 `JsoncDocumentStore` 产生的 AST ranges。

本阶段不实现动态 completion、Go to Definition、Find References、Rename、Catalog 或 C# Analyzer；这些能力后续消费本阶段的 immutable snapshot。

## 2. Symbol 合同

Language Server 新增 `dawnlight/symbolSnapshot` 请求，返回 `DawnlightWorkspaceSymbolIndexSnapshot`：

```text
workspace snapshot
  projects[]
    rootUri
    compositionGeneration
    documents[]       // uri/version/source/parseErrorCount
    symbols[]         // id/canonicalId/kind/path/range/selectionRange
    references[]      // targetId/targetPath/targetUri/range/resolved/ambiguous
    duplicates[]      // canonicalId + all definition ranges
    diagnostics[]     // DLSYMBOL0001
```

支持的 symbol kind：

- `option`、`resource`、`program`、`pass`；
- `settingsPage`、`settingsGroup`、`settingsControl`；
- `file`（shader、asset，以及 root 的 fragment/settings/shaderRoot 路径）。

manifest definition 的 canonical ID 直接使用 pack-local ID。Settings UI 使用 `settings:<kind>:<id>` 命名空间，避免与 manifest ID 发生跨域碰撞。每个 symbol 保存 JSON path、definition range 和 selection range。

支持的 reference kind：

- option：condition、program define 和 Settings UI control；
- program：pass `programs[]`、command `program`；
- resource：inputs/outputs、targets、bindings、copy source/destination 和 history resource；
- shader：program 的 vertex/fragment/geometry/compute 路径；
- asset：resource content path/faces 路径；
- path：root fragments/settings/shaderRoot 路径。

每个引用保存来源 URI/path/range。ID 引用解析为 `resolved` 或 `ambiguous`，文件引用解析为 pack-relative `targetPath` 和现有文件 URI。

## 3. Duplicate 与 pack 隔离

同一个 project 内，同一 canonical ID 出现多个 manifest definition 或同一 Settings namespace symbol 时会：

- 进入 `duplicates[]`，保留所有 definition ranges；
- 生成 `DLSYMBOL0001`，每个重复 definition range 一条诊断。

不同 pack 拥有独立 index、ID map 和 duplicate 集合。相同 ID 出现在两个 pack 中不会互相解析或产生重复诊断。

## 4. 增量与原子发布

`WorkspaceSymbolIndexManager` 根据 changed paths 只重建受影响 pack：

- 首次构建或无 changed path 时建立全部 pack；
- 文件事件、document overlay 和 close 事件只标记路径所在 pack；
- 未受影响 pack 复用之前的 immutable project snapshot；
- 当前请求被取消或 superseded 时不发布旧结果；
- workspace snapshot 以新的 generation 一次性替换。

索引不声明生产 canonical hash，也不依赖 C# Analyzer。

## 5. 自动化验收

执行：

```powershell
npm install
npm run lint
npm run typecheck
npm test
```

覆盖项：

- 四类 manifest definition、Settings page/group/control；
- JSON path、definition/selection range；
- option/resource/program ID 引用及 resolved 状态；
- shader/asset 路径及 file symbol；
- duplicate ID 的两个 definition ranges；
- 多 pack 相同 ID 隔离；
- 单 pack 变更时 unaffected project snapshot 复用；
- Language Server `symbolSnapshot` 初始索引和 unsaved overlay 更新；
- V2-1 discovery、V2-2 JSONC/composition 和 MVP Schema/snippet 回归。

VSIX 安装态验收：

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
大小：249156 bytes
SHA-256：9c3af68252c1f6be114892d45f4f3d23c4b279c1717cd45b2e4208bc73871c31
```

## 6. 验收结论

- [x] option/resource/program/pass 已建立 definition index；
- [x] Settings UI page/group/control 已建立 symbol index；
- [x] ID reference、shader path、asset path 已保存 range；
- [x] duplicate canonical ID 产生完整 definition 列表和 `DLSYMBOL0001`；
- [x] 多 pack 严格隔离；
- [x] file symbol 保存 pack-relative target path 和存在状态；
- [x] changed path 只重建受影响项目；
- [x] immutable snapshot 原子替换和 stale request 防护已保留；
- [ ] dynamic completion、Definition/References/Rename、Catalog 和 Analyzer 延期至后续里程碑。

下一阶段是 V2-4 动态 Completion，应直接消费 `dawnlight/symbolSnapshot` 的 pack-local symbols/references，不重复实现 Manifest 解析。
