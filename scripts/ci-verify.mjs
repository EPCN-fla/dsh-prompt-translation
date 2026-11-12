/** Run the Node 24 verification leg or render its GitHub Actions Summary. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readCompatibility } from './ci-compatibility.mjs'

const [mode, major] = process.argv.slice(2)
const directory = resolve('artifacts/ci')
const versions = Object.keys(readCompatibility().entries)
const version = process.env.DSH_TEST_VERSION
if (!versions.includes(version)) throw new Error('DSH_TEST_VERSION must name a supported exact version')

if (mode === 'summary') {
  const lines = [`## DSH ${version} — Node 24`, '',
    '| Node | Setup | Verification | Install | Typecheck | Tests | Scripts | Build | Package | Browser |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
  let report
  try { report = JSON.parse(readFileSync(`${directory}/node-24.json`, 'utf8')) } catch { /* A failed setup has no report. */ }
  const status = key => report?.steps.find(step => step.name === key)?.status ?? 'not run'
  lines.push(`| ${report?.node ?? 24} | ${process.env.SETUP_24 ?? 'unknown'} | ${process.env.VERIFY_24 ?? 'unknown'} | ${status('install')} | ${status('typecheck')} | ${status('test')} | ${status('scripts')} | ${status('build')} | ${status('package')} | ${status('browser')} |`)
  lines.push('', `Node 24 exact-host smoke: **${process.env.SMOKE24_RESULT ?? 'not run'}**.`,
    '', 'Logs and temporary tarballs stay on the runner; no artifacts or GitHub Release are uploaded.', '')
  const text = lines.join('\n')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  else process.stdout.write(text)
} else if (mode === 'verify' && major === '24') {
  if (process.versions.node.split('.')[0] !== major) throw new Error(`Expected Node ${major}, got ${process.version}`)
  mkdirSync(directory, { recursive: true })
  const report = { node: process.version, dsh: version, steps: [] }
  const save = () => writeFileSync(`${directory}/node-${major}.json`, `${JSON.stringify(report, null, 2)}\n`)
  const run = (name, args) => {
    console.log(`::group::Node ${major}: ${name}`)
    const result = spawnSync('npm', args, { encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    if (result.error) console.error(result.error.message)
    console.log('::endgroup::')
    const status = result.status === 0 ? 'passed' : 'failed'
    report.steps.push({ name, status, exitCode: result.status })
    save()
    return status === 'passed'
  }
  // Install the selected cohort without lifecycle scripts; later steps reuse it.
  if (run('install', ['ci', '--ignore-scripts'])) {
    run('typecheck', ['run', 'typecheck'])
    run('test', ['run', 'test'])
    run('scripts', ['run', 'test:scripts'])
    if (run('build', ['run', 'build'])) {
      run('package', ['run', 'pack:check'])
      run('browser', ['run', 'test:browser'])
    } else {
      for (const name of ['package', 'browser']) report.steps.push({ name, status: 'skipped' })
      save()
    }
  } else {
    for (const name of ['typecheck', 'test', 'scripts', 'build', 'package', 'browser']) report.steps.push({ name, status: 'skipped' })
    save()
  }
  process.exitCode = report.steps.some(step => step.status === 'failed') ? 1 : 0
} else {
  throw new Error('Usage: node scripts/ci-verify.mjs verify 24 | summary')
}
