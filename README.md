# DSH Web Search Plugins

为 **DeepSeek Harness Desktop** 提供两个可以独立安装的插件：使用智谱 GLM Coding Plan 执行搜索，以及引导模型主动联网查证。

## 两个插件分别解决什么问题

| 插件 | 作用 | 适合的需求 | 所需凭据 |
| --- | --- | --- | --- |
| [`dsh-plugin-web-search-glm`](packages/web-search-glm/README.md) | 将现有 `web_search` 的后端切换为智谱搜索 MCP，返回标题、摘要和来源链接 | 想使用智谱提供搜索，同时继续使用自己原来的聊天模型 | 自己的智谱 Coding Plan API Key |
| [`dsh-plugin-web-search-policy`](packages/web-search-policy/README.md) | 在工具说明中补充“何时搜索、何时读网页、如何引用来源”的规则，提示模型主动查证 | 已有可用搜索后端，希望模型在需要外部证据时更主动使用工具 | 插件本身无需密钥；实际搜索使用当前后端的凭据 |

**GLM 插件负责提供搜索服务，Policy 插件负责提示模型何时以及如何查证。**

- 只安装 GLM：搜索请求交给智谱处理；是否调用搜索仍由模型决定。
- 只安装 Policy：保留当前搜索后端，用提示规则引导模型主动查证；原后端需要已经配置可用。
- 同时安装：Policy 引导模型调用 `web_search`，GLM 将这次请求交给智谱 MCP，结果交回 DSH 呈现。

例如，面对“核实某个依赖当前推荐的 API 用法，并提供官方来源”，Policy 提示模型核对版本、搜索并阅读资料；模型发起搜索后，GLM 执行请求并返回来源。

```text
用户问题 → 聊天模型（Policy 提供查证指引）
         → DSH web_search → GLM 插件 → 智谱搜索 MCP → 来源列表
         → DSH web_fetch → 原有 HTTP 网页读取后端 → 页面内容
```

Policy 通过提示影响模型的选择，无法保证每次都联网；GLM 提供搜索能力，保留原有聊天模型配置。两个插件均沿用 DSH 的工具入口和权限机制。GLM 出错会报告失败，不会自动切换回 DeepSeek 搜索。

## 兼容版本

- 插件版本：两个包当前均为 `1.0.0`。
- 安装目标：**DeepSeek Harness Desktop `0.2.0-rc.2`**，包内声明精确版本要求。
- 本版面向上述旧版本，不适用于当前已升级的 DSH。新版适配将在本仓库的后续插件版本中维护。
- 旧 CLI 的策略兼容记录不代表完整安装包兼容。

## 下载与安装

1. 从本仓库 **Releases** 下载需要的 `.tgz`。源码构建方式见下一节。
2. 在 DSH Desktop 的「插件 → 添加插件」中选择下载的文件，或粘贴该文件在自己电脑上的绝对路径。
3. 安装后点击「立即启用」；仅在界面提示时重启应用。
4. 如果安装 GLM，打开「设置 → 插件 → 插件配置 → web-search-glm」，填写自己的智谱 Coding Plan API Key 并保存。
5. 发起一次新请求，例如“请联网搜索智谱最新公告，并附上来源链接”。

安装包名称：

```text
dsh-plugin-web-search-glm-1.0.0.tgz
dsh-plugin-web-search-policy-1.0.0.tgz
```

安装包已包含插件需要的运行代码和许可文件，使用者无需在电脑上安装构建工具。GLM 的服务权限和额度由智谱账户提供，详见 [智谱联网搜索 MCP 文档](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server)。

停用或卸载时，在 DSH 的插件页面操作整个插件包。详细配置、错误说明及 provider 恢复行为见各插件 README。

## 从源码构建

构建环境：**Node.js 22 或更高版本、npm 10 或更高版本**。`.nvmrc` 指定 Node.js 22；使用 nvm 时可先运行 `nvm use`。

下载或克隆本仓库后，在仓库根目录运行：

```bash
npm ci
npm run build
npm test
```

`npm ci` 按本仓库 `package-lock.json` 安装固定依赖；首次安装需要连接 npm registry。构建会在 `dist/` 生成两个 `.tgz`，测试会使用本地 MCP fixture 验证构建后的 GLM 插件。

构建依赖全部由本仓库的 `devDependencies` 声明：

| 依赖 | 固定版本 | 用途 |
| --- | --- | --- |
| `esbuild` | `0.28.1` | 将 GLM 插件及其运行依赖打包为单个 ESM 文件 |
| `@modelcontextprotocol/client` | `2.0.0` | 官方 MCP 客户端，处理连接、工具发现与搜索调用 |
| `@deepseek-ai/schemastery` | `3.18.4` | 与目标 DSH 兼容的插件配置 schema |
| `@deepseek-ai/cosmokit` | `1.8.5` | 固定配置 schema 所用的底层工具库版本 |

这些库从公开 npm registry 安装到本仓库的 `node_modules/`。构建只读取本仓库文件和这些依赖，**无需克隆、复制或编译 `deepseek-harness` 源码**，也不需要本机安装 DSH 或配置智谱密钥。

也可以分别构建：

```bash
npm run build:policy
npm run build:glm
```

Policy 是自包含 ESM 文件，打包脚本复制其源码。GLM 由 esbuild 打包，依赖的完整许可文本根据实际构建输入生成。两个脚本都会将根目录 `LICENSE` 同步到包内，再调用 `npm pack --ignore-scripts` 生成安装包。

## 测试与已知限制

`npm test` 需要先完成构建，运行 8 项本地检查，覆盖 MCP 工具参数发现、JSON/SSE 响应、结果规范化、超时与取消、密钥遮盖及重定向保护。测试使用假密钥和回环地址，不会请求智谱付费服务。

需要检查真实 DSH 的路由、Loader、设置页面和插件卸载行为时，使用已安装 Desktop 的运行时执行集成检查，命令见 [开发与验证说明](docs/development.md)。集成验证与源码构建分别进行，均不要求复制 DSH 源码。

这些检查验证实现和接入行为，不等于真实套餐的在线调用验收，也不测量模型主动搜索率的提升。真实使用仍取决于模型、搜索服务权限、额度和网络状态。

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

在 DSH 的配置页面保存自己的密钥。仓库中的 `ZHIPU_API_KEY` 是凭据引用，插件不会自动读取项目 `.env`。个人 overlay 使用被忽略的 `*.local.yml`；提交前检查文件，避免将真实凭据和本地 profile 加入 Git。
