# dsh 联网实现分析与主动搜索插件

当前安装目标：插件 **1.0.1**，DeepSeek Harness Desktop **0.2.1-rc.2**；已通过应用内置运行时的安装包与行为检查。

下文源码链接保留首次实现分析的基准 **0.2.0-rc.2**（标签 `dsh-v0.2.0-rc.2`，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`），用于解释规则来源。独立 CLI **0.1.0-rc.6** 是历史验证记录，不能替代当前 Desktop 的验证。当前版本的工具呈现仅有 `native` 和 `ptc`；同一进程内通过 scope 为不同 agent 选择模式。

## 已确认的调用链

```text
聊天模型决定调用 web_search({ queries: [...] })
  → dsh-tool-web：校验、查询并发、结果合并、引用呈现
  → ctx.web：选择配置的搜索 provider
  → 默认 web-search-deepseek：独立的 Messages API 模型请求
  → DeepSeek 原生 web_search_20250305
  → sources（URL、标题、可选摘录与日期）返回聊天模型

聊天模型调用 web_fetch({ url })
  → dsh-tool-web → ctx.web → web-fetch-http
  → 公共 HTTP(S) 页面 → 文本 / HTML 转 Markdown
```

这条链有两次决策：聊天模型先决定是否调用 dsh 工具，搜索辅助模型再执行原生搜索。提示插件主要改善第一次决策；如果辅助请求没有返回原生搜索结果块，现有 provider 会报错，不能把普通生成文本当成搜索成功。

源码入口：[`search.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/tool-web/src/search.ts)、[`web` 服务](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/web/src/index.ts)、[DeepSeek provider](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/web-search-deepseek/src/provider.ts)、[provider 配置和凭据](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/web-search-deepseek/src/index.ts)、[`fetch.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/tool-web/src/fetch.ts)、[HTTP 抓取 provider](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/web/web-fetch-http/src/provider.ts)。

默认搜索辅助请求使用 `https://api.deepseek.com/anthropic/v1/messages`、`deepseek-v4-flash`、最多 4096 输出 token 和 5 次原生搜索使用机会。这些是该版本代码的默认值，不代表端点当前一定接受请求，也不是用户实际配置值。`DEEPSEEK_SEARCH_BASE_URL` / `web-search-deepseek.baseURL` 与聊天端点独立；换聊天模型不会自动更换搜索后端。

凭据也要单独核对：聊天请求走 `deepseek-account` 时可复用账户登录 token；否则搜索使用配置的 DeepSeek API key，默认引用 `DEEPSEEK_API_KEY`。因此，给 MiMo 等聊天模型配好它自己的 key，并不等于默认 DeepSeek 搜索已经可用。

可以换用现有 Exa / Perplexity provider。`ctx.web` 在配置了 provider ID 时精确选择它；没有配置时要求恰好一个可用 provider，多个会报歧义错误。它不会自动做失败切换。

## 当前提示层的缺口

该版 `web_search` 的工具描述只有：

> Search the web for current information. Returns an optional summary answer and a list of source URLs.

对应 system section 主要说明“结果不可信、需要全文时抓取、引用 URL”；`web_fetch` section 也主要讲不可信数据和引用。**这些指引说明如何使用工具，没有建立明确的必查条件。**

| 情形 | dsh 0.2.0-rc.2 原始指引 | 本插件补充 |
|---|---|---|
| 时效性信息 | 泛称 current information | 信息可能变化时必须核实，即使没有“最新”关键词 |
| 事实不确定、冷门主题 | 没有明确触发规则 | 有实质疑虑就验证，拿不准是否需要验证时倾向查证 |
| 用户给出未读取链接 | 有抓取能力，没有明确必读要求 | 任务依赖页面内容时先读取；链接不是页面内容 |
| 明确要求搜索、核实、引文 | 没有系统化规则 | 明确列为触发条件 |
| 当前 API、软件版本 | 没有专门要求 | 先查本地版本，必要时核对官方资料 |
| 医疗、法律、财务和重大推荐 | 没有专门要求 | 给出相关建议前查当前权威资料 |
| 翻译、改写、稳定数学、本地自足任务 | 没有完整免查边界 | 避免无关搜索，尊重用户明确禁止联网 |

## Codex 的方法与可借鉴之处

在参考提交 `a9b0815167c27ab13719dd12d13b63e02b70d221` 中，**Codex 把主动联网规则直接写入工具描述并交给模型**。[`web_run_description.md`](https://github.com/openai/codex/blob/a9b0815167c27ab13719dd12d13b63e02b70d221/codex-rs/ext/web-search/web_run_description.md#L32)包含决策条件；[`tool.rs:43`](https://github.com/openai/codex/blob/a9b0815167c27ab13719dd12d13b63e02b70d221/codex-rs/ext/web-search/src/tool.rs#L43)用 `include_str!` 读取该文件，随后在第 71 行赋给 `ResponsesApiTool.description`，第 80–81 行声明 `ToolExposure::Direct`。只检查 `hosted_spec.rs` 会漏掉这条实现路径。

其描述同时提供调用示例、参数使用提示、必须搜索的条件、疑虑时倾向搜索的规则、引用格式和技术资料来源要求。对 dsh 最有价值的是让“何时查、如何调用、如何使用证据”成为工具说明自身完整表达的行为指引，而不只是写一句工具可以查询当前信息。

| 可借鉴的方法 | 本插件的适配 |
|---|---|
| 完整决策规则直接放入模型收到的工具描述 | `web_search.description` 自带全部查证条件，不依赖模型再去寻找 system 段 |
| 必查条件与疑虑时的默认选择分开说明 | 明确列出条件，同时要求拿不准是否该验证时倾向查证 |
| 工具用法示例与参数元数据都保留 | 根据真实 schema 给出 `queries` / `query` / `url` 示例，保留原参数描述与限制 |
| 搜索后继续规范来源与引用 | 技术事实使用一手资料，核实证据对应的时间，事实与推断分开，引用贴近结论 |
| 模型能在实际工具呈现方式中看到规则 | 原生调用看 description；纯 PTC / code 模式看 SDK 中补充的同一套规则 |

该实现路径是否启用仍受配置和模型/provider 能力控制。[`spec_plan.rs`](https://github.com/openai/codex/blob/a9b0815167c27ab13719dd12d13b63e02b70d221/codex-rs/core/src/tools/spec_plan.rs#L1217)检查相关能力与功能标志，选用 standalone 搜索时不再发 hosted search。这里需要区分两条路径，但这不改变工具描述确实承载主动搜索规则的事实。

适配保留 dsh 自己的能力范围：没有复制 `web.run` 的体育、金融、截图、引用 ID 或 `search_query/q` 参数，也没有照搬其中发空查询的建议。规则中的百分比用作启发式提示，不能据此认定模型有校准过的错误概率；本插件用“实质疑虑”和“倾向查证”表达这个方向。工具描述能引导选择，并不等于执行器强制联网。

## 插件做了什么

实现是独立的 [`web-search-policy.mjs`](web-search-policy.mjs)，使用 Cordis 的两个现有扩展点：

1. 通过 `systemPrompt.section()` 注册位置固定的简短提醒，默认 order 6400。
2. 在 `system-prompt/assemble` waterfall 中等待 `next()`，按本次最终可见工具，把完整策略放进 `web_search.description`；`web_fetch.description` 包含必读页面、读取限制和引用要求。只有抓取可用时，完整查证策略由它承载。
3. PTC 模式下，将同样的工具使用文档追加到 `tools:sdk` 后面，保持生成的类型声明原样。按本次 scope 的最终可见工具判断模式，PTC agent 不会改变同进程原生 agent 的工具说明。

没有替换工具 executor，也没有改参数、provider、凭据和权限。Desktop 0.2.1-rc.2 的 `queries` 数组保留原样；参数示例仍按工具 schema 生成。搜索和抓取独立可见；全部被会话限制隐藏时不注入策略。PTC 模式下从生成的 SDK 识别可用工具，提醒模型遵守 `run_code` 调用方式。

策略由同一函数生成，不含时间戳或随机值；同一工具集的重复装配保持一致，有利于前缀缓存。完整策略只保留在主要工具文档中，system 段为简短提醒，避免将全文同时复制到 system、搜索和抓取三处。新增文本仍会增加输入 token；实际金额取决于模型、缓存和新增搜索次数。

完整 system prompt 覆盖模式仍由 dsh 自己决定，它会移除一般 section。原生工具描述的完整查证规则仍然保留，不需要 system 提醒才能成立。纯 SDK 模式若其 SDK section 也被完整提示词覆盖，自然无法保留 SDK 补充文档。关闭 `enhanceToolDescriptions` 时，原工具描述和 SDK 保持原样，完整规则退回插件自己的 system section。

源码可核实这份描述进入请求的过程：[`agent.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/core/agent-loop/src/agent.ts)将装配后的 `assembly.tools` 交给 `buildRequest`；[DeepSeek serializer](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-deepseek/src/serialize.ts)和 [pi-ai 转换](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai/src/context.ts)都将 `tool.description` 映射给提供方工具定义。这里确认的是本地装配和序列化实现，没有捕获真实付费模型调用。

这是**行为提示增强**，没有强制工具选择，没有自动追加模型轮次，也不会根据“最新”“不确定”等正则拦截最终回答。它可以表达应查规则，不能保证模型执行；模型也不能可靠地报告一个可校准的“10% 记错概率”。

## 建议的优化顺序

**先补触发规则和核实后端可用性。** 已有工具足够完成第一阶段，单独增加一个搜索工具不会自然提高主动性。第三方聊天模型尤其需要检查搜索后端的独立凭据和端点。工具出现在列表里不代表网络或凭据已经通过验证。

**再改善取证质量。** 搜索用于发现，抓取用于读取；技术问题优先官方文档，引用需要落到支持对应事实的具体页面。HTTP 抓取不是带登录态或执行 JavaScript 的浏览器，当前结果类型也只有 HTML / text；复杂网页和 PDF 需要相应工具或明确说明读取限制。

**按证据决定是否改搜索实现。** 当前一次模型工具调用最多 4 个查询，合并后最多 8 个来源；DeepSeek 每个查询又是一个辅助模型请求。多查询中任一失败会取消其余查询、丢弃成功结果。这些成本和失败策略不是提示词可以修复的。需要保留部分成功结果、每查询域名或时间筛选、自动切换后端时，应另做 provider / 工具插件或上游修改，并显式定义其行为。

**最后才考虑运行时纠偏。** 如果真实模型评测仍频繁漏查，可以增加有次数上限、可记录原因的漏查提醒。用户文本的关键词不足以判定“必须搜索”，不适合直接做无限重试或强制续轮；同样不能把任何一次搜索都算成已经验证了全部结论。

## 启用方式

日常使用建议按 [安装说明](../packages/web-search-policy/README.md) 安装 `.tgz`。以下为开发时的手动挂载方式。

先将 [`web-search-policy.overlay.yml`](web-search-policy.overlay.yml) 复制为 `plugins/web-search-policy.local.yml`，将 `name` 中的 `/ABSOLUTE/PATH/TO/` 占位符替换为自己电脑上的实际路径。`*.local.yml` 已由 `.gitignore` 排除，不应提交到仓库。

Desktop 的专属 profile 是 `~/.dsh/profiles/desktop`，不是 `profiles/web`，见 [`apps/desktop/src/paths.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/src/paths.ts)。退出 Desktop 后，可将本地 overlay 中的 `- insert:` 整段追加到 `~/.dsh/profiles/desktop/cordis.patch.yml`，然后重新启动 Desktop。已有内容应保留，同一插件只挂载一次；目录移动后更新本地 overlay 中的绝对路径。撤销时移除该插件条目并重启。

独立 CLI 的临时试用命令（从仓库根目录运行，先完成本地 overlay 的路径替换）：

```sh
dsh --profile headless \
  --patch "$PWD/plugins/web-search-policy.local.yml" \
  "核实当前某个依赖的 API 用法，并给出官方来源"
```

命令中的 `dsh` 使用当前 PATH 中的独立 CLI，可用于兼容试用；Desktop 同版组件验证应使用对应应用的运行时。不要用旧 CLI 启动或管理 Desktop 专属 profile 的依赖。

配置仅有 `sectionOrder`（有限数值，默认 6400）和 `enhanceToolDescriptions`（布尔值，默认 true）；未知字段或类型错误会在加载时报错。

## 已执行验证与效果评测边界

[`web-search-policy.integration.mjs`](web-search-policy.integration.mjs) 使用真实 Cordis、SystemPrompt、Tools、Web 和 ToolWeb 组件，只有搜索外部服务用固定结果替代。测试覆盖完整规则确实进入工具描述、按版本匹配参数示例、原参数及 executor 保留、工具可见性、waterfall 委托、SDK 文档补充、重复装配稳定、卸载恢复、配置错误和原搜索结果返回。还检查原生描述在完整 system prompt 覆盖下依然携带必查规则，以及 scope 内的 PTC 模式不会改变原生 agent 或重复追加 SDK 说明。

当前验证记录：Desktop 应用实际打包的 **0.2.1-rc.2** 组件中 **13 项检查通过**；完整安装包验证还覆盖两个包的兼容性、离线安装和 Loader 激活/卸载。Desktop 验证在 Electron Node 模式运行测试，没有启动或修改用户的 Desktop profile。以下命令从仓库根目录运行；应用安装位置不同时，调整两个应用路径变量：

```sh
DSH_ELECTRON='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
DSH_RUNTIME_ROOT='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON" \
  "$PWD/plugins/web-search-policy.integration.mjs" \
  "$DSH_RUNTIME_ROOT"
```

目前的验证主要由维护者在本地环境完成，范围有限，严谨性和代表性仍有不足。这些检查覆盖插件接入行为，尚未系统验证真实搜索服务、不同模型与平台或长期使用场景，**没有通过严格对照评测测量主动搜索效果的提升**，不能作为完整兼容性、稳定性或效果保证。

欢迎在自己的本地项目中验证插件的实际表现。如遇到问题，或对查证规则有改进建议，欢迎通过仓库 Issues 反馈，一起探讨。
