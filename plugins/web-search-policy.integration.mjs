/** Run against real dsh packages: node web-search-policy.integration.mjs <package-root> [plugin-entry]. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

if (!process.argv[2]) throw new Error('Pass a dsh installation or test project containing node_modules as the first argument.')
const policy = await import(process.argv[3]
  ? pathToFileURL(resolve(process.argv[3])).href
  : new URL('./web-search-policy.mjs', import.meta.url).href)
const require = createRequire(resolve(process.argv[2], 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const [{ Context }, { default: SystemPrompt, renderPrompt }, { default: Tools }, { default: Web }, WebTools, { createScope }] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-tools'),
  load('@deepseek-ai/dsh-web'), load('@deepseek-ai/dsh-tool-web'), load('@deepseek-ai/dsh-scope'),
])
const version = require('@deepseek-ai/dsh-tools/package.json').version
console.log(`Testing real dsh ${version} registries`)

async function fixture(t, config = {}, toolsConfig = {}, mode = 'native') {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt, {})
  if (mode !== 'native') {
    // Only SDK generation is exercised; executing a program is outside this test.
    const runtimeName = version === '0.1.0-rc.6' ? 'codeRuntime' : 'ptcRuntime'
    ctx.provide(runtimeName, { language: 'typescript' })
  }
  await ctx.plugin(Tools, { mode })
  await ctx.plugin(Web, {})
  await ctx.plugin(WebTools, toolsConfig)
  const baseline = await ctx.systemPrompt.assemble()
  const fiber = await ctx.plugin(policy, config)
  return { ctx, fiber, baseline }
}

const section = assembly => assembly.sections.find(s => s.name === 'web-search-policy:verification')?.text ?? ''
const webDescription = assembly => assembly.tools.find(t => t.name === 'web_search')?.description
  ?? assembly.tools.find(t => t.name === 'web_fetch')?.description ?? ''
const sdk = assembly => assembly.sections.find(s => s.name === 'tools:sdk')?.text ?? ''

test('policy reaches real assemblies, keeps arguments and executors, and is stable across requests', async t => {
  const { ctx, baseline } = await fixture(t)
  const execute = ctx.tools.get('web_search').execute
  const assembly = await ctx.systemPrompt.assemble()
  const text = webDescription(assembly)
  for (const trigger of ['Information may have changed', 'material doubt', 'explicitly asks', 'medical, legal, or financial', 'linked page', 'lean toward checking']) {
    assert.ok(text.includes(trigger), trigger)
  }
  assert.ok(renderPrompt(assembly).includes('# Web verification'))
  assert.match(assembly.tools.find(t => t.name === 'web_search').description, /You MUST verify/)
  assert.match(assembly.tools.find(t => t.name === 'web_fetch').description, /MUST read a referenced URL/)
  assert.ok(!section(assembly).includes('Information may have changed'))
  assert.deepEqual(assembly.tools.map(t => ({ ...t, description: '' })), baseline.tools.map(t => ({ ...t, description: '' })))
  assert.equal(ctx.tools.get('web_search').execute, execute)
  assert.deepEqual(await ctx.systemPrompt.assemble(), assembly)
  assert.ok(text.includes('Respect an explicit instruction not to browse'))
  assert.ok(text.includes('stable mathematical explanation'))
  assert.ok(text.includes('Do not repeat unchanged failing calls'))
  assert.ok(text.includes(version === '0.1.0-rc.6'
    ? '{"query":"Node.js official release notes"}'
    : '{"queries":["Node.js official release notes"]}'))
  assert.match(text, /self-contained queries/)
  assert.match(text, /For technical claims, use official documentation/)
})

test('search-only and fetch-only compositions name only available web tools', async t => {
  for (const fetch of [false, true]) {
    await t.test(fetch ? 'fetch only' : 'search only', async t => {
      const { ctx } = await fixture(t, {}, { search: !fetch, fetch })
      const text = webDescription(await ctx.systemPrompt.assemble())
      assert.ok(text.includes(fetch ? 'web_fetch' : 'web_search'))
      assert.ok(!text.includes(fetch ? 'web_search' : 'web_fetch'))
      assert.ok(text.includes(fetch ? 'Search discovery is unavailable' : 'Full-page retrieval is unavailable'))
    })
  }
})

test('agent restrictions and disabled tools do not create phantom capabilities', async t => {
  const { ctx } = await fixture(t)
  const key = {}
  const scope = createScope(ctx, key)
  t.after(() => scope.dispose())
  await scope.ctx.plugin({ name: 'test-restrictions', inject: ['tools'], apply(inner) {
    inner.tools.restrict({ deny: ['web_search', 'web_fetch'] })
  } })
  const assembly = await ctx.systemPrompt.assemble({ scope: key })
  assert.equal(section(assembly), '')
  assert.ok(!assembly.tools.some(t => t.name === 'web_search' || t.name === 'web_fetch'))
  assert.notEqual(section(await ctx.systemPrompt.assemble()), '')
})

test('the next assembly listener is awaited and its final native tool visibility is respected', async t => {
  const { ctx } = await fixture(t)
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, tools: [] }
  })
  assert.equal(section(await ctx.systemPrompt.assemble()), '')
})

test('prompt policy works when the model reaches web tools through the generated SDK', async t => {
  const mode = version === '0.1.0-rc.6' ? 'code' : 'ptc'
  const { ctx, baseline } = await fixture(t, {}, {}, mode)
  const assembly = await ctx.systemPrompt.assemble()
  assert.deepEqual(assembly.tools.map(t => t.name), ['run_code'])
  assert.match(section(assembly), /reach web functions through its declared SDK/)
  assert.ok(sdk(assembly).startsWith(sdk(baseline)))
  assert.match(sdk(assembly), /Web verification rules for SDK functions/)
  assert.match(sdk(assembly), /Information may have changed/)
  assert.match(sdk(assembly), /lean toward checking/)
  assert.match(sdk(assembly), /MUST read a referenced URL/)
  assert.equal(assembly.tools[0].description, (await ctx.tools.schemas()).find(t => t.name === 'run_code').description)
  const key = {}
  const scope = createScope(ctx, key)
  t.after(() => scope.dispose())
  await scope.ctx.plugin({ name: 'test-restrictions', inject: ['tools'], apply(inner) {
    inner.tools.restrict({ deny: ['web_search', 'web_fetch'] })
  } })
  assert.equal(section(await ctx.systemPrompt.assemble({ scope: key })), '')
})

test('dispose removes the prompt contribution and tool description changes', async t => {
  const { ctx, baseline, fiber } = await fixture(t)
  await fiber.dispose()
  assert.deepEqual(await ctx.systemPrompt.assemble(), baseline)
})

test('description enhancement can be disabled without disabling the policy', async t => {
  const { ctx, baseline } = await fixture(t, { enhanceToolDescriptions: false })
  const assembly = await ctx.systemPrompt.assemble()
  assert.deepEqual(assembly.tools, baseline.tools)
  assert.notEqual(section(assembly), '')
  assert.match(section(assembly), /Information may have changed/)
})

test('native tool descriptions retain the full policy when a deployment supplies a complete system prompt', async t => {
  const { ctx } = await fixture(t)
  ctx.systemPrompt.section({ name: 'custom-complete', order: 0, complete: true, text: 'Custom deployment instructions.' })
  const assembly = await ctx.systemPrompt.assemble()
  assert.equal(renderPrompt(assembly), 'Custom deployment instructions.')
  assert.equal(section(assembly), '')
  assert.match(webDescription(assembly), /You MUST verify/)
  assert.match(webDescription(assembly), /lean toward checking/)
})

test('scoped PTC presentation carries policy without changing native agents', async t => {
  const { ctx } = await fixture(t)
  ctx.provide('ptcRuntime', { language: 'typescript' })
  const native = await ctx.systemPrompt.assemble()
  const key = {}
  const scope = createScope(ctx, key)
  t.after(() => scope.dispose())
  await scope.ctx.plugin({ name: 'test-ptc-presentation', inject: ['tools'], apply(inner) {
    inner.tools.presentAs('ptc')
  } })
  const assembly = await ctx.systemPrompt.assemble({ scope: key })
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['run_code'])
  assert.match(sdk(assembly), /You MUST verify/)
  assert.equal(sdk(assembly).split('## Web verification rules for SDK functions').length, 2)
  assert.deepEqual(await ctx.systemPrompt.assemble(), native)
  assert.match(webDescription(native), /You MUST verify/)
  assert.equal(sdk(native), '')
})

test('the original web search executor still returns provider evidence', async t => {
  const { ctx } = await fixture(t)
  const queries = []
  ctx.web.registerSearchProvider({
    id: 'fixture', available: () => true,
    async search(request) {
      queries.push(request.query)
      return { sources: [{ url: 'https://example.org/source', title: 'Fixture', snippet: 'Verified text' }], truncated: false }
    },
  })
  const argumentsValue = version === '0.1.0-rc.6' ? { query: 'test query' } : { queries: ['test query'] }
  const result = await ctx.tools.execute({ callId: 'web-policy-test', name: 'web_search', arguments: argumentsValue, signal: new AbortController().signal })
  assert.equal(result.isError, false)
  assert.deepEqual(queries, ['test query'])
  assert.match(JSON.stringify(result.content), /https:\/\/example.org\/source/)
})

test('invalid plugin configuration fails before registering anything', () => {
  for (const config of [null, [], 1, { unknown: true }, { sectionOrder: Infinity }, { sectionOrder: '6400' }, { enhanceToolDescriptions: 'yes' }]) {
    assert.throws(() => policy.apply({}, config), /web-search-policy:/)
  }
})
