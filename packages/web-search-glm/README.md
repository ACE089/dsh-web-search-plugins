# 智谱联网搜索（web-search-glm）

适配 DeepSeek Harness Desktop **0.2.0-rc.2**。将现有 `web_search` 的搜索后端切到智谱 GLM Coding Plan Search MCP。聊天模型可以继续使用原来的厂商；搜索不再调用 DeepSeek 的辅助 Messages 接口。

本插件 `1.0.0` 仅面向上述旧版 Desktop，不适用于当前已升级的 DSH。新版适配将通过后续插件版本提供。

## 插件的作用

DSH 的聊天模型和联网搜索后端是两套独立配置。本插件注册 `glm-coding-plan` 搜索 provider，并通过包内配置让现有 `web_search` 使用它。模型发起搜索后，插件连接智谱 MCP，发现服务器提供的工具、执行查询，并把标题、摘要、日期和链接整理成 DSH 的来源列表。

适合希望使用智谱搜索、同时继续使用自己原有聊天模型的用户。启用后，搜索使用独立的智谱 Coding Plan 凭据和额度。

是否调用搜索仍由模型决定；希望增强主动查证行为时，可同时安装 `dsh-plugin-web-search-policy`。网页全文读取仍由 DSH 原来的 `web_fetch` 后端负责。

## 安装与配置

1. 从本仓库的 Releases 下载 `dsh-plugin-web-search-glm-1.0.0.tgz`。在 Desktop「插件 → 添加插件」中选择下载的文件，或粘贴该文件在自己电脑上的绝对路径；安装后立即启用。只有界面提示时才重启。Release 尚未发布时，可使用本地构建生成的同名包。
2. 打开「设置 → 插件 → 插件配置」，找到 `web-search-glm`（或「智谱联网搜索」）。在 `apiKey` 填写智谱 **Coding Plan** 的 API Key 并保存。不要将密钥填入 DeepSeek 搜索配置。
3. 也可以将 `apiKeyEnv` 指向已有 DSH 凭据（默认 `ZHIPU_API_KEY`），通过配置页面的凭据输入保存。仅在没有 DSH 凭据服务时才回退到启动环境；Finder 启动的桌面应用通常不会继承终端临时 export。
4. 发起新请求，例如「请联网搜索智谱最新公告，并附上来源链接」。返回结果应包含可点击的标题、摘要和 URL。

`apiKey` 是 secret 字段，设置页面会遮盖其值；非空的直接密钥优先于凭据引用。每次搜索重新读取当前配置和凭据，保存后的新请求会使用新值。

请在 DSH 的配置页面保存自己的密钥。仓库中的配置仅包含 `ZHIPU_API_KEY` 这一凭据引用；不要将真实密钥填进源码、示例 YAML 或提交到 Git。插件不会自动加载项目中的 `.env` 文件。

默认 MCP Endpoint：`https://open.bigmodel.cn/api/mcp/web_search_prime/mcp`。这里是完整 MCP 地址，与聊天 Endpoint、DeepSeek 的 `DEEPSEEK_SEARCH_BASE_URL` 无关。需要自定义时由用户在本插件 `endpoint` 字段选择受信的 HTTPS MCP 服务。

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `apiKey` | 空 | 直接填写自己的 Coding Plan API Key，作为 secret 保存；非空时优先使用 |
| `apiKeyEnv` | `ZHIPU_API_KEY` | 从 DSH 凭据库读取的名称；没有凭据服务时回退到启动环境 |
| `endpoint` | 上述 MCP HTTPS 地址 | 搜索 MCP 的完整地址 |
| `timeoutMs` | `55000` | 单次搜索总超时，单位毫秒，可配置范围 `100`–`300000` |

## 执行链路

原来：`模型 → web_search → ctx.web → deepseek-official → DeepSeek Messages + 原生搜索工具 → 来源`。

启用组合包后：`模型 → 同一个 web_search → ctx.web → glm-coding-plan → MCP initialize → tools/list → tools/call(webSearchPrime) → 规范化来源`。

插件使用官方 MCP TypeScript Client，支持 JSON 与 SSE 响应。先读取服务器公布的搜索工具和参数；支持 `webSearchPrime` / `web_search_prime`，按 schema 使用 `search_query` / `query`，仅当服务器声明数量参数时才发送数量。每个关键词使用独立 MCP 会话，工具调用不自动重试。DSH 默认一次最多 4 个关键词、合并最多 8 条来源，继续由原工具控制。

这里只发送该次搜索词和搜索参数，不发送完整聊天记录。HTTP 请求带智谱 Bearer Key，拒绝重定向，默认总超时 55 秒；取消请求或卸载 provider 会中止正在进行的搜索。结果只从结构化数据或 JSON 文本提取 HTTP(S) 来源，去重后交回 DSH，保留标题、摘要和日期。

## 与其他插件配合及恢复

- 可以与「联网主动查证 / web-search-policy」同时启用：该插件决定如何提示模型主动搜索，本插件提供实际搜索服务。
- `web_fetch` 仍使用 DSH 的 `http` 网页抓取 provider。本插件不接入智谱 Web Reader。
- 组合包将 `web` 的配置设为 `searchProvider: glm-coding-plan, fetchProvider: http`。原 DeepSeek provider 可以继续注册，但不会被选中，也不会因智谱失败自动回退。
- 停用或卸载**整个组合包**后，下次配置组合恢复之前的 provider。仅停用 `web-search-glm` 组件、却仍保留本包的 provider 选择，会得到 provider 缺失错误。
- 若你在 profile 或更高优先级 overlay 中手动指定了 `web`，它会覆盖组合包；应在自己的同一配置层将 `searchProvider` 设为 `glm-coding-plan`，并保留实际需要的 `fetchProvider`。

## 额度与错误

此服务属于智谱 Coding Plan 专属 MCP，需要有效套餐/密钥与剩余额度。DeepSeek 无余额不再影响本插件的搜索请求；智谱自身额度不足仍会失败。个人和团队套餐须按官方文档取得相应的 Key。

- 缺少密钥：先保存 `apiKey` 或凭据引用对应的值。
- HTTP 401/403：检查 Key、套餐权限及 Endpoint。
- HTTP 402/429 或 MCP 额度错误：检查智谱额度/限流，不会改用 DeepSeek。
- 结果格式无法识别：保留报错以便适配，不把失败伪装成“无结果”。

官方说明：[智谱联网搜索 MCP](https://docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server)。

## 构建与验证

开发入口为 `plugins/web-search-glm.mjs`。使用 Node.js 22+、npm 10+，从源码仓库根目录运行：

```bash
npm ci
npm run build:glm
npm test
```

输出为 `dist/dsh-plugin-web-search-glm-1.0.0.tgz`。构建只使用本仓库及其锁定的公开 npm 依赖，无需 `deepseek-harness` 源码或 DSH 安装。官方 MCP Client 与配置 schema 已打入单文件，安装时不需要额外下载运行依赖，不含任何 API Key。第三方许可见 `THIRD_PARTY_NOTICES.md`。

验证使用临时 profile 和本地 MCP fixture，检查 Desktop 同版 Loader、provider 路由、参数/结果、取消、超时与错误处理。没有有效智谱密钥时，这些检查不等于真实套餐的在线调用验收；安装后保存自己的 Key 再进行一次实际搜索即可确认账户链路。

## 许可证

本插件的原创代码采用 [MIT License](LICENSE)，Copyright (c) 2026 ACE089。
内置的第三方软件保留原许可证和版权声明，完整文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。这两个文件均包含在安装包中。
