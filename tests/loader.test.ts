import { readFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import LlmRuntime, { createUserMessage, createSystemMessage, LlmAdapter, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'

it('loads the built bundle through the real Loader and runs prompt → model → translated stream without recursion', async () => {
  const ctx = new Context()
  const requests: GenerateOptions[] = []
  class Adapter extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(options)
      const input = options.messages.at(-1)?.content.find(b => b.type === 'text')
      const text = options.model === 'translator' ? `translated:${input?.type === 'text' ? input.text : ''}` : 'model answer'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'translation-loader-home-'))
  process.env.DSH_HOME = home
  try {
    ctx.baseUrl = pathToFileURL(resolve('cordis.patch.yml')).href
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['fixture'], new Adapter())
    await ctx.plugin(Loader)
    ctx.loader.internal = undefined
    const patches = parse(await readFile('cordis.patch.yml', 'utf8'))
    for (const row of patches[0].insert) await ctx.loader.create({ ...row, name: pathToFileURL(resolve('lib/index.js')).href, config: { enabled: true, type: 'agent', provider: 'fixture', model: 'translator', output: true, source: 'zh' } })
    await ctx.loader.await()
    expect(ctx.loader.resolve('prompt-translation').fiber?.state).toBe(2)
    const original = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] })
    const decision = await ctx.waterfall('agent/pre-step', { signal: new AbortController().signal, messages: [original], turn: 1, step: 1, agent: { session: { id: 'test-session' }, ctx } as never }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [original] }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('unexpected rejection')
    const system = createSystemMessage('SYSTEM DO NOT TRANSLATE')
    const request = markAgentLoopRequest({ provider: 'fixture', model: 'main', sessionId: 'test-session' as never, messages: [system, ...decision.messages] })
    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream(request)) chunks.push(chunk)
    expect(requests).toHaveLength(3)
    expect(requests[0]!.system).toContain('to English.')
    expect(requests[2]!.system).toContain('to 简体中文.')
    expect(requests[1]!.messages[0]).toEqual(system)
    expect(decision.messages[0]!.id).toBe(original.id)
    expect(decision.messages[0]!.content).toEqual([{ type: 'text', text: 'translated:你好' }])
    expect(chunks.find(c => c.type === 'block-end')).toMatchObject({ block: { text: 'translated:model answer' } })
    expect({ request: requests[1]!.messages.map(m => ({ role: m.role, content: m.content })), chunks }).toMatchSnapshot()
    ctx.loader.remove('prompt-translation')
    await ctx.loader.await()
    const after = await ctx.waterfall('agent/pre-step', { signal: new AbortController().signal, messages: [original], turn: 2, step: 1, agent: { session: { id: 'test-session' }, ctx } as never }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [original] }))
    expect(after).toEqual({ kind: 'enter', messages: [original] })
    expect(requests).toHaveLength(3)
  } finally {
    await ctx.fiber.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
