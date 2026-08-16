# Dawnlight Shader Pack VS Code Extension MVP Plan

状态：Proposed  
编写日期：2026-08-16  
目标：第一版只实现稳定、低成本的 JSON 自动提示和自动补全  
关联总方案：[DawnlightShaderPackVsCodeExtensionImplementationPlan.md](DawnlightShaderPackVsCodeExtensionImplementationPlan.md)

## 1. MVP 定位

第一版不实现完整的 Dawnlight Language Server，而是做成一个 Schema-first 的 VS Code 扩展：

```text
VS Code 内置 JSON/JSONC Language Service
    <- JSON Schema
    <- Snippets
    <- package.json jsonValidation 配置
```

第一版的目标是让作者在编辑 Manifest 和 Settings UI 时立即获得：

- 属性名提示；
- 对象和数组结构提示；
- `type`、`kind`、`lifetime`、`format`、`widget`、`loadOp` 等固定枚举提示；
- 必填字段、类型和未知字段的即时诊断；
- 常用 root、fragment、resource、program、pass 和 settings UI 模板；
- 字段 Hover 说明、默认值和简单示例。

第一版不追求完整语义正确性，不处理跨文件符号和运行时 Catalog。

## 2. 为什么第一版不直接做 LSP

当前系统的完整体验确实需要跨文件索引和生产 Loader，但这些能力不是“最简单的自动提示和补全”的必要条件。

直接做 LSP 会同时引入：

- JSONC 容错 AST；
- fragment composition；
- workspace 多包发现；
- symbol/reference index；
- 文档版本和 stale request 控制；
- C# Analyzer 进程生命周期；
- Catalog Snapshot 协议；
- 生产诊断映射。

如果 Schema 尚未稳定，先实现 LSP 会把格式设计、解析器和编辑器协议绑定在一起，后续修改成本高。

MVP 应先验证两个问题：

1. 当前 P8/P9 JSON 结构能否被一套清晰的公共 Schema 表达；
2. 作者使用 Schema completion 和 snippets 是否已经能明显降低写包成本。

验证通过后，第二版再在现有 Schema 上增加跨文件动态能力。

## 3. MVP 范围

### 3.1 支持的文件

第一版支持以下路径约定：

```text
<pack-root>/shaderpack.json
<pack-root>/manifest/options/*.json
<pack-root>/manifest/resources/*.json
<pack-root>/manifest/passes/*.json
<pack-root>/manifest/programs/*.json
<pack-root>/manifest/ui/settings.json
```

这是对当前 Dawnlight v3.1 和 ToonLab 目录布局的支持，不是永久限制 Manifest composition 格式。

由于 VS Code 的 `jsonValidation.fileMatch` 是静态匹配，第一版不保证任意自定义 fragment 路径自动识别。作者使用非约定路径时，可以在工作区 `json.schemas` 中手工绑定 fragment Schema，或者等待第二版动态文档发现功能。

### 3.2 支持的编辑体验

| 能力 | MVP |
|---|---:|
| root Manifest 属性补全 | 是 |
| fragment 顶层数组补全 | 是 |
| Settings UI 属性补全 | 是 |
| 固定 enum/default/description | 是 |
| 对象和数组模板 | 是 |
| JSON/JSONC syntax validation | 使用 VS Code 内置能力 |
| Schema type/required/unknown property validation | 是 |
| pack-local ID 动态补全 | 否 |
| Semantic/Service/Provider Catalog 补全 | 否 |
| 跨文件跳转和引用 | 否 |
| C# 生产 Loader 诊断 | 否 |
| GLSL 补全 | 否 |
| Graph/variant/hot reload | 否 |

### 3.3 MVP 明确不做的事情

- 不扫描工作区；
- 不启动 Node Language Server 子进程；
- 不启动 `dotnet` 或游戏进程；
- 不读取或解释 `shaderpack.json` 的 `fragments` 以动态决定 Schema；
- 不校验 resource/program/pass ID 是否已经在其他文件声明；
- 不把当前 Dawnlight 的 Semantic、Service、Provider ID 写入 Schema enum；
- 不执行 shader 编译；
- 不修改用户文件；
- 不把不确定的运行时规则伪装成静态 Schema 规则。

## 4. 技术方案

### 4.1 扩展形态

MVP 可以是无运行时代码的 declarative VSIX：

- `package.json` 声明 `jsonValidation` 和 `snippets`；
- Schema 和 snippets 作为 VSIX 静态资源；
- 使用 VS Code 内置 JSON Language Service；
- 不需要 `extension.ts`、Language Client 或 sidecar。

如果需要提供“打开文档”“检查当前路径”等命令，再增加极薄的 `extension.ts`，但不要因此提前引入 LSP。

### 4.2 推荐依赖

MVP 运行时依赖保持为零。开发测试依赖：

```text
ajv
jsonc-parser
vscode-json-languageservice
@vscode/test-electron
@vscode/vsce
typescript（仅用于测试脚本或可选命令）
```

`vscode-json-languageservice` 用于 Node 测试和 completion snapshot，不在 VSIX 运行时重复替换 VS Code 自带服务。

### 4.3 目录结构

```text
dawnlight-core/
  docs/
  schemas/
    shaderpack-common.schema.json
    shaderpack-manifest-v3-root.schema.json
    shaderpack-manifest-v3-fragment.schema.json
    shaderpack-settings-ui-v1.schema.json
  snippets/
    shaderpack.code-snippets
  fixtures/
    valid/
      minimal/
      dawnlight-v3.1/
    invalid/
    snippets/
  package.json
  README.md
  CHANGELOG.md
  test/
    schema.test.ts
    completion.test.ts
    vscode-smoke.test.ts
  tsconfig.json
```

第一版不必创建 `packages/language-server`。等第二版需要跨文件语义时，再按总方案拆分 workspace packages。

## 5. JSON Schema 设计

### 5.1 Schema 文件职责

#### `shaderpack-common.schema.json`

放置所有可复用定义：

- ID 字符串；
- pack-relative path；
- version；
- option predicate；
- binding；
- semantic reference；
- ordering；
- size/format/sampling；
- clear/load/store/viewport；
- translation key；
- 常用数字范围和颜色向量。

公共定义不要声明当前包内的具体 ID。

#### `shaderpack-manifest-v3-root.schema.json`

覆盖：

- `sourceFormatVersion`；
- `manifestVersion`；
- `id`；
- `name`；
- `version`；
- `author`；
- `description`；
- `shaderRoot`；
- `settings`；
- `fragments`。

对于 composition root，禁止在 root 中直接提供 `options`、`resources`、`passes`、`programs`，避免作者误以为数组顺序可以跨 root 和 fragment 混合。

Schema 同时提供 single-file 兼容形态，或者在 root Schema 中使用 `oneOf` 表达两种合法模式：

```text
single-file root
  -> options/resources/passes/programs

composed root
  -> sourceFormatVersion + fragments
  -> no definition arrays
```

#### `shaderpack-manifest-v3-fragment.schema.json`

fragment 只允许：

```json
{
  "options": [],
  "resources": [],
  "passes": [],
  "programs": []
}
```

四个数组均可选，但空对象不应成为主要 snippets。fragment 禁止 metadata、`fragments` 和递归 include。

#### `shaderpack-settings-ui-v1.schema.json`

覆盖：

- `schemaVersion`；
- `defaultLocale`；
- `translations`；
- `pages`；
- `hiddenOptions`；
- page/group/control；
- `toggle`、`choice`、`slider` 等 widget；
- `visibleWhen` 和 `enabledWhen` 的结构。

MVP 只校验 predicate 结构，不验证 predicate 引用的 option 是否存在。

### 5.2 Schema 约束原则

每个公开字段应尽量包含：

```json
{
  "description": "...",
  "default": "...",
  "examples": ["..."],
  "markdownDescription": "..."
}
```

第一版使用 Draft-07，以兼容 VS Code 内置 JSON Language Service；待后续 Schema 校验工具链统一后，再评估迁移到 Draft 2020-12。

推荐使用：

- Draft-07；
- `$id`；
- `definitions`；
- `oneOf`；
- `const`；
- `if/then/else`；
- `additionalProperties: false`。

注意：`unevaluatedProperties: false` 会显著提高合同严谨性，但必须确认所有合法字段都已写入 Schema。任何尚未冻结的运行时扩展字段，不应在 MVP 中私自加入。

### 5.3 动态 ID 的处理

MVP 不应该这样写：

```json
{
  "enum": [
    "dawnlight:scene_target",
    "dawnlight:point_lights",
    "dawnlight:camera/view_matrix"
  ]
}
```

原因：

- 这些 ID 属于当前 Catalog，不属于固定 JSON 语法；
- 第三方 Mod 可以注册新的 ID；
- 版本变化会让静态 enum 过期；
- Schema 会错误地拒绝合法的外置扩展。

MVP 对动态引用使用：

```json
{
  "type": "string",
  "pattern": "^[a-z0-9][a-z0-9_-]*:[^\\s]+$"
}
```

如果某个 ID 格式尚未完全冻结，宁可只使用 `type: string`，不要用过窄正则制造误报。

### 5.4 JSONC 行为

当前生产 Loader 允许注释和尾随逗号，因此 MVP 必须以 JSONC 方式测试：

```jsonc
{
  // author comment
  "manifestVersion": 3,
  "fragments": [
    "manifest/options/clouds.json",
  ],
}
```

Schema 本身仍是标准 JSON；JSONC 解析由 VS Code 内置 JSON 服务处理。

## 6. VS Code package.json 配置

### 6.1 最小 Manifest

建议结构：

```json
{
  "name": "dawnlight-shader-pack-tools",
  "displayName": "Dawnlight Shader Pack Tools",
  "description": "JSON authoring support for Dawnlight shader packs.",
  "version": "0.1.0",
  "publisher": "<publisher>",
  "engines": {
    "vscode": ">=1.90.0"
  },
  "categories": [
    "Programming Languages",
    "Snippets"
  ],
  "contributes": {
    "jsonValidation": [],
    "snippets": []
  }
}
```

VS Code 最低版本应在实际测试后确定，不要在没有测试的情况下使用过高版本要求。

### 6.2 Schema 关联

MVP 使用静态目录约定，因此 `contributes.jsonValidation` 直接绑定：

```json
{
  "contributes": {
    "jsonValidation": [
      {
        "fileMatch": ["**/shaderpack.json"],
        "url": "./schemas/shaderpack-manifest-v3-root.schema.json"
      },
      {
        "fileMatch": [
          "**/manifest/options/*.json",
          "**/manifest/resources/*.json",
          "**/manifest/passes/*.json",
          "**/manifest/programs/*.json"
        ],
        "url": "./schemas/shaderpack-manifest-v3-fragment.schema.json"
      },
      {
        "fileMatch": ["**/manifest/ui/settings.json"],
        "url": "./schemas/shaderpack-settings-ui-v1.schema.json"
      }
    ]
  }
}
```

如果 VS Code 对多个 JSON Schema 的匹配合并行为在实际版本中产生重复诊断，优先保持目录匹配互斥，不要依赖匹配顺序解决问题。

### 6.3 Snippet 关联

建议同时为 `json` 和 `jsonc` 注册 snippets：

```json
{
  "contributes": {
    "snippets": [
      {
        "language": "json",
        "path": "./snippets/shaderpack.code-snippets"
      },
      {
        "language": "jsonc",
        "path": "./snippets/shaderpack.code-snippets"
      }
    ]
  }
}
```

Snippet 只提供结构起点，不复制完整 Dawnlight v3.1 Manifest。

## 7. Snippet 设计

### 7.1 必须提供的 snippets

根 Manifest：

- `dawnlight-root-single`；
- `dawnlight-root-composed`。

Fragment：

- `dawnlight-options-fragment`；
- `dawnlight-resources-fragment`；
- `dawnlight-programs-fragment`；
- `dawnlight-passes-fragment`。

常用定义：

- `dawnlight-option-boolean`；
- `dawnlight-option-number`；
- `dawnlight-option-choice`；
- `dawnlight-texture2d`；
- `dawnlight-texturecube`；
- `dawnlight-buffer`；
- `dawnlight-graphics-program`；
- `dawnlight-compute-program`；
- `dawnlight-fullscreen-command`；
- `dawnlight-compute-command`；
- `dawnlight-copy-command`；
- `dawnlight-clear-command`；
- `dawnlight-present-command`；
- `dawnlight-history-commit-command`；
- `dawnlight-settings-page`；
- `dawnlight-settings-group`；
- `dawnlight-toggle-control`；
- `dawnlight-choice-control`；
- `dawnlight-slider-control`。

### 7.2 Snippet 设计原则

- placeholder 顺序符合作者填写顺序；
- 第一处 placeholder 是最有区分度的字段，例如 `id` 或 `type`；
- 不填入真实 Dawnlight 业务 ID；
- 不填入可能失效的 Service/Semantic/Provider ID；
- 提供合法但最小的对象；
- 对可选数组使用空数组而不是省略，只有在语义明确时才省略；
- `description`、`author` 等非核心字段不要阻塞主流程；
- 插入后必须仍能通过 Schema validation；
- snippets 只负责结构，不负责解释复杂 Hazard。

### 7.3 根 Manifest snippet 示例

```json
{
  "sourceFormatVersion": 1,
  "manifestVersion": 3,
  "id": "${1:example:my_pack}",
  "name": "${2:My Shader Pack}",
  "version": "${3:0.1.0}",
  "shaderRoot": "${4:shaders}",
  "fragments": [
    "${5:manifest/programs/main.json}",
    "${6:manifest/resources/main.json}",
    "${7:manifest/passes/main.json}"
  ]
}
```

Snippet 中的 example ID 只应作为占位符，不应被 Schema 误认为有效或官方 ID。

## 8. 实现步骤

### MVP-0：确认范围和 fixture

任务：

1. 确认第一版只支持静态目录约定；
2. 从 Dawnlight v3.1 复制最小、脱敏的 root/fragment/settings fixture；
3. 从 ToonLab 提取至少一个 option、resource、program、pass 和 settings fixture；
4. 创建 BuiltIn/Minimal 空 UI fixture；
5. 创建未知字段、错误类型、缺少必填字段和非法 enum 负例；
6. 记录当前 Loader 允许的注释和尾随逗号行为；
7. 不把完整 shader 源码和大型 asset 放进插件测试 fixture。

输出：

```text
fixtures/valid/minimal/
fixtures/valid/dawnlight-v3.1/
fixtures/valid/toonlab/
fixtures/invalid/unknown-property/
fixtures/invalid/wrong-type/
fixtures/invalid/missing-required/
fixtures/invalid/invalid-enum/
fixtures/completion/
```

验收：

- 每个 fixture 的用途和预期结果写在同名 README 或测试表中；
- 不依赖游戏运行或 OpenGL；
- 结构覆盖 root、四种 fragment 数组和 Settings UI。

### MVP-1：初始化扩展项目

任务：

1. 创建 `package.json`；
2. 配置 `engines.vscode`；
3. 加入 `jsonValidation` 和 `snippets` contribution；
4. 加入 `.vscodeignore`，排除测试、源 fixture 和构建临时目录；
5. 添加 `README.md`、`CHANGELOG.md` 和许可证；
6. 配置 VSIX 打包脚本；
7. 在本机安装开发 VSIX，确认扩展可以被发现。

验收：

- VS Code Extensions 面板可以看到扩展；
- 安装扩展后不出现 activation error；
- 普通 JSON 文件不显示 Dawnlight 专用错误。

### MVP-2：实现 Common Schema

任务：

1. 建立 `$id` 和 `$schema`；
2. 添加 ID/path/version 基础定义；
3. 添加 option、predicate、impact；
4. 添加 program define/binding/semantic reference 的局部结构；
5. 添加 resource size/format/sampling/content；
6. 添加 target/viewport/clear/load/store；
7. 添加 settings translation/condition 基础定义；
8. 为每个字段补齐 description、default、examples；
9. 以 `additionalProperties: false` 开始，所有未知字段都通过测试后再放宽；
10. 使用 `definitions` 避免四个 Schema 复制结构。

验收：

- Common Schema 自身通过 meta-schema；
- `$ref` 不包含失效 URI；
- 各字段 Hover 有可读说明；
- 负例能够指出字段附近的错误。

### MVP-3：实现 Root、Fragment 和 Settings Schema

任务：

1. 实现 root single/composed `oneOf`；
2. 实现 fragment 顶层四个数组；
3. 实现 graphics/compute Program union；
4. 实现 resource kind union；
5. 实现七种 command union；
6. 实现 stage、services、programs、commands、inputs、outputs；
7. 实现 Settings UI schema v1；
8. 固定静态 `fileMatch` 目录约定；
9. 验证当前 Dawnlight/ToonLab fixture；
10. 对无法表达的跨文件规则写入 Schema description 的“运行时校验”说明。

验收：

- root、options、resources、programs、passes、settings 文件均可触发补全；
- `kind/type/widget/lifetime` 提示正确；
- graphics/compute 和各 command union 不互相混淆；
- 当前有效 fixture 无 Schema error；
- 负例的错误类型和错误 enum 可以被发现。

### MVP-4：实现 Snippets

任务：

1. 创建 `snippets/shaderpack.code-snippets`；
2. 添加 root/fragment/UI 顶层 snippets；
3. 添加 option/resource/program/command/UI control snippets；
4. 为 JSON 和 JSONC 注册同一份 snippets；
5. 插入后立即运行 Schema 测试；
6. 在 VS Code 中逐个测试 placeholder 顺序；
7. 删除会引入当前 Dawnlight 专用 ID 的 snippets。

验收：

- 新建空 JSON/JSONC 后可以用关键词插入最小对象；
- Tab 顺序合理；
- 插入结果不产生明显 Schema 错误；
- snippet 名称和 description 能帮助作者选择正确结构。

### MVP-5：自动化测试

任务：

1. 使用 Ajv 验证所有 valid/invalid fixture；
2. 使用 `vscode-json-languageservice` 测试 property/value completion；
3. 编写 completion caret fixture；
4. 测试 `$ref`、`oneOf`、`const` 的 completion 行为；
5. 使用 `@vscode/test-electron` 做一次真实 VS Code smoke test；
6. 测试 JSON 和 JSONC 两种语言模式；
7. 测试静态 `fileMatch` 不误伤普通文件；
8. 每次 Schema 修改都输出 fixture 统计。

建议的 caret fixture：

```jsonc
{
  "manifestVersion": |
}
```

```jsonc
{
  "kind": "texture2D",
  "format": |
}
```

```jsonc
{
  "type": "|
}
```

测试应断言候选 label、detail、insertText 和错误数量，而不是只断言“有候选”。

### MVP-6：打包和验收

任务：

1. 运行 lint/typecheck/test；
2. 运行 VSIX package；
3. 在干净 VS Code profile 安装 VSIX；
4. 打开最小包、Dawnlight v3.1 片段和 ToonLab 片段；
5. 检查自动提示、补全、Hover 和错误下划线；
6. 检查普通 `.json` 不受影响；
7. 检查离线环境仍能工作；
8. 记录安装包文件清单和版本；
9. 更新 README 快速开始；
10. 发布 `0.1.0` 内部测试版。

## 9. 测试矩阵

| 场景 | 期望 |
|---|---|
| `shaderpack.json` 根目录文件 | 使用 root Schema |
| `manifest/options/*.json` | 使用 fragment Schema，option 顶层可补全 |
| `manifest/resources/*.json` | 使用 fragment Schema，resource kind 可补全 |
| `manifest/programs/*.json` | 使用 fragment Schema，graphics/compute 可补全 |
| `manifest/passes/*.json` | 使用 fragment Schema，command type 可补全 |
| `manifest/ui/settings.json` | 使用 Settings UI Schema |
| JSON 注释 | 不产生语法错误 |
| 尾随逗号 | 不产生语法错误 |
| 普通 JSON | 不应用 Dawnlight Schema |
| 未知 pack-local resource ID | MVP 不报告跨文件错误 |
| 未知 Semantic ID | MVP 不报告 Catalog 错误 |
| 错误 `format` enum | 立即报告 Schema 错误 |
| 错误 `widget` enum | 立即报告 Schema 错误 |
| 缺少必填字段 | 立即报告 Schema 错误 |
| 新增未约定路径 fragment | 文档说明需手工 Schema 绑定 |

## 10. 质量标准

### 10.1 正确性

- 当前有效 fixture 不产生 error；
- 所有 Schema enum 都来自已冻结的公共 JSON 合同；
- 不把 Catalog 动态 ID 误写成静态 Schema 合同；
- Schema 只校验它能够确定的局部规则；
- 对跨文件和运行时规则明确标注“由后续 Analyzer 校验”。

### 10.2 性能

MVP 没有自定义常驻进程，因此性能目标主要由 VS Code JSON Language Service 决定：

- 打开一个当前规模 fragment 后 1 秒内出现补全；
- 输入字段时没有明显卡顿；
- Schema 文件总大小和 `$ref` 深度保持可控；
- 不在 Schema 中重复展开大型定义；
- 不将完整 Dawnlight Manifest 放进 completion enum；
- VSIX 安装包不包含引擎、shader 源码或大型纹理。

### 10.3 兼容性

- 目标格式固定为 Manifest v3 和 Settings UI v1；
- Schema 的 `$id`、版本和变更记录必须稳定；
- 对不支持的 manifestVersion 显示清晰错误；
- 不通过远程 URL 获取 Schema；
- VSIX 离线可用；
- 与 VS Code 内置 JSON/JSONC 语言模式共存，不覆盖用户其他 JSON Schema。

## 11. 第一版 README 快速开始内容

README 至少说明：

1. 安装 VSIX；
2. 将工作区打开到光影包或其父目录；
3. 推荐的目录布局；
4. 支持的三个 JSON Schema 角色；
5. 如何使用 root/fragment/settings snippets；
6. 第一版不提供跨文件 ID 和 Catalog 补全；
7. 非约定 fragment 路径如何通过 `json.schemas` 手工绑定；
8. Manifest 语法错误与运行时错误的区别；
9. 当前支持的 VS Code 版本；
10. 如何报告 Schema 错误。

示例工作区设置：

```json
{
  "json.schemas": [
    {
      "fileMatch": ["custom-fragments/*.json"],
      "url": "./path/to/shaderpack-manifest-v3-fragment.schema.json"
    }
  ]
}
```

## 12. 从 MVP 升级到第二版的触发条件

满足以下任一条件，就应进入自定义 Language Server 规划：

- 作者开始频繁需要输入 pack-local ID；
- 当前静态目录约定无法覆盖第三方包布局；
- Catalog ID/version 补全成为主要需求；
- 作者需要定义跳转、查找引用或重命名；
- Schema 无法表达的错误大量出现；
- 需要保存后自动调用生产 Loader；
- 需要同时支持多个包并避免 ID 串包；
- 需要对未保存文档提供完整 Manifest 诊断。

第二版应复用 MVP 的 Schema 和 snippets，不应推翻重写。新增内容应是：

```text
MVP Schema/snippets
    + workspace pack discovery
    + cross-file symbol index
    + Catalog Snapshot
    + C# Analyzer protocol
    + dynamic completion/navigation
```

## 13. 最终验收清单

第一版只有同时满足以下条件才算完成：

- [x] `shaderpack.json` 能使用 root Schema 自动提示；
- [x] options/resources/programs/passes fragment 能使用 fragment Schema 自动提示；
- [x] `manifest/ui/settings.json` 能使用 Settings UI Schema 自动提示；
- [x] `type/kind/widget/lifetime/format/command` 等 enum 有补全；
- [x] 常用对象有 snippets；
- [x] JSON 和 JSONC 都能工作；
- [x] 必填、类型、unknown property 和 enum 错误有即时诊断；
- [x] 当前 Dawnlight v3.1、ToonLab 和 Minimal fixture 通过；
- [x] 普通 JSON 不被误应用 Dawnlight Schema；
- [x] 不依赖 .NET、游戏运行或网络；
- [x] VSIX 可在干净 VS Code profile 安装；
- [x] README 说明静态目录限制和 MVP 不支持项；
- [x] 测试断言具体 completion 候选，而不是只断言服务已启动；
- [x] 版本、Schema `$id`、CHANGELOG 和安装包内容已记录。

## 14. 建议的第一批提交

建议将 MVP 拆成以下小提交：

1. `Scaffold declarative Dawnlight VS Code extension`；
2. `Add common shader-pack JSON definitions`；
3. `Add Manifest v3 root and fragment schemas`；
4. `Add Settings UI v1 schema`；
5. `Add shader-pack authoring snippets`；
6. `Add schema and completion fixture tests`；
7. `Add VS Code smoke test and package metadata`；
8. `Record MVP acceptance evidence`。

每个提交都应保持扩展可以打包，最后一个提交只负责验收记录和文档，不集中补写所有测试。
