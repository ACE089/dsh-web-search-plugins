/** Bundle public npm dependencies from this repository, then pack for Desktop. */
import { execFileSync } from 'node:child_process'
import { copyFile, readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageDir = join(root, 'packages/web-search-glm')
const outputDir = join(root, 'dist')
await mkdir(outputDir, { recursive: true })
await copyFile(join(root, 'LICENSE'), join(packageDir, 'LICENSE'))
const built = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'plugins/web-search-glm.mjs')], outfile: join(packageDir, 'index.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm', metafile: true,
  // Some upstream CommonJS helpers require Node built-ins at runtime.
  banner: { js: "import { createRequire as _dshCreateRequire } from 'node:module'; const require = _dshCreateRequire(import.meta.url);" },
  legalComments: 'inline',
})

// Preserve licenses for the actual npm package inputs. All inputs must be local.
const packages = new Map()
for (const input of Object.keys(built.metafile.inputs)) {
  const sourcePath = await realpath(resolve(root, input))
  const localPath = relative(root, sourcePath)
  if (localPath.startsWith('..') || isAbsolute(localPath)) {
    throw new Error(`Build input is outside this repository: ${input}`)
  }
  if (!localPath.split(/[\\/]/).includes('node_modules')) continue
  let dir = dirname(sourcePath)
  for (;;) {
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
    if (manifest?.name && manifest.version) {
      packages.set(dir, manifest)
      break
    }
    if (dir === root || dirname(dir) === dir) throw new Error(`Package metadata not found for ${input}`)
    dir = dirname(dir)
  }
}
const notices = ['# Bundled third-party software', '', 'Build dependencies are installed from the public npm registry and pinned by this repository\'s package-lock.json.', '']
for (const [dir, manifest] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  notices.push(`## ${manifest.name} ${manifest.version}`, '', `License: ${manifest.license ?? 'See upstream notice'}`, '')
  let found = false
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try { notices.push(await readFile(join(dir, filename), 'utf8'), ''); found = true; break } catch {}
  }
  if (!found) throw new Error(`License text not found for ${manifest.name}@${manifest.version}`)
  for (const filename of ['NOTICE', 'NOTICE.md', 'NOTICE.txt']) {
    try { notices.push(await readFile(join(dir, filename), 'utf8'), '') } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
await writeFile(join(packageDir, 'THIRD_PARTY_NOTICES.md'), notices.join('\n'))
const [pack] = JSON.parse(execFileSync('npm', [
  'pack', '--ignore-scripts', '--json', '--cache', join(tmpdir(), 'dsh-plugin-pack-cache'), '--pack-destination', outputDir,
], { cwd: packageDir, encoding: 'utf8' }))
console.log(JSON.stringify({ path: join(outputDir, pack.filename), size: pack.size, files: pack.files.map(file => file.path),
  bundledDependencies: [...packages.values()].map(pkg => `${pkg.name}@${pkg.version}`),
}, null, 2))
