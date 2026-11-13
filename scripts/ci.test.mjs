import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { readCompatibility } from './ci-compatibility.mjs'

const script = name => fileURLToPath(new URL(name, import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
const cohortPackages = {
  '@deepseek-ai/cordis': 'cordis',
  '@deepseek-ai/cordis-plugin-loader': 'loader',
  '@deepseek-ai/schemastery': 'schemastery',
}
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'translation-ci-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: {
      'node_modules/@deepseek-ai/dsh-scope': { version: '0.2.2-rc.3' },
    } }))
    return fn(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const run = (root, name, args, env = {}) => spawnSync(process.execPath, [script(name), ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '', ...env }, timeout: 10000,
})

test('compatibility matrix selects the exact Node 24 development cohort', () => fixture(root => {
  const matrix = run(root, 'ci-compatibility.mjs', ['matrix'])
  assert.equal(matrix.status, 0, matrix.stderr)
  assert.deepEqual(JSON.parse(matrix.stdout), {
    include: Object.entries(manifest.dshCompatibility).map(([version, config]) => ({
      'dsh-version': version,
      'cohort-node': config.node,
    })),
  })
  assert.deepEqual(Object.keys(manifest.dshCompatibility), ['0.2.2-rc.2', '0.2.2-rc.3'])
  assert.equal(manifest.dshCompatibility['0.2.2-rc.2'].node, 24)
  assert.equal(manifest.dshCompatibility['0.2.2-rc.3'].node, 24)
  assert.equal(manifest.engines.node, '>=24.9.0')
  assert.equal(manifest.engines.dsh, '0.2.2-rc.2 || 0.2.2-rc.3')
  const defaultVersion = Object.keys(manifest.dshCompatibility).at(-1)
  const activeVersion = process.env.DSH_TEST_VERSION || defaultVersion
  for (const [name, range] of Object.entries(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(range, activeVersion)
  }
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(range, '0.2.2-rc.2 || 0.2.2-rc.3')
  }
  const cleanDefault = structuredClone(manifest)
  delete cleanDefault.overrides
  for (const name of Object.keys(cleanDefault.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) cleanDefault.devDependencies[name] = defaultVersion
  }
  for (const [key, name] of Object.entries(cohortPackages)) {
    cleanDefault.devDependencies[name] = manifest.dshCompatibility[defaultVersion][key]
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(cleanDefault))
  const beforeDefault = readFileSync(join(root, 'package.json'), 'utf8')
  const defaultSelection = run(root, 'ci-compatibility.mjs', ['select', defaultVersion])
  assert.equal(defaultSelection.status, 0, defaultSelection.stderr)
  assert.equal(defaultSelection.stdout.trim(), 'changed=false')
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), beforeDefault)
  for (const version of Object.keys(manifest.dshCompatibility)) {
    const result = run(root, 'ci-compatibility.mjs', ['select', version])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'changed=true')
    const selected = JSON.parse(readFileSync(join(root, 'package.json')))
    for (const [name, value] of Object.entries(manifest.devDependencies)) {
      assert.equal(selected.devDependencies[name], name.startsWith('@deepseek-ai/dsh-') ? version
        : name in cohortPackages ? manifest.dshCompatibility[version][cohortPackages[name]] : value)
    }
    assert.deepEqual(selected.peerDependencies, manifest.peerDependencies)
    assert.equal(selected.overrides['@deepseek-ai/dsh-scope'], version)
    assert.equal(selected.overrides['@deepseek-ai/cordis'], manifest.dshCompatibility[version].cordis)
    assert.equal(selected.overrides['@deepseek-ai/cordis-plugin-loader'], manifest.dshCompatibility[version].loader)
    assert.equal(selected.overrides['@deepseek-ai/schemastery'], manifest.dshCompatibility[version].schemastery)
    assert.equal(run(root, 'ci-compatibility.mjs', ['select', version]).stdout.trim(), 'changed=false')
  }
  assert.notEqual(run(root, 'ci-compatibility.mjs', ['select', 'latest']).status, 0)
}))

test('compatibility reader rejects empty, ranged and malformed metadata', () => fixture(root => {
  for (const entries of [
    undefined, {}, [], { latest: { cordis: '4.0.5' } }, { '0.2.0-rc.1': { cordis: '*' } },
    { '0.2.2-rc.2': { cordis: '4.1.0', loader: '1.1.0', schemastery: '3.19.0', node: 23 } },
    { '0.2.2-rc.2': { cordis: '4.1.0', loader: '1.1.0', schemastery: '3.19.0', node: 22 } },
  ]) {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dshCompatibility: entries }))
    assert.throws(() => readCompatibility(join(root, 'package.json')))
  }
}))

test('verification records failures, continues independent checks and summarizes Node 24', { skip: process.platform === 'win32' }, () => fixture(root => {
  mkdirSync(join(root, 'bin'))
  const npm = join(root, 'bin/npm')
  writeFileSync(npm, `#!${process.execPath}\nprocess.exit(process.argv.includes(process.env.FAIL_STEP) ? 1 : 0)\n`)
  chmodSync(npm, 0o755)
  const major = process.versions.node.split('.')[0]
  const env = { PATH: `${root}/bin:${process.env.PATH}`, DSH_TEST_VERSION: '0.2.2-rc.3', FAIL_STEP: 'typecheck' }
  const result = run(root, 'ci-verify.mjs', ['verify', major], env)
  assert.equal(result.status, 1, result.stderr)
  let report = JSON.parse(readFileSync(join(root, `artifacts/ci/node-${major}.json`)))
  assert.equal(report.steps.find(s => s.name === 'typecheck').status, 'failed')
  assert.equal(report.steps.find(s => s.name === 'browser').status, 'passed')
  const summary = run(root, 'ci-verify.mjs', ['summary'], { ...env, SETUP_24: 'success', VERIFY_24: 'success', SMOKE24_RESULT: 'success' })
  assert.equal(summary.status, 0, summary.stderr)
  assert.match(summary.stdout, /failed/)
  assert.doesNotMatch(summary.stdout, /Node 22/)
  assert.match(summary.stdout, /Node 24 exact-host smoke: \*\*success\*\*/)
  const installFailure = run(root, 'ci-verify.mjs', ['verify', major], { ...env, FAIL_STEP: 'ci' })
  assert.equal(installFailure.status, 1)
  report = JSON.parse(readFileSync(join(root, `artifacts/ci/node-${major}.json`)))
  assert.ok(report.steps.slice(1).every(s => s.status === 'skipped'))
}))

test('workflow isolates PR validation from tag-only publishing with no artifact uploads', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on, { pull_request: null, push: { tags: ['v*'] } })
  assert.equal(workflow.jobs.publish.needs, undefined)
  assert.equal(workflow.jobs.publish.permissions['id-token'], 'write')
  const steps = workflow.jobs.verify.steps
  const at = id => steps.findIndex(s => s.id === id)
  assert.ok(at('npm24') >= 0 && at('setup-cohort') < at('npm24') && at('npm24') < at('cohort'))
  assert.equal(steps[at('npm24')].run, 'npm install --global npm@11.19.0')
  assert.equal(steps.find(s => s.id === 'setup-cohort').with['node-version'], '24.9.0')
  assert.ok(!steps.some(s => ['setup22', 'verify22', 'smoke'].includes(s.id)))
  assert.match(steps.find(s => s.id === 'cohort').run, /committed-package-lock\.json/)
  assert.match(steps.find(s => s.id === 'cohort').run, /--legacy-peer-deps=false/)
  assert.match(steps.find(s => s.id === 'verify24').if, /steps\.cohort\.outcome == 'success'/)
  assert.match(steps.find(s => s.id === 'verify24').if, /!cancelled\(\)/)
  assert.doesNotMatch(steps.find(s => s.id === 'verify24').if, /verify22|smoke/)
  assert.equal(steps.find(s => s.name === 'Test summary').if, 'always()')
  assert.match(steps.find(s => s.id === 'smoke24').if, /steps\.verify24\.outcome == 'success'/)
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(job.steps.every(s => !s.uses?.includes('artifact')))
  }
  const publishCommands = workflow.jobs.publish.steps.map(s => s.run ?? '').join('\n')
  assert.doesNotMatch(publishCommands, /npm (test|run (check|test|pack:check))/)
  assert.match(publishCommands, /npm publish --ignore-scripts/)
})
