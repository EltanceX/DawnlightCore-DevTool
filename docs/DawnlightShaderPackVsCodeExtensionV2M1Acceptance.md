# Dawnlight Shader Pack VS Code Extension V2-1 Acceptance

状态：已完成
日期：2026-08-16
里程碑：V2-1 Workspace Pack Discovery
VSIX 版本：0.1.0
V2 workspace package 版本：0.2.0

## 1. 目标和边界

V2-1 在 V2-0 的 Contracts 和最小 Language Server 上建立工作区 shader-pack 项目模型。本阶段完成：

- 工作区启动时递归发现一个或多个 `shaderpack.json`；
- 打开文档时向上查找最近的 pack root；
- 解析 root 中显式声明的 `fragments`、`settings` 和 `shaderRoot`；
- 使用 normalized pack-relative path 建立文档角色；
- 处理多 pack、嵌套 pack、歧义归属和工作区 folder 变化；
- 处理 root/引用文件的创建、删除、重命名和修改事件；
- 为第一版静态目录规则覆盖不到的 fragment/settings 自动提供 Schema 能力。

V2-1 不组合 fragment 内的 definitions，不保存 JSONC AST，不让未保存 root 内容覆盖磁盘，不建立 symbol/reference index。上述能力属于 V2-2/V2-3。

## 2. Workspace Snapshot

`WorkspacePackDiscovery` 每次有效刷新完整构造下一个 snapshot，成功后再原子替换当前引用。Snapshot 包含：

```text
WorkspaceDiscoverySnapshot
  generation
  packs[]
    rootPath / manifestPath / id
    valid / generation
    fragments[]
    settings?
    shaderRoot?
    diagnostics[]
  ambiguousDocuments[]
```

每个引用保存原始路径、normalized `/` 路径、绝对路径、存在状态和有效状态。Snapshot、pack、reference、diagnostic 和数组均被冻结；旧 snapshot 不会被后续 root 顺序修改。

Language Server 通过版本化方法 `dawnlight/workspaceSnapshot` 返回 URI 化的传输 DTO，供客户端状态、测试和后续 V2 命令复用。

## 3. 发现和归属规则

扫描规则：

1. 每个 workspace folder 独立扫描；
2. 默认跳过 `.git`、`.vscode-test`、`node_modules`、`bin`、`obj`、`dist` 和 `out`；
3. 不跟随目录 symlink；
4. 重叠 workspace folder 中的同一个 canonical root 只创建一个项目；
5. 只跟踪 root 显式声明的 fragment/settings/shaderRoot，不递归猜测 JSON 角色；
6. 文档归属选择包含它的最近 pack root；
7. 被排除目录内的文档不归属外层源码 pack；
8. 两个 pack 显式引用同一 canonical 文档时记录歧义。

打开文档时，如果初始扫描尚未发生或刚创建的 root 尚未收到 watcher 事件，服务器会向上寻找最近 `shaderpack.json` 并刷新模型。

## 4. 路径合同和快速发现诊断

Pack path 必须：

- 非空；
- 使用 `/`；
- 不是 `/`、`\\` 或 drive-qualified rooted path；
- 不包含空 segment、`.`、`..` 或 null character；
- lexically 和 realpath 均不越出 pack root。

V2-1 固定以下 discovery diagnostic：

| Code | 含义 |
|---|---|
| `DLJSON0001` | root 无法读取、语法无效或根值不是 object |
| `DLPATH0001` | path 类型或格式无效 |
| `DLPATH0002` | duplicate fragment path |
| `DLPATH0003` | self inclusion (`shaderpack.json`) |
| `DLPATH0004` | 文件/目录缺失或 kind 错误 |
| `DLPATH0005` | lexical/realpath 越出 pack root |
| `DLPATH0006` | 同一文档被多个 pack 显式认领 |

这些诊断当前属于 workspace snapshot，不发布到 VS Code Problems。统一的跨文件诊断调度和 source 隔离属于 V2-6。

## 5. 动态 Schema 关联

第一版 declarative contribution 继续处理约定目录：

```text
manifest/options/*.json
manifest/resources/*.json
manifest/programs/*.json
manifest/passes/*.json
manifest/ui/settings.json
```

对于 root 显式引用但不匹配上述路径的 JSON/JSONC 文件，Language Server 使用同一份发布 Schema 提供：

- property/value completion；
- Hover description；
- Schema diagnostics。

未显式引用的 JSON 不注册动态角色，Language Server 对 completion/Hover 返回空结果并清除自己的 diagnostics。这样不会把整个 workspace 的普通 JSON 当作 Dawnlight fragment。

## 6. 文件和工作区事件

VS Code Client 在扩展激活后建立 workspace file watcher。Language Server 只对以下事件重建 snapshot：

- 任意非排除目录中的 `shaderpack.json`；
- 当前 pack 显式跟踪的 fragment/settings；
- 当前 `shaderRoot` 内的文件；
- workspace folder 添加或移除。

不相关文件事件不会增加 generation，也不会重新验证已打开文档。Root 删除会移除项目，root 创建会新增项目，引用文件的创建/删除/重命名会更新 `exists/valid`。

## 7. 自动化测试

可复现命令：

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run package

$env:DAWNLIGHT_RUN_VSCODE_TEST = '1'
$env:DAWNLIGHT_RUN_VSIX_TEST = '1'
$env:DAWNLIGHT_VSCODE_PATH = 'D:\Software\VSCode\Microsoft VS Code\bin\code.cmd'
npm run test:vscode
npm run test:vsix
```

2026-08-16 验收范围：

| 检查项 | 结果 |
|---|---|
| `npm run lint` | 通过，14 个 CommonJS 文件、44 个 JSON 文件 |
| `npm run typecheck` | 通过，strict TypeScript project build |
| `npm test` | 通过，37/37 |
| 第一版 Schema/snippet 回归 | 通过，原有 21 项 |
| Path normalization/拒绝规则 | 通过 |
| 任意 fragment/settings 角色 | 通过 |
| untracked JSON 隔离 | 通过 |
| 默认排除目录 | 通过 |
| 多 pack 隔离和 nested nearest-root | 通过 |
| duplicate/self/missing/invalid/ambiguous | 通过 |
| malformed root 容错 | 通过 |
| generation 和 fragment order 原子替换 | 通过 |
| root/tracked file 创建、重命名、删除 | 通过 |
| workspace folder 移除 | 通过 |
| 独立 stdio LSP workspace 测试 | 通过 |
| 开发态 VS Code 动态 Schema smoke | 通过 |
| 干净 profile VSIX smoke | 通过，exit code 0；Windows 偶发临时 profile 锁定 warning 不影响验收 |

## 8. VSIX 产物

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
大小：242705 bytes
SHA-256：779a8829dbe16a59334bd7c08379cf7a30146f06a3f38acf25886910fc84366e
```

VSIX 必须继续只包含 `dist/extension.js`、`dist/server.js`、Schema、snippets 和发布元数据；不得包含 packages 源码、测试、fixtures、TypeScript 或运行时 `node_modules`。

## 9. V2-1 验收结论

- [x] workspace 启动可发现一个或多个 pack；
- [x] 打开文档可找到最近 pack root；
- [x] 默认排除源码控制、依赖和构建输出目录；
- [x] 只跟踪 root 显式引用；
- [x] fragment/settings/shaderRoot 使用 normalized pack-relative path；
- [x] duplicate、self、missing、rooted、dot/empty segment 和越界 path 被处理；
- [x] 多 pack 状态隔离，nested pack 使用最近 root；
- [x] 歧义 ownership 可检测；
- [x] root 临时无效不会使 Language Server 崩溃；
- [x] 文件和 workspace folder 事件原子更新 generation；
- [x] 任意合法 fragment/settings 路径自动获得正确 Schema；
- [x] 普通未跟踪 JSON 不获得 Dawnlight 动态 Schema；
- [x] 第一版 declarative 行为无回归；
- [ ] V2-2 JSONC overlay、容错 AST 和 composition model（明确延期）。

下一里程碑是 V2-2 JSONC 容错文档与 Composition。它应在本 snapshot 上增加文档 version、project generation 校验、未保存 overlay 和 fragment definitions 的有序组合，而不是重新实现 pack discovery。
