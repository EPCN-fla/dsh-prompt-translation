import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const scanner = fileURLToPath(new URL('./scan-host-peers.mjs', import.meta.url))
const installer = fileURLToPath(new URL('./install-host.mjs', import.meta.url))
const scan = root => JSON.parse(execFileSync(process.execPath, [scanner, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
function writePackage(root, name, extra = {}) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.2.0-rc.1', type: 'module', exports: './lib/index.js', ...extra }))
  writeFileSync(join(dir, 'lib/index.js'), 'export const name = "fixture"\n')
  return join(dir, 'package.json')
}
test('peer scanner reports required peers but skips optional ones and accepts ESM entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'translation-peer-scan-'))
  try {
    writePackage(root, '@deepseek-ai/dsh', {
      peerDependencies: { '@deepseek-ai/missing': '0.2.0-rc.1', '@deepseek-ai/optional': '*', '@deepseek-ai/esm': '0.2.0-rc.1' },
      peerDependenciesMeta: { '@deepseek-ai/optional': { optional: true } },
    })
    writePackage(root, '@deepseek-ai/esm')
    assert.deepEqual(scan(root), { '@deepseek-ai/missing': '0.2.0-rc.1' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('fresh scanner sees peers installed by a child after earlier negative resolution', () => {
  const root = mkdtempSync(join(tmpdir(), 'translation-peer-cache-'))
  try {
    const owner = writePackage(root, '@deepseek-ai/dsh', { peerDependencies: { '@deepseek-ai/new-peer': '0.2.0-rc.1' } })
    assert.deepEqual(scan(root), { '@deepseek-ai/new-peer': '0.2.0-rc.1' })
    assert.throws(() => createRequire(owner).resolve('@deepseek-ai/new-peer'), { code: 'MODULE_NOT_FOUND' })
    // Match npm's process boundary, rather than invalidating caches with a
    // parent-process writeFileSync (which would hide the original regression).
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { mkdirSync, writeFileSync } from 'node:fs';
      const dir = ${JSON.stringify(join(root, 'node_modules/@deepseek-ai/new-peer'))};
      mkdirSync(dir + '/lib', { recursive: true });
      writeFileSync(dir + '/package.json', JSON.stringify({ name: '@deepseek-ai/new-peer', version: '0.2.0-rc.1', type: 'module', exports: './lib/index.js' }));
      writeFileSync(dir + '/lib/index.js', 'export const name = "peer"');
    `])
    assert.deepEqual(scan(root), {})
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('real installer converges over recursive peer discovery with child-process installs', { skip: process.platform === 'win32' }, () => {
  const cwd = mkdtempSync(join(tmpdir(), 'translation-install-entry-'))
  try {
    const bin = join(cwd, 'bin')
    mkdirSync(bin)
    const npm = join(bin, 'npm')
    writeFileSync(npm, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const root = args[args.indexOf('--prefix') + 1];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const packages = {};
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const dir = path.join(root, 'node_modules', name);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const peer = name === '@deepseek-ai/dsh' ? '@deepseek-ai/peer-a' : name === '@deepseek-ai/peer-a' ? '@deepseek-ai/peer-b' : undefined;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: './lib/index.js', peerDependencies: peer ? { [peer]: version } : {} }));
  fs.writeFileSync(path.join(dir, 'lib/index.js'), 'export const name = "fixture"');
  packages['node_modules/' + name] = { version };
}
fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }));
fs.appendFileSync(path.join(root, 'installs.log'), 'install\\n');
`)
    chmodSync(npm, 0o755)
    const output = execFileSync(process.execPath, [installer, '0.2.0-rc.1'], {
      cwd, env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}` }, encoding: 'utf8', timeout: 30000,
    })
    const root = join(cwd, 'artifacts/full-hosts/0.2.0-rc.1')
    assert.match(output, /Installed exact DSH 0\.2\.0-rc\.1/)
    assert.equal(readFileSync(join(root, 'installs.log'), 'utf8'), 'install\ninstall\ninstall\n')
    assert.deepEqual(scan(root), {})
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).dependencies['@deepseek-ai/peer-b'], '0.2.0-rc.1')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
test('peer scanner surfaces invalid package manifests rather than retrying them as missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'translation-peer-invalid-'))
  try {
    writePackage(root, '@deepseek-ai/dsh', { peerDependencies: { '@fixture/broken': '*' } })
    const dir = join(root, 'node_modules/@fixture/broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{ invalid JSON')
    assert.throws(() => scan(root), error => {
      assert.match(String(error.stderr), /ERR_INVALID_PACKAGE_CONFIG/)
      return true
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
