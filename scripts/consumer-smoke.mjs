import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = resolve(process.argv[2] ?? '.')
const require = createRequire(pathToFileURL(resolve(root, 'package.json')))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: Loader } = await load('@deepseek-ai/cordis-plugin-loader')
const { default: LlmRuntime, LlmAdapter, createUserMessage, createSystemMessage, markAgentLoopRequest } = await load('@deepseek-ai/dsh-llm')
const { parse } = await load('yaml')
const requests = []
class Adapter extends LlmAdapter {
  async *stream(request) {
    requests.push(request)
    const input = request.messages.at(-1).content.find(b => b.type === 'text').text
    const text = request.model === 'translator' ? `translated:${input}` : 'answer'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const ctx = new Context()
try {
  ctx.baseUrl = pathToFileURL(resolve(root, 'cordis.yml')).href
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  await ctx.plugin(Loader)
  ctx.loader.internal = undefined
  const patch = parse(await readFile(require.resolve('dsh-prompt-translation/cordis.patch.yml'), 'utf8'))
  for (const row of patch[0].insert) await ctx.loader.create({ ...row, name: pathToFileURL(require.resolve(row.name)).href, config: { enabled: true, type: 'agent', provider: 'fixture', model: 'translator', output: true, source: 'zh' } })
  await ctx.loader.await()
  assert.equal(ctx.loader.resolve('prompt-translation').fiber?.state, 2)
  const original = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] })
  const signal = new AbortController().signal
  const decision = await ctx.waterfall('agent/pre-step', { signal, messages: [original], agent: { session: { id: 'test-session' }, ctx }, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [original] }))
  assert.equal(decision.messages[0].content[0].text, 'translated:你好')
  assert.equal(decision.messages[0].id, original.id)
  const system = createSystemMessage('SYSTEM UNCHANGED')
  const output = []
  for await (const chunk of ctx.llm.stream(markAgentLoopRequest({ provider: 'fixture', model: 'main', sessionId: 'test-session', messages: [system, ...decision.messages] }))) output.push(chunk)
  assert.equal(output.find(c => c.type === 'block-end').block.text, 'translated:answer')
  assert.deepEqual(requests[1].messages[0], system)
  assert.equal(requests.length, 3)
  ctx.loader.remove('prompt-translation')
  await ctx.loader.await()
  const after = await ctx.waterfall('agent/pre-step', { signal, messages: [original], agent: { session: { id: 'test-session' }, ctx }, turn: 2, step: 1 }, async () => ({ kind: 'enter', messages: [original] }))
  assert.deepEqual(after.messages, [original])
  const version = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-llm/package.json'), 'utf8')).version
  console.log(JSON.stringify({ version, result: 'pass', evidence: ['packed entry', 'real Loader', 'real LlmRuntime', 'human prompt translation', 'unchanged system', 'output translation', 'no recursion', 'unload'], limitation: 'No complete DSH application/Profile boot or credentialed provider request' }))
} finally { await ctx.fiber.dispose() }
