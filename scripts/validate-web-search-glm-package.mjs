/** Run with Desktop's Electron in Node mode, --expose-internals; never writes the user's profile. */
// local-fixture-secret is a fake credential used to verify settings redaction.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtime = process.argv[2] ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
const archive = resolve(process.argv[3] ?? fileURLToPath(new URL('../dist/dsh-plugin-web-search-glm-1.0.0.tgz', import.meta.url)))
const anchor = join(runtime, 'package.json')
const require = createRequire(anchor)
const load = name => import(pathToFileURL(require.resolve(name)).href)
const [boot, { default: Web }, { default: ConfigEditor }, { default: Settings }] = await Promise.all([
  load('@deepseek-ai/dsh-app-boot'), load('@deepseek-ai/dsh-web'), load('@deepseek-ai/dsh-config-editor'), load('@deepseek-ai/dsh-settings'),
])
const stage = mkdtempSync(join(tmpdir(), 'dsh-glm-package-check-'))
const profileDir = join(stage, 'profiles/test')
const bundleName = 'dsh-plugin-web-search-glm'
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(stage, 'package.json'), '{"name":"isolated-dsh-glm-check","private":true}\n')
const profileManifest = { name: 'isolated-glm-profile', private: true, dsh: { profile: { bundles: [] } } }
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(profileManifest))
writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
const pnpm = resolve(runtime, '../../runtime/pnpm/bin/pnpm.mjs')
const installOutput = execFileSync(process.execPath, [pnpm, '--dir', profileDir, 'add', '--offline', '--ignore-scripts', '--store-dir', join(stage, 'store'), archive], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', XDG_CACHE_HOME: join(stage, 'cache'), XDG_DATA_HOME: join(stage, 'data'), XDG_STATE_HOME: join(stage, 'state') },
  encoding: 'utf8', timeout: 60000,
})
assert.match(installOutput, /dsh-plugin-web-search-glm/)
const installedRoot = join(profileDir, 'node_modules', bundleName)
const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
assert.equal(boot.evaluatePluginCompatibility(manifest), undefined)
assert.equal(manifest.dependencies, undefined)
assert.equal(manifest.scripts, undefined)

// Compose the real shipped base with the actual tgz's patch, then remove the patch again.
const loadedManifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
loadedManifest.dsh = { profile: { bundles: [bundleName] } }
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(loadedManifest))
const packaged = boot.loadProfileDirectory('dsh', profileDir, anchor)
assert.deepEqual(packaged.skippedBundles, [])
const shipped = boot.loadOverlayPatches('dsh', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'))
const baseline = boot.composeEntries([shipped])
const composed = boot.composeEntries([shipped, ...packaged.layers.map(layer => layer.patches), packaged.patches])
assert.deepEqual(composed.find(row => row.id === 'web').config, { searchProvider: 'glm-coding-plan', fetchProvider: 'http' })
assert.equal(composed.find(row => row.id === 'web-search-glm').name, bundleName)
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
] }]))
loadedManifest.dsh.profile.bundles = ['fixture-base', bundleName]
writeFileSync(join(profileDir, 'package.json'), JSON.stringify(loadedManifest))
const profile = { name: 'test', startedBundles: ['fixture-base', bundleName], dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: anchor, cwd: stage, home: stage, overlays: [] }
const ctx = await boot.boot('dsh', join(profileDir, 'cordis.yml'), boot.readProfilePatches('dsh', profile), ctx => {
  ctx.provide('profileContext', profile)
  ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
  Object.assign(ctx.loader.builtins, { editor: ConfigEditor, settings: Settings, web: Web })
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
} finally { await ctx.fiber.dispose() }

console.log(JSON.stringify({ archive, stage, installedEntry: join(installedRoot, 'index.mjs'), runtimeVersion: boot.getDshRuntimeVersion(),
  offlineInstall: true, compatible: true, realBaseComposition: true, removalRestoresDeepSeek: true,
  bootAndLoader: true, generatedSettingsForm: true, secretRedaction: true, persistentLiveSettings: true,
}, null, 2))
