# Dawnlight Shader Pack VS Code Extension MVP-5 Test Report

状态：已完成  
日期：2026-08-16  
版本：0.1.0

## 1. 目标

MVP-5 只验证 Schema-first 扩展的静态编辑能力，不引入 Language Server、工作区索引、Catalog 协议或 C# 运行时分析器。

## 2. 自动化测试

### 2.1 单元测试

执行：

```powershell
npm test
```

内容：

- Ajv 验证最小包、ToonLab、options/resources/programs/passes fragment 和 Settings UI 有效 fixture；
- 验证错误类型、未知字段和非法 enum fixture 被拒绝；
- 验证四个 Schema、`package.json` 和 snippets 是合法 JSON；
- 使用 `vscode-json-languageservice` 验证 root 属性、resource kind、option impact、Settings widget 的补全；
- 验证 `$ref`、`oneOf`/union、`const` 值的 completion 结果；
- 验证 JSONC 注释场景仍可补全；
- 验证 JSON/JSONC 使用同一份 snippets；
- 验证静态 `fileMatch` 只覆盖约定目录，不匹配通用 `**/*.json`。

当前结果：`11 passed`。

### 2.2 真实 VS Code smoke test

执行：

```powershell
$env:DAWNLIGHT_RUN_VSCODE_TEST = '1'
$env:DAWNLIGHT_VSCODE_PATH = 'D:\Software\VSCode\Microsoft VS Code\bin\code.cmd'
npm run test:vscode
```

内容：

- 打开有效 root fixture，确认没有 Schema error；
- 打开错误类型 fixture，确认出现诊断；
- 在 `shaderpack.json` 中请求 completion，确认返回 `manifestVersion` 和 `fragments`。

该测试默认跳过，避免普通离线单元测试触发 VS Code 下载或启动图形进程。未设置 `DAWNLIGHT_RUN_VSCODE_TEST=1` 时，命令以成功状态退出并明确打印跳过信息。

## 3. 已知边界

- completion 单元测试使用独立的 JSON language service；真实 VS Code 测试只覆盖最小端到端路径；
- pack-local ID、Catalog ID、跨文件引用、GLSL 和运行时诊断仍不在 MVP 范围；
- `vscode-json-languageservice` 在 Windows 下对精确 `file://` `fileMatch` 的 glob 行为与 VS Code 宿主不同，测试使用等价的 `**/*.json` 隔离匹配，扩展自身仍使用 `package.json` 中的静态目录模式；
- schema 中未冻结的运行时扩展字段保持宽松，避免对现有 Dawnlight v3.1 资源产生误报。

## 4. 可复现命令

```powershell
npm install
npm test
npm run test:vscode
npm run package
```
