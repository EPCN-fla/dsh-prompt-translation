import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, markAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { apply } from '../src/index.js'
import { defaults } from '../src/options.js'
import { detectLanguage, normalizeLanguage } from '../src/direction.js'
import { traditional } from '../src/translation.js'

it('normalizes provider detection codes without inventing unknown languages', () => {
  expect(normalizeLanguage('ZH-HANT')).toBe('zh-TW')
  expect(normalizeLanguage('jp')).toBe('ja')
  expect(normalizeLanguage('fra')).toBe('fr')
  expect(normalizeLanguage('unknown')).toBeUndefined()
  expect(normalizeLanguage('auto')).toBeUndefined()
})
it.each([
  ['google', { data: { translations: [{ translatedText: 'x', detectedSourceLanguage: 'zh-CN' }] } }, 'zh-CN'],
  ['baidu', { from: 'zh', trans_result: [{ dst: 'x' }] }, 'zh'],
  ['deepl', { translations: [{ text: 'x', detected_source_language: 'ZH' }] }, 'ZH'],
  ['microsoft', [{ detectedLanguage: { language: 'zh-Hans' }, translations: [{ text: 'x' }] }], 'zh-Hans'],
] as const)('reads %s source detection from provider metadata', async (engine, response, code) => {
  const detected = vi.fn()
  await traditional('你好', { ...defaults, engine, apiKey: 'k', appId: 'id' }, new AbortController().signal, vi.fn().mockResolvedValue(Response.json(response)), detected)
  expect(detected).toHaveBeenCalledWith(code)
})
it('isolates return languages and preserves failed input until a terminal error before main dispatch', async () => {
  const ctx = new Context()
  const calls: GenerateOptions[] = []
  const llm = { async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    calls.push(request)
    const block = request.messages[0]?.content[0]
    const text = block?.type === 'text' ? block.text : ''
    if (text === 'FAIL') throw new Error('translation failed')
    const output = request.system?.startsWith('Detect') ? (text === '你好' ? 'zh' : 'fr') : `translated:${text}`
    yield { type: 'block-end', index: 0, block: { type: 'text', text: output } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  ctx.reflect.provide('llm', llm)
  const config = { ...defaults, enabled: true, type: 'agent' as const, target: 'ja' as const, provider: 'fixture', model: 'translator', reasoning: true, output: true }
  apply(ctx, config)
  const admit = async (id: string, text: string) => {
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
    const decision = await ctx.waterfall('agent/pre-step', { agent: { session: { id }, ctx } as never, signal: new AbortController().signal, messages: [message], turn: 1, step: 1 }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [message] }))
    return { message, decision }
  }
  const main = vi.fn(async function* (): AsyncIterable<StreamChunk> {
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const answer = async (id: string) => {
    const request = markAgentLoopRequest({ provider: 'fixture', model: 'main', sessionId: id as never, messages: [] })
    const chunks = []
    for await (const chunk of ctx.waterfall('llm/stream', request, main)) chunks.push(chunk)
    return chunks
  }
  try {
    await admit('chinese', '你好')
    await admit('french', 'Bonjour')
    await answer('french')
    expect(calls.at(-1)?.system).toContain('to Français.')
    await answer('chinese')
    expect(calls.at(-1)?.system).toContain('to 简体中文.')
    expect(calls.filter(call => call.system?.includes('to 日本語.'))).toHaveLength(2)
    const { message, decision } = await admit('failure', 'FAIL')
    expect(decision).toEqual({ kind: 'enter', messages: [message] })
    const before = main.mock.calls.length
    expect(await answer('failure')).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSLATION_FAILED' } } }])
    expect(main.mock.calls).toHaveLength(before)
    // The next human turn clears the failure and can complete normally.
    await admit('failure', '你好')
    expect((await answer('failure')).at(-1)).toMatchObject({ reason: { kind: 'stop' } })
  } finally { await ctx.fiber.dispose() }
})
it('rejects uncertain detection and cancels a nonresponsive detector', async () => {
  const options = { ...defaults, type: 'agent' as const, provider: 'p', model: 'm' }
  const unknown = { async *stream(): AsyncIterable<StreamChunk> { yield { type: 'text-delta', index: 0, text: 'unknown' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  await expect(detectLanguage('?', options, unknown, new AbortController().signal)).rejects.toThrow('明确选择')
  const abort = new AbortController()
  const pending = detectLanguage('hello', options, { async *stream(): AsyncIterable<StreamChunk> { await new Promise(() => {}); yield { type: 'finish', reason: { kind: 'stop' } } } }, abort.signal)
  abort.abort(new Error('cancelled'))
  await expect(pending).rejects.toThrow('cancelled')
})

it('reads a new target for the next turn and pins the current return direction during edits', async () => {
  const ctx = new Context()
  const calls: GenerateOptions[] = []
  let target: 'ja' | 'en' = 'ja'
  let source: 'zh' | 'fr' = 'zh'
  const llm = { async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    calls.push(request)
    yield { type: 'block-end', index: 0, block: { type: 'text', text: request.system?.includes('to 日本語.') ? '日语' : 'English' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  ctx.reflect.provide('llm', llm)
  apply(ctx, { ...defaults, enabled: true, type: 'agent', provider: 'fixture', model: 'translator', output: true, target: { get: () => target }, source: { get: () => source } })
  const agent = { session: { id: 'switch' }, ctx } as never
  const admit = async (turn: number) => {
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] })
    return ctx.waterfall('agent/pre-step', { agent, signal: new AbortController().signal, messages: [message], turn, step: 1 }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [message] }))
  }
  try {
    await admit(1)
    expect(calls.at(-1)?.system).toContain('to 日本語.')
    target = 'en'
    await admit(2)
    expect(calls.at(-1)?.system).toContain('to English.')
    source = 'fr' // A UI edit during generation must not change this turn's return language.
    const request = markAgentLoopRequest({ provider: 'fixture', model: 'main', sessionId: 'switch' as never, messages: [] })
    const output = ctx.waterfall('llm/stream', request, async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'reply' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    for await (const _chunk of output) { /* consume */ }
    expect(calls.at(-1)?.system).toContain('to 简体中文.')
  } finally { await ctx.fiber.dispose() }
})
