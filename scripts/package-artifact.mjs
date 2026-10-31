import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { parse } from 'yaml'
const manifest = JSON.parse(await readFile('package.json', 'utf8'))
await mkdir('artifacts', { recursive: true })
// Pack the build and inspect its contents. Some npm versions still run prepare
// during pack; the resulting tarball is the immutable input for all later gates.
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', 'artifacts'], { encoding: 'utf8' }))
const names = packed.files.map(file => file.path)
assert.equal(manifest.icon, './icon.svg')
for (const required of ['lib/index.js', 'lib/index.d.ts', 'lib/client.js', 'lib/client/index.d.ts', 'icon.svg', 'cordis.patch.yml', 'dsh-plugin.naming.json', 'README.md', 'README.en.md', 'LICENSE']) assert.ok(names.includes(required), `Missing ${required}`)
assert.ok(names.every(name => /^(lib\/.*\.(js|d\.ts)|package\.json|cordis\.patch\.yml|dsh-plugin\.naming\.json|README(?:\.en)?\.md|icon\.svg|LICENSE)$/.test(name)), 'Unexpected package files')
const patch = parse(await readFile('cordis.patch.yml', 'utf8'))
assert.equal(patch[0].insert[0].name, manifest.name)
const client = await readFile('lib/client.js', 'utf8')
assert.ok(client.startsWith('window.__ModuleLoader__.load({'))
assert.ok(client.includes(`id:"${manifest.name}"`))
assert.ok(!(await readFile('LICENSE', 'utf8')).includes('dsh-custom-headers'))
const tarball = resolve('artifacts', packed.filename)
const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex')
await writeFile('artifacts/package.json', JSON.stringify({ name: manifest.name, version: manifest.version, filename: packed.filename, sha256, files: names }, null, 2) + '\n')
await writeFile('artifacts/SHA256SUMS', `${sha256}  ${packed.filename}\n`)
console.log(`Verified ${packed.filename}: ${names.length} files, sha256 ${sha256}`)
