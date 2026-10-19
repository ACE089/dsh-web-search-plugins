/** Zhipu Coding Plan Search MCP -> the existing DSH web search provider seam. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import z from '@deepseek-ai/schemastery'

export const name = 'web-search-glm'
export const inject = ['web']
export const GLM_PROVIDER_ID = 'glm-coding-plan'
export const GLM_DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
export const GLM_DEFAULT_KEY_REF = 'ZHIPU_API_KEY'

export const Config = z.object({
  apiKey: z.string().role('secret').description('智谱 Coding Plan API Key；也可使用下方凭据引用。').volatile(),
  apiKeyEnv: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).role('credential-ref')
    .default(GLM_DEFAULT_KEY_REF).description('从 DSH 凭据库或启动环境读取；每次搜索重新解析。').volatile(),
  endpoint: z.string().default(GLM_DEFAULT_ENDPOINT)
    .description('完整的 Streamable HTTP MCP 地址；与聊天模型 Endpoint 独立。').volatile(),
  timeoutMs: z.number().step(1).min(100).max(300000).default(55000)
    .description('一次搜索的总超时，包含连接、工具发现与调用。').volatile(),
})

export class GlmSearchError extends Error {
  constructor(message, code = 'WEB_PROVIDER_ERROR') {
    super(message)
    this.name = 'GlmSearchError'
    this.code = code
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim() ? value.trim() : undefined
const valueOf = value => value && typeof value.get === 'function' ? value.get() : value

function endpointURL(endpoint) {
  let url
  try { url = new URL(endpoint) } catch { throw new GlmSearchError('智谱搜索 Endpoint 不是有效 URL。') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.hash || url.search) {
    throw new GlmSearchError('智谱搜索 Endpoint 必须是 HTTPS MCP 地址，不应包含凭据、查询参数或片段。')
  }
  return url
}

function safeMessage(error, secret) {
  let message = error instanceof Error ? error.message : String(error)
  if (secret) message = message.split(secret).join('[redacted]')
  return message.replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [redacted]').slice(0, 800)
}

/** Read the live tools/list schema instead of assuming query/count field names. */
export function buildSearchCall(tools, request) {
  const tool = tools.find(tool => tool.name === 'webSearchPrime')
    ?? tools.find(tool => tool.name === 'web_search_prime')
  if (!tool) throw new GlmSearchError('智谱 MCP 未提供 webSearchPrime / web_search_prime 搜索工具。')
  const properties = tool.inputSchema?.properties ?? {}
  const queryKey = ['search_query', 'query'].find(key => Object.hasOwn(properties, key))
  if (!queryKey) throw new GlmSearchError('智谱搜索工具未声明受支持的查询字段（search_query 或 query）。')
  const args = { [queryKey]: request.query }
  for (const [key, schema] of Object.entries(properties)) {
    if (key === queryKey || !record(schema)) continue
    if (schema.default !== undefined) args[key] = schema.default
    else if (schema.const !== undefined) args[key] = schema.const
    else if (Array.isArray(schema.enum) && schema.enum.length === 1) args[key] = schema.enum[0]
  }
  const countKey = ['count', 'num_results', 'numResults'].find(key => Object.hasOwn(properties, key))
  if (countKey && request.maxResults !== undefined) {
    const schema = properties[countKey]
    args[countKey] = Math.max(schema.minimum ?? 1, Math.min(request.maxResults, schema.maximum ?? 50))
  }
  for (const key of tool.inputSchema?.required ?? []) {
    if (!Object.hasOwn(args, key)) {
      throw new GlmSearchError(`智谱搜索工具要求未知参数 ${key}，请更新插件以适配该服务。`)
    }
  }
  return { name: tool.name, arguments: args }
}

function parseJSON(value) {
  if (typeof value !== 'string') return value
  const raw = value.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1')
  try { return JSON.parse(raw) } catch { return undefined }
}

/** Only explicit structured result containers become sources; never scrape prose for URLs. */
function resultItems(payload, depth = 0) {
  if (depth > 8) return undefined
  if (typeof payload === 'string') return resultItems(parseJSON(payload), depth + 1)
  if (Array.isArray(payload)) {
    if (payload.length === 0) return []
    if (payload.some(item => record(item) && ('url' in item || 'link' in item))) return payload
    const parts = payload.map(item => resultItems(item, depth + 1)).filter(items => items !== undefined)
    return parts.length ? parts.flat() : undefined
  }
  if (!record(payload)) return undefined
  if (payload.success === false || payload.isError === true || payload.error != null) {
    const detail = payload.error?.message ?? payload.msg ?? payload.message ?? '远程 MCP 返回搜索错误。'
    throw new GlmSearchError(`智谱搜索失败：${String(detail).slice(0, 600)}`)
  }
  if ('url' in payload || 'link' in payload) return [payload]
  for (const key of ['search_result', 'search_results', 'results', 'sources', 'data', 'result', 'structuredContent', 'content', 'text']) {
    if (!Object.hasOwn(payload, key)) continue
    const items = resultItems(payload[key], depth + 1)
    if (items !== undefined) return items
  }
  return undefined
}

export function normalizeSearchResult(result, maxResults) {
  if (result.isError) {
    const detail = (result.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
    throw new GlmSearchError(`智谱搜索工具返回错误：${detail.slice(0, 600)}`)
  }
  // Prefer structuredContent, but tolerate servers that only send JSON in text blocks.
  const items = resultItems(result.structuredContent) ?? resultItems(result.content)
  if (items === undefined) {
    throw new GlmSearchError('无法识别智谱 MCP 搜索结果：需要结构化结果或 JSON 文本中的 URL 列表。')
  }
  const sources = []
  const seen = new Set()
  for (const item of items) {
    if (!record(item)) continue
    const rawURL = text(item.url) ?? text(item.link)
    let url
    try { url = new URL(rawURL) } catch { continue }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue
    seen.add(url.href)
    const title = text(item.title)
    const snippet = text(item.content) ?? text(item.snippet) ?? text(item.description)
    const publishedAt = text(item.publish_date) ?? text(item.publishedDate) ?? text(item.published_at)
    sources.push({ url: url.href,
      ...(title ? { title: title.slice(0, 1000) } : {}),
      ...(snippet ? { snippet: snippet.slice(0, 8000) } : {}),
      ...(publishedAt ? { publishedAt: publishedAt.slice(0, 100) } : {}),
    })
  }
  if (items.length && !sources.length) throw new GlmSearchError('智谱 MCP 返回了结果，但没有可引用的 HTTP(S) URL。')
  const cap = maxResults ?? sources.length
  return { sources: sources.slice(0, cap), truncated: sources.length > cap }
}

function checkAbort(signal) {
  if (signal.aborted) throw signal.reason
}

async function withAbort(promise, signal) {
  checkAbort(signal)
  let abort
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })])
  } finally { if (abort) signal.removeEventListener('abort', abort) }
}

/** One independent MCP session per query: cancellation and key rotation cannot mix sessions. */
export class GlmSearchProvider {
  id = GLM_PROVIDER_ID
  constructor(resolveOptions) { this.resolveOptions = resolveOptions }
  available() { return true } // Credential resolution is asynchronous; search reports actionable errors.

  async search(request, callerSignal) {
    const options = this.resolveOptions()
    const timeout = new AbortController()
    const timeoutMs = options.timeoutMs ?? 55000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000) throw new GlmSearchError('智谱搜索 timeoutMs 应为 100–300000 的整数。')
    const timer = setTimeout(() => timeout.abort(new Error('GLM search timeout')), timeoutMs)
    const signal = AbortSignal.any([timeout.signal, ...[callerSignal, options.signal].filter(Boolean)])
    let client
    let transport
    let secret
    let cleanupSignal
    try {
      checkAbort(signal)
      if (!text(request.query)) throw new GlmSearchError('智谱搜索关键词不能为空。')
      const endpoint = endpointURL(options.endpoint ?? GLM_DEFAULT_ENDPOINT)
      // The one snapshot above fixes endpoint + credential reference for the entire operation.
      secret = text(options.apiKey) ?? text(await withAbort(Promise.resolve().then(() => options.resolveApiKey?.()), signal))
      checkAbort(signal)
      if (!secret) throw new GlmSearchError(
        `未配置智谱搜索密钥。请在设置 → 插件 → 插件配置 → web-search-glm 填写 Coding Plan API Key，或设置凭据 ${options.apiKeyEnv ?? GLM_DEFAULT_KEY_REF}。`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
      const guardedFetch = async (input, init = {}) => {
        const target = new URL(input instanceof Request ? input.url : String(input))
        if (target.href !== endpoint.href) throw new GlmSearchError('智谱搜索拒绝向其他 Endpoint 发送请求。')
        const response = await fetch(input, {
          ...init, redirect: 'error', signal: AbortSignal.any([signal, ...[init.signal, cleanupSignal].filter(Boolean)]),
        })
        if (!response.ok && ![405].includes(response.status)) {
          await response.body?.cancel()
          const hints = { 401: '请检查 Coding Plan API Key。', 403: '请检查套餐权限。', 402: '请检查智谱套餐额度或余额。', 429: '智谱搜索达到频率或额度限制，请稍后重试。' }
          throw new GlmSearchError(`智谱搜索 HTTP ${response.status}。${hints[response.status] ?? '请检查服务状态与 MCP Endpoint。'}`)
        }
        if (!response.body) return response
        let received = 0
        const bounded = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
          received += chunk.byteLength
          if (received > 8 * 1024 * 1024) throw new GlmSearchError('智谱搜索响应超过 8 MiB 限制。')
          controller.enqueue(chunk)
        } }))
        return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers })
      }
      client = new Client({ name: 'dsh-plugin-web-search-glm', version: '1.0.1' }, {
        capabilities: {}, listMaxPages: 8, versionNegotiation: { mode: 'legacy' },
      })
      transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: `Bearer ${secret}` } },
        fetch: guardedFetch,
        reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 1000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      })
      const requestOptions = { signal, timeout: timeoutMs }
      await client.connect(transport, requestOptions)
      const { tools } = await client.listTools(undefined, requestOptions)
      const call = buildSearchCall(tools, request)
      const result = await client.callTool(call, requestOptions)
      checkAbort(signal)
      return normalizeSearchResult(result, request.maxResults)
    } catch (error) {
      if (signal.aborted) {
        if (timeout.signal.aborted && !callerSignal?.aborted && !options.signal?.aborted) {
          throw new GlmSearchError(`智谱搜索超时（${timeoutMs}ms）。`, 'WEB_TIMEOUT')
        }
        throw new GlmSearchError('智谱搜索已取消。', 'WEB_ABORTED')
      }
      throw new GlmSearchError(safeMessage(error, secret), error instanceof GlmSearchError ? error.code : 'WEB_PROVIDER_ERROR')
    } finally {
      // close() aborts HTTP and background SSE; termination is best-effort and bounded by the same timer.
      if (transport?.sessionId && !signal.aborted) {
        cleanupSignal = AbortSignal.timeout(2000)
        await transport.terminateSession().catch(() => {})
      }
      await client?.close().catch(() => {})
      clearTimeout(timer)
    }
  }
}

/** Register only a provider; tool schemas, permissions, citations and fetch stay owned by DSH. */
export function apply(ctx, config) {
  const lifecycle = new AbortController()
  ctx.effect(() => () => lifecycle.abort(new Error('web-search-glm unloaded')), 'web-search-glm.lifecycle')
  ctx.web.registerSearchProvider(new GlmSearchProvider(() => {
    const snapshot = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, valueOf(value)]))
    const ref = snapshot.apiKeyEnv ?? GLM_DEFAULT_KEY_REF
    return { ...snapshot, signal: lifecycle.signal, resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials) return (await credentials.resolve(ref))?.value
      const environment = ctx.get('launchEnvironment')
      return environment ? environment.get(ref)?.value : process.env[ref]
    } }
  }))
}
