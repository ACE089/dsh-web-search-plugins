/** Run with Desktop's Electron in Node mode, --expose-internals; never writes the user's profile. */
// local-fixture-secret is a fake credential used to verify settings redaction.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtime = process.argv[2] ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const root = fileURLToPath(new URL('../', import.meta.url))
const bundleNames = ['dsh-plugin-web-search-glm', 'dsh-plugin-web-search-policy']
const archives = bundleNames.map((name, index) => {
  const sourceManifest = JSON.parse(readFileSync(join(root, 'packages', name.replace('dsh-plugin-', ''), 'package.json'), 'utf8'))
  return resolve(process.argv[index + 3] ?? join(root, 'dist', `${name}-${sourceManifest.version}.tgz`))
})
const anchor = join(runtime, 'package.json')
const require = createRequire(anchor)
const load = name => import(pathToFileURL(require.resolve(name)).href)
const [boot, { default: Web }, { default: ConfigEditor }, { default: Settings }, { default: SystemPrompt }, { default: Tools }, ToolWeb] = await Promise.all([
  load('@deepseek-ai/dsh-app-boot'), load('@deepseek-ai/dsh-web'), load('@deepseek-ai/dsh-config-editor'), load('@deepseek-ai/dsh-settings'),
  load('@deepseek-ai/dsh-system-prompt'), load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-tool-web'),
])
const stage = mkdtempSync(join(tmpdir(), 'dsh-web-search-package-check-'))
const profileDir = join(stage, 'profiles/test')
const [bundleName, policyName] = bundleNames
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(stage, 'package.json'), '{"name":"isolated-dsh-glm-check","private":true}\n')
const profileManifest = { name: 'isolated-glm-profile', private: true, dsh: { profile: { bundles: [] } } }
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(profileManifest))
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
// Desktop 0.2.1 ships pnpm inside primary-runtime instead of runtime/pnpm.
const pnpmRoot = [resolve(runtime, '../../runtime/primary-runtime/dependencies/pnpm'), resolve(runtime, '../../runtime/pnpm')]
  .find(dir => existsSync(join(dir, 'package.json')))
assert.ok(pnpmRoot, 'Desktop bundled pnpm must be present')
const pnpmManifest = JSON.parse(readFileSync(join(pnpmRoot, 'package.json'), 'utf8'))
const pnpm = join(pnpmRoot, pnpmManifest.bin.pnpm)
const installOutput = execFileSync(process.execPath, [pnpm, '--dir', profileDir, 'add', '--offline', '--ignore-scripts', '--store-dir', join(stage, 'store'), ...archives], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', XDG_CACHE_HOME: join(stage, 'cache'), XDG_DATA_HOME: join(stage, 'data'), XDG_STATE_HOME: join(stage, 'state') },
  encoding: 'utf8', timeout: 60000,
})
assert.match(installOutput, /dsh-plugin-web-search-glm/)
assert.match(installOutput, /dsh-plugin-web-search-policy/)
const installedRoot = join(profileDir, 'node_modules', bundleName)
const policyRoot = join(profileDir, 'node_modules', policyName)
const desktopVersion = JSON.parse(readFileSync(resolve(runtime, '../package.json'), 'utf8')).version
assert.equal(boot.getDshRuntimeVersion(), desktopVersion)
for (const [index, name] of bundleNames.entries()) {
  const installed = join(profileDir, 'node_modules', name)
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh'], desktopVersion)
  assert.equal(boot.evaluatePluginCompatibility(manifest), undefined)
  assert.ok(boot.evaluatePluginCompatibility({ ...manifest, peerDependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' } }))
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.scripts, undefined)
  for (const file of ['index.mjs', 'package.json', 'cordis.patch.yml', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const archived = execFileSync('tar', ['-xOf', archives[index], `package/${file}`])
    assert.deepEqual(readFileSync(join(installed, file)), archived)
  }
}

// Compose the real shipped base with the actual tgz's patch, then remove the patch again.
const loadedManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
loadedManifest.dsh = { profile: { bundles: bundleNames } }
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(loadedManifest))
const packaged = boot.loadProfileDirectory('dsh', profileDir, anchor)
assert.deepEqual(packaged.skippedBundles, [])
const shipped = boot.loadOverlayPatches('dsh', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'))
const baseline = boot.composeEntries([shipped])
const composed = boot.composeEntries([shipped, ...packaged.layers.map(layer => layer.patches), packaged.patches])
assert.deepEqual(composed.find(row => row.id === 'web').config, { searchProvider: 'glm-coding-plan', fetchProvider: 'http' })
assert.equal(composed.find(row => row.id === 'web-search-glm').name, bundleName)
assert.equal(composed.find(row => row.id === 'web-search-policy').name, policyName)
assert.equal(baseline.find(row => row.id === 'web').config.searchProvider, 'deepseek-official')
assert.ok(!baseline.some(row => row.id === 'web-search-glm'))

// A small profile exercises actual boot/Include/Loader/Settings without starting the full desktop host.
const fixtureDir = join(profileDir, 'node_modules/fixture-base')
mkdirSync(fixtureDir)
writeFileSync(join(fixtureDir, 'package.json'), JSON.stringify({ name: 'fixture-base', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
writeFileSync(join(fixtureDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [
  { id: 'config-editor', name: 'cordis:editor' },
  { id: 'settings', name: 'cordis:settings' },
  { id: 'web', name: 'cordis:web', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
  { id: 'system-prompt', name: 'cordis:prompt' },
  { id: 'tools', name: 'cordis:tools' },
  { id: 'tool-web', name: 'cordis:web-tools' },
] }]))
loadedManifest.dsh.profile.bundles = ['fixture-base', ...bundleNames]
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(loadedManifest))
const profile = { name: 'test', startedBundles: ['fixture-base', bundleName], dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: anchor, cwd: stage, home: stage, overlays: [] }
const ctx = await boot.boot('dsh', join(profileDir, 'cordis.yml'), boot.readProfilePatches('dsh', profile), ctx => {
  ctx.provide('profileContext', profile)
  ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
  Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, web: Web, prompt: SystemPrompt, tools: Tools, 'web-tools': ToolWeb })
})
try {
  const descriptor = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'web-search-glm')
  assert.ok(descriptor?.autoGenerate)
  assert.equal(descriptor.applies, 'live')
  assert.equal(descriptor.value.endpoint, 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp')
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'web-search-glm')
  assert.ok(entry?.fiber)
  await assert.rejects(ctx.web.search({ query: 'no network without credentials' }), /未配置智谱搜索密钥/)
  const originalFiber = entry.fiber
  await ctx.settings.update('web-search-glm', { apiKey: 'local-fixture-secret', apiKeyEnv: 'GLM_API_KEY', timeoutMs: 1000 })
  await ctx.loader.await()
  assert.equal(entry.fiber, originalFiber)
  assert.equal(entry.fiber.config.apiKey.get(), 'local-fixture-secret')
  assert.equal(entry.fiber.config.apiKeyEnv.get(), 'GLM_API_KEY')
  const redacted = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'web-search-glm')
  assert.ok(!JSON.stringify(redacted).includes('local-fixture-secret'))
  assert.match(readFileSync(profile.patchPath, 'utf8'), /GLM_API_KEY/)
  const policyEntry = [...ctx.loader.entries()].find(row => row.options.id === 'web-search-policy')
  assert.ok(policyEntry?.fiber)
  const assembly = await ctx.systemPrompt.assemble()
  assert.match(assembly.tools.find(tool => tool.name === 'web_search').description, /You MUST verify/)
  const policyFiber = policyEntry.fiber
  await ctx.loader.remove(policyEntry.id)
  await policyFiber.dispose()
  await ctx.loader.await()
  const removed = await ctx.systemPrompt.assemble()
  assert.ok(!removed.tools.find(tool => tool.name === 'web_search').description.includes('You MUST verify'))
  assert.ok(!removed.sections.some(section => section.name === 'web-search-policy:verification'))
} finally { await ctx.fiber.dispose() }

loadedManifest.dsh.profile.bundles = []
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(loadedManifest))
const unselected = boot.loadProfileDirectory('dsh', profileDir, anchor)
const restored = boot.composeEntries([shipped, ...unselected.layers.map(layer => layer.patches), unselected.patches])
assert.equal(restored.find(row => row.id === 'web').config.searchProvider, 'deepseek-official')
assert.ok(!restored.some(row => row.id === 'web-search-glm' || row.id === 'web-search-policy'))

// All behavior checks import the entries installed from the final archives.
const glmEntry = join(installedRoot, 'index.mjs')
const policyEntry = join(policyRoot, 'index.mjs')
for (const args of [
  ['--test', join(root, 'tests/web-search-glm.test.mjs')],
  ['--expose-internals', join(root, 'plugins/web-search-policy.integration.mjs'), runtime, policyEntry],
  ['--expose-internals', join(root, 'plugins/web-search-glm.integration.mjs'), runtime, glmEntry, policyEntry],
]) {
  execFileSync(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_GLM_ENTRY: glmEntry }, stdio: 'inherit', timeout: 60000 })
}

console.log(JSON.stringify({ archives, stage, installedEntries: [glmEntry, policyEntry], runtimeVersion: boot.getDshRuntimeVersion(), pnpmVersion: pnpmManifest.version,
  offlineInstall: true, compatible: true, realBaseComposition: true, removalRestoresDeepSeek: true,
  bootAndLoader: true, generatedSettingsForm: true, secretRedaction: true, persistentLiveSettings: true, policyActivationAndRemoval: true,
}, null, 2))
