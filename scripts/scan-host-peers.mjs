import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'

// Run this in a NEW process after every npm install. The long-lived installer
// must not reuse Node's negative package-resolution cache across child installs.
const root = resolve(process.argv[2])
const missing = {}
for (const name of await readdir(join(root, 'node_modules/@deepseek-ai'))) {
  const path = join(root, 'node_modules/@deepseek-ai', name, 'package.json')
  if (!existsSync(path)) continue
  const dependency = JSON.parse(await readFile(path, 'utf8'))
  const require = createRequire(path)
  for (const [peer, range] of Object.entries(dependency.peerDependencies ?? {})) {
    if (dependency.peerDependenciesMeta?.[peer]?.optional) continue
    try { require.resolve(peer) } catch (error) {
      // Malformed package configuration is not a missing peer and reinstalling
      // it indefinitely cannot fix it. Keep the actual failure actionable.
      if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
      missing[peer] = range
    }
  }
}
process.stdout.write(JSON.stringify(missing))
