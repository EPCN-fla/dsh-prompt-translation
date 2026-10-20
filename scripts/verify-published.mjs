import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const pkg = JSON.parse(await readFile('artifacts/package.json', 'utf8'))
const bytes = await readFile(`artifacts/${pkg.filename}`)
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`, { signal: AbortSignal.timeout(10000) })
  if (response.ok) {
    const published = await response.json()
    assert.equal(published.dist?.integrity, integrity, 'Published bytes differ from the tested tarball')
    console.log(`Verified registry integrity for ${pkg.name}@${pkg.version}`)
    break
  }
  if (response.status !== 404 || attempt === 11) throw new Error(`Registry verification HTTP ${response.status}`)
  await new Promise(resolve => setTimeout(resolve, 5000))
}
