import { execFileSync } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'

async function collectDeclarations(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await collectDeclarations(full))
    else if (entry.name.endsWith('.d.ts')) result.push(full)
  }
  return result
}

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
await mkdir('artifacts', { recursive: true })
// Pack the build and inspect its contents. Some npm versions still run prepare
// during pack; the resulting tarball is the immutable input for all later gates.
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', 'artifacts'], { encoding: 'utf8' }))
const names = packed.files.map(file => file.path)
assert.equal(manifest.icon, './icon.svg')
for (const required of ['lib/index.js', 'lib/index.d.ts', 'lib/client.js', 'lib/client/index.d.ts', 'icon.svg', 'cordis.patch.yml', 'dsh-plugin.naming.json', 'README.md', 'README.en.md', 'LICENSE']) assert.ok(names.includes(required), `Missing ${required}`)
assert.ok(names.every(name => /^(lib\/.*\.(js|d\.ts)|package\.json|cordis\.patch\.yml|dsh-plugin\.naming\.json|README(?:\.en)?\.md|icon\.svg|LICENSE)$/.test(name)), 'Unexpected package files')
assert.ok(!names.some(name => /(?:^|\/)src\//.test(name) || (/\.(?:ts|tsx)$/.test(name) && !name.endsWith('.d.ts'))), 'TypeScript sources leaked into the artifact')

for (const declaration of await collectDeclarations('lib')) {
  const source = await readFile(declaration, 'utf8')
  assert.doesNotMatch(source, /from ['"][^'"]+\.tsx?['"]/, `${declaration} contains non-portable TypeScript source extensions`)
  assert.doesNotMatch(source, /@deepseek-ai\/cosmokit/, `${declaration} leaks undeclared @deepseek-ai/cosmokit type reference`)
}

const patch = parse(await readFile('cordis.patch.yml', 'utf8'))
assert.equal(patch[0].insert[0].name, manifest.name)
const naming = JSON.parse(await readFile('dsh-plugin.naming.json', 'utf8'))
assert.ok(naming.names.loaderIds.includes(patch[0].insert[0].id), 'dsh-plugin.naming.json loaderIds must match cordis.patch.yml id')

const hostEntry = await import(pathToFileURL(resolve('lib/index.js')).href)
assert.equal(hostEntry.name, manifest.name)
assert.equal(Object.keys(hostEntry).sort().join(','), 'Config,apply,inject,name')

const client = await readFile('lib/client.js', 'utf8')
assert.ok(client.startsWith('window.__ModuleLoader__.load({'))
assert.ok(client.includes(`id:"${manifest.name}"`))
let registration
const stubWindow = { __ModuleLoader__: { load(value) { registration = value } } }
new Function('window', client)(stubWindow)
assert.equal(registration?.id, manifest.name)
const clientStubs = {
  react: {},
  'react/jsx-runtime': {},
  'react-dom': {},
  'react-dom/client': {},
}
const clientExports = registration.factory(id => {
  if (!Object.hasOwn(clientStubs, id)) throw new Error(`Unexpected external in client bundle: ${id}`)
  return clientStubs[id]
})
assert.equal(clientExports.name, manifest.name)
assert.ok(Array.isArray(clientExports.inject))
assert.equal(typeof clientExports.apply, 'function')

assert.ok(!(await readFile('LICENSE', 'utf8')).includes('dsh-custom-headers'))
const tarball = resolve('artifacts', packed.filename)
const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
await writeFile('artifacts/package.json', JSON.stringify({ name: manifest.name, version: manifest.version, filename: packed.filename, sha256, files: names }, null, 2) + '\n')
await writeFile('artifacts/SHA256SUMS', `${sha256}  ${packed.filename}\n`)
console.log(`Verified ${packed.filename}: ${names.length} files, sha256 ${sha256}`)
