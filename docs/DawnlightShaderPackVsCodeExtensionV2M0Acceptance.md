# Dawnlight Shader Pack VS Code Extension V2-0 Acceptance

状态：已完成
日期：2026-08-16
里程碑：V2-0 Contracts 和工程基础
VSIX 版本：0.1.0
V2 workspace package 版本：0.2.0

## 1. 目标和边界

V2-0 为后续跨文件编辑能力建立可执行、可测试和可发布的 TypeScript/Language Server 基础。它必须保持第一版 Schema、snippets、Hover、静态 completion 和普通 JSON 隔离行为，同时完成以下基础能力：

- npm workspace 和 TypeScript project references；
- 独立的 Contracts、Language Server、VS Code Client 和测试工具包；
- 不依赖扩展版本号的协议/数据合同版本；
- 稳定的 diagnostic 命名空间和编码方法；
- 可通过 stdio 独立测试的最小 Language Server；
- 由 VS Code Client 通过 IPC 启停的发布态 Language Server；
- 只携带 bundle 与静态资源、不携带运行时 `node_modules` 的 VSIX。

V2-0 不实现 pack discovery、fragment composition、JSONC overlay、符号索引、动态 completion、Catalog 或 C# Analyzer。这些能力仍按 V2 方案从 V2-1 开始逐步实现。

## 2. 工程结构

根项目继续作为最终 VSIX 的发布入口，使用 npm workspaces 管理四个私有包：

```text
packages/
  contracts/         共享协议版本、能力和 diagnostic 合同
  language-server/   最小 LSP 进程入口
  vscode-extension/  VS Code Language Client 生命周期
  test-utils/        进程级 LSP 测试 harness
```

根 `tsconfig.json` 通过 project references 引用四个包；公共严格编译选项位于 `tsconfig.base.json`。各包将 TypeScript 输出到自身 `dist` 供 Node 测试使用，最终扩展运行产物由 esbuild 输出到：

```text
dist/extension.js
dist/server.js
```

这两个 bundle 是 VSIX 唯一新增的运行时代码。`packages/**`、测试、fixtures、TypeScript 源码和 `node_modules` 均不进入 VSIX。

## 3. Contracts

`@dawnlight/contracts` 当前定义以下独立版本：

| 合同 | 版本 |
|---|---:|
| Language Server protocol | 1 |
| Analyzer protocol | 1 |
| Catalog Snapshot | 1 |
| Schema contract | 1 |
| Manifest | 3 |
| Source Composition | 1 |
| Settings UI | 1 |

这些数字不读取或复用根扩展的 `0.1.0` 版本。Language Server 在 initialize 结果的 `capabilities.experimental.dawnlight` 中公布当前实际支持的 LSP、Schema、Manifest、Source Composition 和 Settings UI 合同。

Diagnostic 基础命名空间为：

```text
DLJSON   DLSCHEMA   DLSYMBOL   DLPATH
DLCAT    DLMAN      DLGRAPH
```

`createDiagnosticCode(namespace, ordinal)` 生成固定四位序号，例如 `DLMAN0037`，只接受 `0..9999` 的整数。V2-0 只冻结命名基础，不提前定义 V2-1 及以后诊断的具体语义。

## 4. 最小 Language Server 生命周期

Language Server 当前实现：

- LSP initialize/initialized/shutdown/exit 生命周期；
- `TextDocumentSyncKind.Incremental`；
- `rootUri: null` 和无 workspace folders 时正常启动；
- server name/version 与 Dawnlight experimental capabilities；
- client/server LSP 合同版本不一致时写入协议日志。

VS Code Extension 当前实现：

- 保留第一版三组 `jsonValidation` 和 JSON/JSONC snippets contribution；
- 通过 `workspaceContains:**/shaderpack.json` 激活；
- 通过 IPC 启动 bundle 中的 `dist/server.js`；
- 同步 JSON/JSONC 文档并监听 `shaderpack.json` 文件事件；
- deactivate 时等待 Language Client/Server 正常停止；
- 暴露只读 `getServerStatus()` API，供集成验收验证运行状态和合同版本。

文件监听目前只负责建立生命周期基础，不创建 pack model；工作区发现逻辑属于 V2-1。

## 5. 测试和验收结果

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

2026-08-16 本机验收结果：

| 检查项 | 结果 |
|---|---|
| `npm run lint` | 通过，12 个 CommonJS 文件、40 个 JSON 文件；忽略构建和 VS Code profile 缓存 |
| `npm run typecheck` | 通过，TypeScript strict project build |
| `npm test` | 通过，26/26 |
| Contracts 测试 | 通过，独立版本、能力、命名空间和 ordinal 边界 |
| LSP 进程测试 | 通过，空工作区 initialize、增量同步、capabilities 和优雅关闭 |
| 第一版回归测试 | 通过，原有 21/21 Schema/completion/fileMatch/snippet 测试 |
| 开发态 VS Code smoke | 通过，Language Client 已启动且原有编辑行为无回归 |
| 干净 profile VSIX smoke | 通过，安装发布包后重复同一集成测试 |
| `npm run package` | 通过，VSIX 共 13 个文件 |
| VSIX 内容审计 | 通过，无 packages、test、fixtures、TypeScript 源码或 node_modules |

## 6. VSIX 产物

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
大小：183564 bytes
SHA-256：4660979c84f7dda76eb395b9fb3b72ce24d5921e87abf333c41cd6c0c3c3ce6a
```

关键内容：

```text
extension/dist/extension.js
extension/dist/server.js
extension/schemas/*.json
extension/snippets/shaderpack.code-snippets
```

根扩展在 V2 开发期间仍保持 `0.1.0`，避免把尚未完成的 V2 authoring 能力误标为正式 `0.2.0`。内部 workspace packages 使用 `0.2.0` 表示目标开发线；最终发布版本在 V2 总体验收时统一调整。

## 7. V2-0 验收结论

- [x] TypeScript workspace 和四个职责明确的包已建立；
- [x] 第一版 declarative contributions 完整保留；
- [x] Schema、LSP、Catalog 和 Analyzer 使用独立合同版本；
- [x] Diagnostic 基础类型、命名空间和稳定编码方法已建立；
- [x] Language Server 单元测试 harness 可启动真实 bundle；
- [x] Language Client/Server 可在开发目录和安装后 VSIX 中启动、关闭；
- [x] 空工作区 LSP initialize 不报错；
- [x] 第一版 21 项行为回归测试继续通过；
- [x] VSIX 无运行时依赖目录和开发源码泄漏；
- [x] V2-1 及后续能力未提前耦合进基础层。

下一里程碑是 V2-1 Workspace Pack Discovery。实现时应复用本阶段的 Contracts 和 Language Server 生命周期，并新增多 pack 隔离、路径规范化、文件事件和项目 generation 测试。
