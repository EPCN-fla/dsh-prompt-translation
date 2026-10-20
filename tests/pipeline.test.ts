import { expect, it, vi } from 'vitest'
import { translatePrompts, translateStream } from '../src/pipeline.js'
import { defaults } from '../src/options.js'
import type { UserMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
async function* source(chunks: StreamChunk[]) { yield* chunks }
async function collect(stream: AsyncIterable<StreamChunk>) { const result = []; for await (const c of stream) result.push(c); return result }
it('preserves user identity, attachments, injected context and original immutable input', async () => {
  const user = Object.freeze({ id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }, { type: 'image', attachment: { id: 'image' } }] }) as unknown as UserMessage
  const injected = { ...user, id: 'context', source: { kind: 'runtime-context' } } as unknown as UserMessage
  const translate = vi.fn(async () => 'hello')
  const result = await translatePrompts([user, injected], translate)
  expect(result[0]).toMatchObject({ id: 'user-1', content: [{ type: 'text', text: 'hello' }, user.content[1]] })
  expect(result[1]).toBe(injected)
  expect(user.content[0]).toEqual({ type: 'text', text: '你好' })
  expect(translate).toHaveBeenCalledTimes(1)
})
it('translates completed blocks consistently and preserves tool/usage/finish payloads', async () => {
  const chunks: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'think' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: 'answer' },
    { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
    { type: 'block-start', index: 2, blockType: 'tool-call' },
    { type: 'block-end', index: 2, block: { type: 'tool-call', id: 'call' as never, name: 'read', arguments: '{"path":"/tmp/a"}' } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { signature: 'original' } } },
  ]
  const result = await collect(translateStream(source(chunks), { ...defaults, reasoning: true, output: true }, async text => `译:${text}`))
  expect(result).toMatchSnapshot()
  expect(result.slice(6, 9)).toEqual(chunks.slice(6, 9))
  expect(result.at(-1)).not.toHaveProperty('replayState')
})
it('passes disabled content and failed stream outcomes through untouched', async () => {
  const chunks: StreamChunk[] = [{ type: 'text-delta', index: 0, text: 'partial' }, { type: 'finish', reason: { kind: 'error', failure: { code: 'NETWORK', message: 'failed' } } }]
  const translate = vi.fn(async (x: string) => x)
  expect(await collect(translateStream(source(chunks), defaults, translate))).toEqual(chunks)
  expect(translate).not.toHaveBeenCalled()
})

it('persists reasoning and answer originals through the real assembler without changing translated text', async () => {
  const { BlockAssembler } = await import('@deepseek-ai/dsh-llm')
  const { assistantAudit } = await import('../src/audit.js')
  const chunks: StreamChunk[] = [
    { type: 'block-end', index: 2, block: { type: 'reasoning', text: 'original thought' } },
    { type: 'block-end', index: 4, block: { type: 'text', text: 'original answer' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const assembler = new BlockAssembler()
  for await (const chunk of translateStream(source(chunks), { ...defaults, reasoning: true, output: true }, async text => `译:${text}`)) assembler.push(chunk)
  const restored = JSON.parse(JSON.stringify(assembler.message({ provider: 'fixture', model: 'main' })))
  expect(restored.content.map((block: { text: string }) => block.text)).toEqual(['译:original thought', '译:original answer'])
  expect(restored.content.map(assistantAudit)).toEqual([{ version: 1, original: 'original thought' }, { version: 1, original: 'original answer' }])
  expect(chunks[0]).not.toHaveProperty('block.dshAssistantTranslation')
})
it('annotates only enabled completed blocks, retaining unchanged translations and partial failures accurately', async () => {
  const { assistantAudit } = await import('../src/audit.js')
  const chunks: StreamChunk[] = [
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'untouched' } },
    { type: 'block-end', index: 1, block: { type: 'text', text: 'already in target language' } },
    { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { id: 'original' } } },
  ]
  const result = await collect(translateStream(source(chunks), { ...defaults, output: true }, async text => text))
  expect(result[0]).toBe(chunks[0])
  const translated = result.find(chunk => chunk.type === 'block-end' && chunk.index === 1)
  expect(assistantAudit(translated?.type === 'block-end' ? translated.block : undefined)?.original).toBe('already in target language')
  expect(result.at(-1)).toBe(chunks.at(-1))
  const seen: StreamChunk[] = []
  const stream = translateStream(source(chunks), { ...defaults, output: true }, async () => { throw new Error('failure') })
  await expect((async () => { for await (const chunk of stream) seen.push(chunk) })()).rejects.toThrow('failure')
  expect(seen).toEqual([chunks[0]])
})
