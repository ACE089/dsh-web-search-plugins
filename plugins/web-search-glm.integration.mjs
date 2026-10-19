/** Run using Desktop Electron Node mode: <test> <runtime-root> [packed-entry]. No paid API. */
// All credential strings in this file are fake values used only by local fixtures.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { startMcpFixture } from '../tests/fixtures/glm-mcp.mjs'

const runtime = process.argv[2]
if (!runtime) throw new Error('Pass the actual Desktop dsh runtime package root.')
const entry = resolve(process.argv[3] ?? fileURLToPath(new URL('../packages/web-search-glm/index.mjs', import.meta.url)))
const plugin = await import(pathToFileURL(entry).href)
const require = createRequire(resolve(runtime, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const [{ Context }, { default: Web }, { default: SystemPrompt }, { default: Tools }, ToolWeb, { default: Loader }, cosmokit] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-web'), load('@deepseek-ai/dsh-system-prompt'),
  load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-tool-web'), load('@deepseek-ai/cordis-plugin-loader'), load('@deepseek-ai/cosmokit'),
])
test('real DSH web service routes only to GLM, keeps web_search/fetch and works with proactive-search policy', async t => {
  const fixture = await startMcpFixture(t)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools, {})
  await ctx.plugin(Web, { searchProvider: plugin.GLM_PROVIDER_ID, fetchProvider: 'http' })
  let deepseekCalls = 0
  ctx.web.registerSearchProvider({ id: 'deepseek-official', available: () => true, search: async () => { deepseekCalls++; throw new Error('DeepSeek must remain unused') } })
  ctx.web.registerFetchProvider({ id: 'http', available: () => true, fetch: async ({ url }) => ({ url, statusCode: 200, body: { kind: 'text', content: 'page body' }, truncated: false }) })
  await ctx.plugin(ToolWeb, { fetch: true })
  const originalNames = (await ctx.tools.schemas()).map(tool => tool.name)
  const fiber = await ctx.plugin(plugin, { apiKey: 'fixture-key', endpoint: fixture.endpoint })
  const policy = await import(process.argv[4]
    ? pathToFileURL(resolve(process.argv[4])).href
    : new URL('./web-search-policy.mjs', import.meta.url).href)
  await ctx.plugin(policy, {})
  const assembly = await ctx.systemPrompt.assemble()
  assert.deepEqual(assembly.tools.map(tool => tool.name).sort(), originalNames.sort())
  assert.match(assembly.tools.find(tool => tool.name === 'web_search').description, /You MUST verify/)
  const result = await ctx.tools.get('web_search').execute({ queries: ['DSH', 'MCP'] }, { signal: new AbortController().signal })
  assert.ok(JSON.stringify(result).includes('https://example.com/releases'))
  assert.equal(fixture.calls.length, 2)
  assert.equal(deepseekCalls, 0)
  assert.equal((await ctx.web.fetch({ url: 'https://example.com/guide' })).body.content, 'page body')
  await fiber.dispose()
  await assert.rejects(ctx.web.search({ query: 'after removal' }), /not registered|missing|configured/i)
})

test('Loader live settings use bundled schema references, rotate credentials, and cancel in-flight work on unload', async t => {
  const fixture = await startMcpFixture(t)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let key = 'first-key'
  const references = []
  ctx.provide('credentials', { resolve: async ref => { references.push(ref); return { value: key } } })
  await ctx.plugin(Web, { searchProvider: plugin.GLM_PROVIDER_ID })
  await ctx.plugin(Loader, {})
  const id = await ctx.loader.create({ id: 'web-search-glm', name: pathToFileURL(entry).href, config: { endpoint: fixture.endpoint, timeoutMs: 3000 } })
  await ctx.loader.await()
  await ctx.web.search({ query: 'first' })
  key = 'second-key'
  await ctx.web.search({ query: 'second' })
  assert.deepEqual(references, ['ZHIPU_API_KEY', 'ZHIPU_API_KEY'])
  assert.deepEqual(fixture.observed.filter(item => item.body.method === 'tools/call').map(item => item.authorization), ['Bearer first-key', 'Bearer second-key'])
  const active = ctx.loader.entries().find(entry => entry.id === id)
  assert.ok(active)
  assert.ok(cosmokit.isVolatile(active.fiber.config.apiKeyEnv))
  assert.equal(plugin.Config.dict.apiKey.meta.role, 'secret')
  await ctx.loader.update(id, { config: { endpoint: fixture.endpoint, timeoutMs: 3000, apiKeyEnv: 'GLM_API_KEY' } })
  await ctx.loader.await()
  assert.equal(ctx.loader.entries().find(entry => entry.id === id).fiber, active.fiber)
  await ctx.web.search({ query: 'third' })
  assert.equal(references.at(-1), 'GLM_API_KEY')
  const pending = ctx.web.search({ query: 'timeout' })
  // Observe the rejection immediately, before awaiting the unload operation.
  const rejected = assert.rejects(pending, error => error.code === 'WEB_ABORTED')
  await new Promise(resolve => setTimeout(resolve, 75))
  await ctx.loader.remove(id)
  await rejected
  await assert.rejects(ctx.web.search({ query: 'after unload' }))
})
