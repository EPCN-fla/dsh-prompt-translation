/** Dependency-free CI metadata reader; package.json is the compatibility source. */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const number = '(?:0|[1-9][0-9]*)'
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
const exactVersion = new RegExp(`^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`)
const cohortPackages = {
  cordis: '@deepseek-ai/cordis',
  loader: '@deepseek-ai/cordis-plugin-loader',
  schemastery: '@deepseek-ai/schemastery',
}
const compatibilityKeys = new Set([...Object.keys(cohortPackages), 'node'])

/** Read validated exact host versions before dependencies have been installed. */
export function readCompatibility(path = 'package.json') {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const entries = manifest.dshCompatibility
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length === 0) {
    throw new Error('package.json dshCompatibility must be a non-empty version map')
  }
  for (const [version, config] of Object.entries(entries)) {
    if (!exactVersion.test(version)) throw new Error('dshCompatibility keys must be exact DSH versions, not ranges or tags')
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || Object.keys(config).some(key => !compatibilityKeys.has(key))) {
      throw new Error(`dshCompatibility ${version} has an invalid compatibility entry`)
    }
    for (const key of Object.keys(cohortPackages)) {
      if (typeof config[key] !== 'string' || !/^~?\d+\.\d+\.\d+$/.test(config[key])) {
        throw new Error(`dshCompatibility ${version} requires exact or tilde ${Object.keys(cohortPackages).join(', ')} versions`)
      }
    }
    if (![22, 24].includes(config.node)) throw new Error(`dshCompatibility ${version} requires node 22 or 24`)
  }
  return { manifest, entries }
}

function main() {
  const [mode, version] = process.argv.slice(2)
  const { manifest, entries } = readCompatibility()
  if (mode === 'matrix') {
    const matrix = JSON.stringify({
      include: Object.entries(entries).map(([version, config]) => ({
        'dsh-version': version,
        'cohort-node': config.node,
      })),
    })
    console.log(matrix)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`)
  } else if (mode === 'select') {
    if (!Object.hasOwn(entries, version ?? '')) throw new Error('Selected DSH version is not declared in dshCompatibility')
    let changed = false
    const dependencies = manifest.devDependencies
    const packages = Object.keys(dependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))
    const missing = Object.values(cohortPackages).filter(name => !dependencies?.[name])
    if (packages.length === 0 || missing.length) throw new Error(`Missing DSH/cohort development dependencies: ${missing.join(', ')}`)
    for (const name of packages) {
      if (dependencies[name] !== version) { dependencies[name] = version; changed = true }
    }
    for (const [key, name] of Object.entries(cohortPackages)) {
      const selected = entries[version][key]
      if (dependencies[name] !== selected) {
        dependencies[name] = selected
        changed = true
      }
    }
    if (changed) writeFileSync('package.json', `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`changed=${changed}`)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`)
  } else {
    throw new Error('Usage: node scripts/ci-compatibility.mjs matrix | select <version>')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
