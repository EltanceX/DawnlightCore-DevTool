# Dawnlight Shader Pack VS Code Extension MVP-6 Acceptance

状态：已完成  
日期：2026-08-16  
版本：0.1.0

## 1. 验收范围

MVP-6 验证可发布的 declarative VSIX，而不是开发目录中的临时文件。验收覆盖：

- 质量检查、Schema/补全单元测试和 VSIX 打包；
- 干净 VS Code profile 安装 VSIX；
- Minimal、ToonLab、options/resources/programs/passes 和 Settings UI 文件；
- Hover、错误诊断和普通 JSON 隔离；
- 离线可用性和最终 VSIX 文件清单。

## 2. 可复现命令

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run package

$env:DAWNLIGHT_RUN_VSIX_TEST = '1'
$env:DAWNLIGHT_VSCODE_PATH = 'D:\Software\VSCode\Microsoft VS Code\bin\code.cmd'
npm run test:vsix
```

`test:vsix` 会在系统临时目录创建独立的 user-data/extensions 目录，安装当前 VSIX 后再运行端到端测试；测试结束后会尝试清理临时 profile。普通 `npm run test:all` 不启动 VS Code，因为 `test:vscode` 和 `test:vsix` 默认跳过。

## 3. 结果

| 检查项 | 结果 |
|---|---|
| `npm run lint` | 通过，检查 9 个 CommonJS 文件和 30 个 JSON 文件 |
| `npm run typecheck` | 通过，检查 9 个 CommonJS 文件和 30 个 JSON 文件；项目为 JavaScript/CJS，无 TypeScript 类型层 |
| `npm test` | 通过，11/11 |
| `npm run package` | 通过，VSIX 11 个文件，11.41 KB |
| 干净 profile 安装 VSIX | 通过 |
| Minimal root 无错误 | 通过 |
| ToonLab root 无错误 | 通过 |
| 四类 fragment 和 Settings UI 无错误 | 通过 |
| 错误类型 fixture 产生诊断 | 通过 |
| Manifest 字段 completion | 通过 |
| Schema Hover 描述 | 通过 |
| 普通 JSON 不应用 Dawnlight root Schema | 通过 |
| 离线静态资源检查 | 通过，VSIX 不包含 node_modules、测试、fixture 或远程运行时资源 |

## 4. VSIX 清单

`npx vsce ls` 输出：

```text
README.md
package.json
LICENSE
CHANGELOG.md
snippets/shaderpack.code-snippets
schemas/shaderpack-settings-ui-v1.schema.json
schemas/shaderpack-manifest-v3-root.schema.json
schemas/shaderpack-manifest-v3-fragment.schema.json
schemas/shaderpack-common.schema.json
```

构建产物：

```text
文件：dawnlight-shader-pack-tools-0.1.0.vsix
版本：0.1.0
大小：11683 bytes
SHA-256：0B5C9FA3ACFF6153BA16134E3ABDCA4F72967457A9913D8C336A9C8A871C31C8
```

VSIX 只包含扩展运行所需的 package、Schema、snippets、README、CHANGELOG 和许可证。测试源码、fixture、文档目录、依赖目录和临时文件均由 `.vscodeignore` 排除。

## 5. 已知限制

- `typecheck` 在当前 JavaScript 项目中执行 CommonJS 语法和 JSON 合同检查，不等价于 TypeScript 类型检查；
- VS Code smoke/VSIX acceptance 需要本机 VS Code CLI，并且默认关闭；
- MVP 仍不提供 pack-local ID、Catalog、跨文件导航、GLSL 或运行时 Loader 诊断；
- VSIX 的静态 `fileMatch` 只覆盖约定目录，非约定 fragment 需要工作区 `json.schemas` 手工绑定。
