/** Build the Desktop-installable bundle from the canonical standalone plugin. */
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const packageDir = join(root, 'packages', 'web-search-policy')
const outputDir = join(root, 'dist')
await mkdir(outputDir, { recursive: true })
await copyFile(join(root, 'LICENSE'), join(packageDir, 'LICENSE'))
await copyFile(join(root, 'plugins', 'web-search-policy.mjs'), join(packageDir, 'index.mjs'))
const result = execFileSync('npm', [
  'pack', '--ignore-scripts', '--json', '--cache', join(tmpdir(), 'dsh-plugin-pack-cache'),
  '--pack-destination', outputDir,
], { cwd: packageDir, encoding: 'utf8' })
const [pack] = JSON.parse(result)
console.log(JSON.stringify({
  path: join(outputDir, pack.filename),
  size: pack.size,
  integrity: pack.integrity,
  files: pack.files.map(file => file.path),
}, null, 2))
