import { readCompatibility } from './ci-compatibility.mjs'
import { execFileSync } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
const source = process.argv[2]
if (!source) throw new Error('Usage: node scripts/compatibility.mjs /path/to/deepseek-harness')
const versions = Object.keys(readCompatibility().entries)
const seams = {
  'packages/core/agent/src/runtime-types.ts': ['agent/pre-step', "kind: 'enter'", 'messages: UserMessage[]'],
  'packages/llm/llm/src/index.ts': ['llm/stream', 'isAgentLoopRequest', 'freezeMessage'],
  'packages/llm/llm/src/types.ts': ["type: 'text-delta'", "type: 'reasoning-delta'", "type: 'block-end'", 'replayState?: ReplayEnvelope'],
  'packages/client/ui-conversation/src/client/contract/slots.ts': ['conversation.input.left', 'conversation.input.permission'],
  'packages/client/ui-renderer/src/client/scoped-slots.tsx': ['data-slot={slotKey}'],
  'packages/client/ui-session/src/client/index.ts': ['sessionId: SessionId'],
  'packages/settings/settings/src/index.ts': ['revision: number', 'configure(', 'node?.dict?.[head] ?? node?.inner'],
  'packages/api/session-controller/src/index.ts': ["@Remote('modelCatalog')"],
}
const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
const results = versions.map(version => {
  const tag = `dsh-v${version}`
  const checks = Object.entries(seams).map(([path, tokens]) => {
    const text = git(['show', `${tag}:${path}`])
    // message helpers are re-exported from message.ts.
    const checked = tokens.filter(token => token !== 'freezeMessage')
    const missing = checked.filter(token => !text.includes(token))
    return { path, blob: git(['rev-parse', `${tag}:${path}`]), missing }
  })
  const message = git(['show', `${tag}:packages/llm/llm/src/message.ts`])
  checks.push({ path: 'packages/llm/llm/src/message.ts', blob: git(['rev-parse', `${tag}:packages/llm/llm/src/message.ts`]), missing: message.includes('export function freezeMessage') ? [] : ['freezeMessage'] })
  return { version, sha: git(['rev-parse', `${tag}^{commit}`]), checks, passed: checks.every(check => check.missing.length === 0) }
})
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/compatibility.json', JSON.stringify(results, null, 2) + '\n')
console.log(results.map(row => `${row.version} ${row.sha} ${row.passed ? 'PASS' : 'FAIL'}`).join('\n'))
if (results.some(row => !row.passed)) process.exitCode = 1
