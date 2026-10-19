# 开发与验证

## 独立构建

准备 Node.js 22+ 和 npm 10+。从本仓库根目录运行：

```bash
npm ci
npm run build
npm test
```

仅需本仓库和 npm registry 可下载的开发依赖。无需安装 DSH、克隆其源码，或配置智谱账户。

`npm ci` 使用提交的锁文件。更新依赖时，修改固定版本并重新生成锁文件，再执行构建、本地测试和下述 Desktop 集成检查。

生成物：

- `packages/web-search-policy/index.mjs`：从对应 `plugins/` 源码复制。
- `packages/web-search-glm/index.mjs`：包含 MCP 客户端和配置 schema 的 ESM bundle。
- `packages/*/LICENSE`：从根目录同步。
- `packages/web-search-glm/THIRD_PARTY_NOTICES.md`：从实际打包依赖的许可及 NOTICE 文件生成。
- `dist/*.tgz`：供 Desktop 安装的 npm 格式压缩包。

不要手工修改生成的入口文件。运行依赖已包含在 GLM bundle 中，包内没有安装脚本，安装时不会另外安装一套 DSH。

## 本地 provider 检查

```bash
npm test
```

`tests/web-search-glm.test.mjs` 检查构建后的 GLM 插件；`tests/fixtures/glm-mcp.mjs` 启动回环地址上的 MCP fixture。检查覆盖工具名和参数映射、JSON/SSE、来源去重与数量限制、HTTP/MCP 错误、重定向保护、取消、超时和密钥解析期间的配置变更。

这些测试无需 DSH，也无需真实密钥；不能替代真实服务在线验收。

## Desktop 集成检查

先安装目标版本 **DeepSeek Harness Desktop 0.2.1-rc.2**，并完成上述构建。以下为 macOS 示例，在仓库根目录运行；应用安装位置不同时调整两个变量。

验证必须使用 Desktop 内置运行时。`0.2.1-rc.2` 仅支持 `native` 和 `ptc` 工具模式；集成检查覆盖同进程内不同 scope 的模式隔离。

```bash
DSH_ELECTRON='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'
DSH_RUNTIME_ROOT='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
```

验证 Policy 与真实 DSH 工具注册表及 SDK 的配合：

```bash
ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON" \
  ./plugins/web-search-policy.integration.mjs "$DSH_RUNTIME_ROOT"
```

验证 GLM 与真实 Web 服务、Loader、凭据服务和 Policy 的配合：

```bash
ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON" \
  ./plugins/web-search-glm.integration.mjs "$DSH_RUNTIME_ROOT"
```

验证两个最终 `.tgz` 的离线安装、兼容性、实际 profile 合成、Loader 启停、设置表单和密钥遮盖，并从安装后的入口运行全部 23 项行为检查：

```bash
ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON" --expose-internals \
  ./scripts/validate-web-search-packages.mjs "$DSH_RUNTIME_ROOT" \
  ./dist/dsh-plugin-web-search-glm-1.0.1.tgz \
  ./dist/dsh-plugin-web-search-policy-1.0.1.tgz
```

省略两个压缩包参数时，脚本按本仓库 package manifest 中的版本选择 `dist/` 文件。验证使用 Desktop 内置 pnpm（`0.2.1-rc.2` 中位于 `runtime/primary-runtime/dependencies/pnpm`），不会用 PATH 上另一套 CLI 替代 Desktop。

这些脚本读取已安装 Desktop 的实际组件，在临时目录和本地 fixture 中检查行为，不修改使用者的 Desktop profile。普通系统 Node 无法直接读取 `app.asar`，需通过该 Desktop 的 Electron Node 模式执行。

对于其他系统，先定位对应应用的 Electron 可执行文件和 DSH 运行时目录，再传入同样参数；本项目未据此声明其他平台已通过验证。

## 真实账户验收

目前由维护者完成的本地验证范围有限，严谨性和代表性仍有不足。尚未完成真实账户、不同模型与平台及长期使用场景下的系统验证；本节描述可继续开展的验证，不代表这些验证已经完成。

在 Desktop 插件页面安装 `dist/` 中的包，保存自己的智谱 Coding Plan API Key，再发起一次明确要求搜索和附上来源的请求。检查工具轨迹、来源链接和失败信息。请在自己的环境中完成此步，密钥保存在 DSH 凭据或插件设置中。

如需评估 Policy 的效果，固定模型、推理设置和测试题，分别在关闭、启用 Policy 时使用新会话对照。记录搜索发生的时机、证据是否支持结论，以及延迟和调用成本；本地集成检查并未测量这些指标。
