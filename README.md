# DSH Web Search Plugins

为 **DeepSeek Harness Desktop** 提供智谱搜索后端与主动联网查证指引。两个插件可独立安装，也可配合使用，并沿用 DSH 现有的 `web_search`、`web_fetch` 工具。

## 选择插件

| 插件 | 用途 | 所需凭据 |
| --- | --- | --- |
| [GLM 搜索](packages/web-search-glm/README.md)（`dsh-plugin-web-search-glm`） | 将 `web_search` 的搜索后端切换为智谱 GLM Coding Plan Search MCP，返回标题、摘要和来源链接 | 智谱 Coding Plan API Key |
| [主动查证](packages/web-search-policy/README.md)（`dsh-plugin-web-search-policy`） | 增强工具说明，提示模型在信息可能变化、事实存疑或需要来源时主动搜索、读取网页并引用证据 | 插件本身无需密钥；搜索使用当前后端的凭据 |

想使用智谱搜索，安装 **GLM**；已有可用搜索后端、希望模型更主动查证，安装 **Policy**。同时安装时，Policy 提供查证指引，GLM 执行模型发起的搜索。聊天模型配置保持不变，网页全文仍由 DSH 的 `web_fetch` 读取。

## 兼容版本

| 插件版本 | 目标 DSH Desktop | 说明 |
| --- | --- | --- |
| **1.0.1** | **0.2.1-rc.2** | 当前版本，已通过 macOS Desktop 实际运行时验证 |
| 1.0.0 | 0.2.0-rc.2 | 旧版安装包 |

安装包声明精确的 DSH 版本要求。Desktop 升级到 `0.2.1-rc.2` 后，请将两个插件更新为 `1.0.1`；旧包会被兼容性检查拒绝加载。其他 Desktop 版本及平台尚未完成本版验证。

## 安装与更新

从 [Releases](https://github.com/ACE089/dsh-web-search-plugins/releases) 下载所需安装包：

| 安装包 | 功能 |
| --- | --- |
| `dsh-plugin-web-search-glm-1.0.1.tgz` | 智谱搜索后端 |
| `dsh-plugin-web-search-policy-1.0.1.tgz` | 主动查证指引 |

1. 打开 DSH Desktop「插件 → 添加插件」，选择下载的 `.tgz`，或粘贴文件在自己电脑上的完整路径。
2. 点击「安装」，完成后点击「立即启用」。已有旧版时，按插件管理器提示更新同名包并确认启用状态。仅在界面提示时重启应用。
3. 使用 GLM 时，打开「设置 → 插件 → 插件配置 → web-search-glm」，填写自己的智谱 **Coding Plan API Key** 并保存。也可通过 `apiKeyEnv` 引用 DSH 凭据，默认名称为 `ZHIPU_API_KEY`。
4. 发起新请求，例如：“请联网搜索智谱最新公告，并附上来源链接。”

安装包包含所需运行代码，无需安装 Node.js 或构建工具。Release 尚未提供所需版本时，可按下文从源码构建。

停用或卸载时，在插件页面操作整个插件包。GLM 仅停用内部组件、却保留本包的后端选择配置时，会出现 provider 缺失错误。若曾通过 YAML 手动挂载同一插件，应移除重复挂载。

完整配置和排错说明见 [GLM README](packages/web-search-glm/README.md) 与 [Policy README](packages/web-search-policy/README.md)。

## 使用边界

- Policy 通过提示引导模型，是否调用工具仍由模型决定，无法保证每次联网。
- GLM 搜索需要智谱套餐权限、有效密钥和可用额度；失败时报告错误，不会自动回退到 DeepSeek 搜索。服务要求见 [智谱联网搜索 MCP 文档](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server)。
- GLM 向配置的 MCP 服务发送搜索词和相关参数，不发送完整聊天记录。网页全文读取继续使用 DSH 原有后端。
- 两个插件均沿用 DSH 的工具入口和权限机制。

## 从源码构建

需要 **Node.js 22+、npm 10+**（`.nvmrc` 指定 Node.js 22）。在仓库根目录运行：

```bash
npm ci
npm run build
npm test
```

`npm ci` 按锁文件安装公开 npm 依赖，构建在 `dist/` 生成两个 `.tgz`。构建和本地测试均无需 DSH 安装、`deepseek-harness` 源码或真实 API Key。

也可以分别构建：

```bash
npm run build:policy
npm run build:glm
```

Policy 直接打包自包含源码；GLM 使用 esbuild 打入 MCP 客户端和配置 schema。两个包都包含项目及第三方许可，安装时无需额外下载运行依赖。

## 验证

`npm test` 检查构建后的 GLM 插件，包含 8 项本地 MCP 测试，覆盖工具发现、参数映射、JSON/SSE、来源规范化、超时、取消、密钥遮盖和重定向保护。

`1.0.1` 还通过 macOS Desktop `0.2.1-rc.2` 的实际运行时验证：使用内置 pnpm 将最终两个 `.tgz` 离线安装到临时 profile，检查版本兼容、配置合成、Loader 启停、设置表单与密钥遮盖，并从安装后的入口通过全部 **23 项行为检查**（8 项 MCP、13 项 Policy、2 项 GLM 集成检查）。命令见 [开发与验证说明](docs/development.md)。

目前的验证主要由维护者在本地环境完成，范围有限，严谨性和代表性仍有不足。测试使用假密钥和本地服务，尚未完成真实智谱账户、不同模型与平台、长期使用场景下的系统验证，也没有对主动搜索效果做严格的对照评测。上述检查只能说明已覆盖场景中的接入行为，不能作为完整兼容性、稳定性或效果保证。

欢迎在自己的本地项目中验证插件的实际表现。如遇到问题，或有改进建议，欢迎通过 [Issues](https://github.com/ACE089/dsh-web-search-plugins/issues) 反馈，一起探讨。

## 源码目录

```text
plugins/       手写源码、Desktop 集成检查及策略实现分析
packages/      两个安装包的元数据、配置、文档和生成的入口文件
scripts/       构建和安装包验证脚本
tests/         不依赖 DSH 安装的本地 MCP 测试与共享 fixture
docs/          开发环境及 Desktop 集成验证说明
dist/          生成的 .tgz；由 .gitignore 排除
```

修改 `plugins/web-search-glm.mjs` 或 `plugins/web-search-policy.mjs` 后重新构建。`packages/*/index.mjs` 为生成文件。策略的实现分析见 [web-search-policy.README.md](plugins/web-search-policy.README.md)。

## 许可证与凭据

原创代码和文档采用 [MIT License](LICENSE)，Copyright (c) 2026 ACE089。第三方材料保留原条款，完整声明入口见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。两个 `.tgz` 均包含项目许可证和各自的第三方声明。

请在 DSH 设置中保存密钥。`ZHIPU_API_KEY` 仅是凭据引用名，插件不会自动读取项目 `.env`。个人配置可使用被 Git 忽略的 `*.local.yml`；提交代码或发布安装包时，请勿包含真实凭据、本地 profile 或调试日志。
