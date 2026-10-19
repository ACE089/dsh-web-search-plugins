/** Exercise the bundled plugin against a local MCP server; no DSH installation or paid key. */
// Every credential below is a deliberately fake fixture value.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { results, tools, startMcpFixture } from './fixtures/glm-mcp.mjs'

const plugin = await import(process.env.DSH_GLM_ENTRY
  ? pathToFileURL(resolve(process.env.DSH_GLM_ENTRY)).href
  : new URL('../packages/web-search-glm/index.mjs', import.meta.url).href)

const provider = (fixture, options = {}) => new plugin.GlmSearchProvider(() => ({ apiKey: 'fixture-key', endpoint: fixture.endpoint, timeoutMs: 3000, ...options }))

test('tool discovery follows server-declared names, fields, defaults and count limits', () => {
  assert.deepEqual(plugin.buildSearchCall(tools, { query: 'DSH', maxResults: 25 }), { name: 'webSearchPrime', arguments: { search_query: 'DSH', count: 10 } })
  const alias = [{ name: 'web_search_prime', inputSchema: { properties: { query: { type: 'string' }, search_engine: { const: 'search-prime' } }, required: ['query', 'search_engine'] } }]
  assert.deepEqual(plugin.buildSearchCall(alias, { query: 'DSH', maxResults: 8 }), { name: 'web_search_prime', arguments: { query: 'DSH', search_engine: 'search-prime' } })
  assert.throws(() => plugin.buildSearchCall([], { query: 'a' }), /未提供/)
  assert.throws(() => plugin.buildSearchCall([{ name: 'webSearchPrime', inputSchema: { properties: { search_query: {} }, required: ['unknown'] } }], { query: 'a' }), /未知参数 unknown/)
})

test('normalization handles JSON MCP text and structured data, deduplicates, caps, and preserves citations', () => {
  const result = plugin.normalizeSearchResult({ structuredContent: { data: { search_result: results } } }, 2)
  assert.deepEqual(result, { sources: [
    { url: 'https://example.com/releases', title: 'Official release', snippet: 'Release details', publishedAt: '2026-10-15' },
    { url: 'https://example.com/guide', title: 'Guide', snippet: 'Guide details' },
  ], truncated: true })
  const doubleEncoded = { content: [{ type: 'text', text: JSON.stringify(JSON.stringify(results)) }] }
  assert.equal(plugin.normalizeSearchResult(doubleEncoded).sources.length, 3)
  const blocks = { content: results.slice(0, 3).map(item => ({ type: 'text', text: JSON.stringify(item) })) }
  assert.equal(plugin.normalizeSearchResult(blocks).sources.length, 2)
  assert.deepEqual(plugin.normalizeSearchResult({ structuredContent: { results: [] } }), { sources: [], truncated: false })
  assert.equal(plugin.normalizeSearchResult({ structuredContent: { error: null, results } }).sources.length, 3)
  assert.throws(() => plugin.normalizeSearchResult({ content: [{ type: 'text', text: 'API error' }] }), /无法识别/)
  assert.throws(() => plugin.normalizeSearchResult({ structuredContent: { error: { message: 'quota exhausted' } } }), /quota exhausted/)
})

test('official MCP client performs initialize/list/call over JSON and SSE and closes each session', async t => {
  const fixture = await startMcpFixture(t)
  for (const path of ['/mcp', '/sse']) {
    const result = await provider(fixture, { endpoint: fixture.base + path }).search({ query: 'DSH latest', maxResults: 2 })
    assert.equal(result.sources.length, 2)
    assert.equal(result.truncated, true)
  }
  assert.equal(fixture.calls.length, 2)
  assert.deepEqual(fixture.calls[0].arguments, { search_query: 'DSH latest', count: 2 })
  assert.ok(fixture.observed.every(item => item.authorization === 'Bearer fixture-key'))
  assert.equal(fixture.ended(), 2)
  assert.ok(!JSON.stringify(fixture.observed.map(item => item.body)).includes('fixture-key'))
})

test('no credentials, invalid endpoint and bad query fail before any network request', async t => {
  const fixture = await startMcpFixture(t)
  await assert.rejects(provider(fixture, { apiKey: undefined }).search({ query: 'DSH' }), error => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING')
  await assert.rejects(provider(fixture, { endpoint: 'http://example.com/mcp' }).search({ query: 'DSH' }), /HTTPS/)
  await assert.rejects(provider(fixture, { endpoint: 'https://example.com/mcp?Authorization=secret' }).search({ query: 'DSH' }), /HTTPS/)
  await assert.rejects(provider(fixture).search({ query: '  ' }), /不能为空/)
  assert.equal(fixture.observed.length, 0)
})

test('HTTP, MCP and malformed/oversized responses fail without repeated paid calls or exposing the key', async t => {
  const fixture = await startMcpFixture(t)
  for (const query of ['http-401', 'http-402', 'http-429', 'rpc-error', 'tool-error', 'echo-key-error', 'oversize', 'disconnect']) {
    const before = fixture.calls.length
    await assert.rejects(provider(fixture).search({ query }), error => {
      assert.ok(!error.message.includes('fixture-key'))
      return error.code === 'WEB_PROVIDER_ERROR'
    })
    assert.equal(fixture.calls.length - before, 1, query)
  }
})

test('credential-bearing redirects are rejected and never reach their target', async t => {
  const fixture = await startMcpFixture(t)
  await assert.rejects(provider(fixture).search({ query: 'redirect' }))
  assert.equal(fixture.redirects(), 0)
  assert.equal(fixture.calls.length, 1)
})

test('timeouts, caller cancellation and stalled credential resolution settle promptly', async t => {
  const fixture = await startMcpFixture(t)
  await assert.rejects(provider(fixture, { timeoutMs: 150 }).search({ query: 'timeout' }), error => error.code === 'WEB_TIMEOUT')
  const controller = new AbortController()
  const pending = provider(fixture).search({ query: 'timeout' }, controller.signal)
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(pending, error => error.code === 'WEB_ABORTED')
  await assert.rejects(provider(fixture, { apiKey: undefined, resolveApiKey: () => new Promise(() => {}), timeoutMs: 100 }).search({ query: 'DSH' }), error => error.code === 'WEB_TIMEOUT')
})

test('a settings edit during credential resolution cannot send an old key to the next endpoint', async t => {
  const first = await startMcpFixture(t)
  const second = await startMcpFixture(t)
  let release
  let started
  const resolving = new Promise(resolve => { started = resolve })
  let options = { endpoint: first.endpoint, apiKeyEnv: 'FIRST_KEY', resolveApiKey: () => { started(); return new Promise(resolve => { release = resolve }) }, timeoutMs: 2000 }
  const search = new plugin.GlmSearchProvider(() => options)
  const pending = search.search({ query: 'snapshot' })
  await resolving
  options = { endpoint: second.endpoint, apiKey: 'new-key', timeoutMs: 2000 }
  release('old-key')
  await pending
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 0)
  assert.ok(first.observed.every(item => item.authorization === 'Bearer old-key'))
  await search.search({ query: 'new snapshot' })
  assert.equal(second.calls.length, 1)
  assert.ok(second.observed.every(item => item.authorization === 'Bearer new-key'))
})

