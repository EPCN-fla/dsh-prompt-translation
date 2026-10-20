import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
export const versions = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.2']
const version = process.argv[2]
if (!versions.includes(version)) throw new Error('Specify an exact supported DSH version')
const root = resolve('artifacts/full-hosts', version)
await mkdir(root, { recursive: true })
const manifest = { private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version } }
const install = () => execFileSync('npm', ['install', '--prefix', root, '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund', '--registry', 'https://registry.npmjs.org', '--fetch-timeout', '60000', '--fetch-retries', '2'], { stdio: 'inherit', timeout: 600000 })
// DSH declares runtime peers throughout its package family. Resolve those from the
// exact installed package manifests instead of allowing npm to mix release lines.
for (let pass = 0; pass < 6; pass++) {
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  install()
  // npm changes package files in a child process. A fresh scanner avoids
  // stale negative resolution entries retained by this installer process.
  const missing = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('./scan-host-peers.mjs', import.meta.url)), root,
  ], { encoding: 'utf8', timeout: 60000 }))
  if (!Object.keys(missing).length) break
  if (Object.entries(missing).every(([name, range]) => manifest.dependencies[name] === range)) {
    throw new Error(`Required peers remain unresolvable after installation: ${Object.keys(missing).join(', ')}`)
  }
  console.log(`Host ${version}, pass ${pass + 1}: adding ${Object.keys(missing).length} required peers`)
  if (pass === 5) throw new Error(`Unresolved runtime peers: ${Object.keys(missing).join(', ')}`)
  Object.assign(manifest.dependencies, missing)
}
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const cohort = Object.entries(lock.packages).filter(([path]) => /(?:^|\/)node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path))
for (const [path, dependency] of cohort) {
  if (dependency.version !== version) throw new Error(`Mixed DSH cohort: ${path}@${dependency.version} (expected ${version})`)
}
console.log(`Installed exact DSH ${version}: ${cohort.length} DSH packages`)
