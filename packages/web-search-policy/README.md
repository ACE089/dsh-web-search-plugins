# 主动联网查证插件

包名：`dsh-plugin-web-search-policy`；插件版本：`1.0.0`；目标桌面版：DeepSeek Harness Desktop `0.2.0-rc.2`。

本插件 `1.0.0` 仅面向上述旧版 Desktop，不适用于当前已升级的 DSH。新版适配将通过后续插件版本提供。

## 插件的作用

当问题涉及最新消息、可能变化的事实、陌生领域、明确核实要求或未读取的网页时，模型需要知道何时调用搜索和页面读取工具。本插件把这些判断规则加入实际可见的工具说明，同时补充来源选择和引用要求。

它适合“搜索功能已经可用，但模型需要更主动查证”的场景。插件本身不需要 API Key；发起搜索后，仍使用当前后端的服务和凭据。如果希望由智谱执行这些搜索，可同时安装 `dsh-plugin-web-search-glm` 并配置自己的智谱密钥。

插件通过提示引导模型，无法保证每个问题都会调用工具；它本身不提供搜索服务，也不能修复当前搜索后端的密钥、额度或网络错误。

## 手动安装

1. 从本仓库的 Releases 下载 `dsh-plugin-web-search-policy-1.0.0.tgz`。Release 尚未发布时，可从仓库根目录运行 `npm run build:policy`，使用 `dist/` 中生成的同名包。
2. 打开 DSH Desktop，在侧边栏进入「插件」，点击「添加插件」。选择下载的文件，或将该文件在自己电脑上的绝对路径完整粘贴到安装输入框，不要额外添加引号。
3. 点击「安装」，完成后点击「立即启用」。如果界面提示需要重启，完全退出 DSH Desktop 后重新打开。
4. 在插件列表确认该组合包已启用。停用或卸载可在同一插件页面操作。

此包包含独立插件代码和 `dsh.bundle.patch`，移动或删除开发仓库不会影响已安装的代码。它没有安装脚本或运行时依赖，不会另外安装一套 dsh；兼容性声明由当前 Desktop 运行时满足。若曾通过 YAML 手动挂载 `web-search-policy`，先移除那一条挂载，再通过包启用，避免同名插件重复加载。

## 行为

- 在 `web_search` 工具描述中加入完整查证规则：信息可能变化、事实不确定、未读链接、明确搜索要求、重大建议等情况要求先查证。
- 强化页面读取与引用要求，技术事实优先一手资料；拿不准是否需要验证时倾向查证。
- 原生工具、仅搜索、仅抓取以及 PTC / code SDK 模式按实际可见工具生成说明。
- 保留原有搜索工具参数、执行器、搜索后端、凭据和权限；插件通过提示影响模型的调用决定，不强制发起网络请求。

该插件本身不提供搜索服务。搜索依赖 DSH 原来配置的后端及其可用凭据，模型主动搜索率的提升需实际对照观察。

## 默认配置

```yaml
sectionOrder: 6400
enhanceToolDescriptions: true
```

`sectionOrder` 决定简短 system 提醒的位置；`enhanceToolDescriptions` 控制工具描述及 SDK 使用文档增强。关闭描述增强时，完整规则退回插件自己的 system 段。

## 从源码构建

使用 Node.js 22+、npm 10+，在源码仓库根目录运行：

```bash
npm ci
npm run build:policy
```

输出为 `dist/dsh-plugin-web-search-policy-1.0.0.tgz`。Policy 的实现是自包含 ESM，构建脚本复制源码并生成安装包，无需 DSH 源码、运行时安装或真实密钥。与实际 Desktop 工具注册表及 SDK 的集成检查使用已安装的目标版本应用执行，命令见源码仓库的 `docs/development.md`。

## 包内容

`package.json` 声明组合包和 Desktop 版本要求；`cordis.patch.yml` 挂载插件；`index.mjs` 是自包含 ESM 实现；`README.md` 为本说明。包内同时包含 `LICENSE` 和 `THIRD_PARTY_NOTICES.md`。无需编译或下载额外模块。

## 许可证

本插件的原创代码采用 [MIT License](LICENSE)，Copyright (c) 2026 ACE089。
查证规则参考并改写了 Apache-2.0 许可的 OpenAI Codex 工具说明；上游来源、改写说明及完整许可文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。第三方材料继续遵守其原许可证。
