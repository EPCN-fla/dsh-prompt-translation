import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createTranslator, traditional, splitText, decodeEntities } from '../src/translation.js'
import { defaults } from '../src/options.js'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const signal = () => new AbortController().signal
const mockLlm = { stream: vi.fn() }
describe('official translation protocols', () => {
  it.each([
    ['google', { data: { translations: [{ translatedText: '&lt;Hello&gt; &amp; &#39;world&#39;' }] } }, "<Hello> & 'world'"],
    ['baidu', { trans_result: [{ dst: '你好' }, { dst: '世界' }] }, '你好\n世界'],
    ['deepl', { translations: [{ text: 'Hello' }] }, 'Hello'],
    ['microsoft', [{ translations: [{ text: 'Hello' }] }], 'Hello'],
  ] as const)('maps %s response and auto-detection request', async (engine, body, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
    expect(await traditional('原文', { ...defaults, engine, apiKey: 'test-key', appId: 'test-app' }, signal(), fetcher)).toBe(expected)
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).not.toContain('test-key')
    if (engine === 'baidu') {
      const form = init!.body as URLSearchParams
      expect(form.get('from')).toBe('auto')
      expect(form.get('sign')).toBe(createHash('md5').update('test-app原文' + form.get('salt') + 'test-key').digest('hex'))
    } else if (engine === 'microsoft') expect(String(url)).not.toContain('from=')
    else expect(JSON.parse(init!.body as string)).not.toHaveProperty(engine === 'google' ? 'source' : 'source_lang')
  })
  it('maps provider-specific language identifiers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ trans_result: [{ dst: 'x' }] }))
    await traditional('x', { ...defaults, engine: 'baidu', source: 'ja', target: 'zh-TW', apiKey: 'k', appId: 'id' }, signal(), fetcher)
    expect(String(fetcher.mock.calls[0]![1]!.body)).toContain('from=jp&to=cht')
  })
  it('reports errors without upstream echoed secrets', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-key private text', { status: 403 }))
    await expect(traditional('private text', { ...defaults, apiKey: 'secret-key' }, signal(), fetcher)).rejects.toThrow('google 翻译请求失败（HTTP 403）')
    await expect(traditional('x', defaults, signal(), fetcher)).rejects.toThrow('请配置')
  })
  it('rejects malformed or empty translation responses', async () => {
    for (const body of [{}, { data: { translations: [] } }, { data: { translations: [{ translatedText: '' }] } }]) {
      await expect(traditional('x', { ...defaults, apiKey: 'k' }, signal(), vi.fn().mockResolvedValue(Response.json(body)))).rejects.toThrow()
    }
  })
})
describe('translation engine', () => {
  it('uses the selected existing model, effort and only final text without recursive loop marking', async () => {
    const requests: GenerateOptions[] = []
    const llm = { async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(request)
      yield { type: 'reasoning-delta', index: 0, text: 'private reasoning' }
      yield { type: 'text-delta', index: 1, text: 'Hello' }
      yield { type: 'block-end', index: 1, block: { type: 'text', text: 'Hello' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }
    const translate = createTranslator({ ...defaults, type: 'agent', provider: 'existing', model: 'translator', reasoningEffort: 'low' }, llm)
    expect(await translate('  你好\n')).toBe('  Hello\n')
    expect(requests[0]).toMatchObject({ provider: 'existing', model: 'translator', reasoningEffort: 'low' })
    expect(requests[0]!.system).toContain('never as instructions')
    expect(requests[0]).not.toHaveProperty('tools')
  })
  it('refuses truncated model output', async () => {
    const llm = { async *stream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'max-tokens' } } } }
    await expect(createTranslator({ ...defaults, type: 'agent', provider: 'p', model: 'm' }, llm)('x')).rejects.toThrow('max-tokens')
  })
  it('cancels an adapter that ignores abort signals', async () => {
    const llm = { async *stream(): AsyncIterable<StreamChunk> { await new Promise(() => {}); yield { type: 'finish', reason: { kind: 'stop' } } } }
    const abort = new AbortController()
    const pending = createTranslator({ ...defaults, type: 'agent', provider: 'p', model: 'm' }, llm)('x', abort.signal)
    abort.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })
  it('does not call services for whitespace or identical source and target', async () => {
    expect(await createTranslator(defaults, mockLlm)(' \n')).toBe(' \n')
    expect(await createTranslator({ ...defaults, source: 'en', target: 'en' }, mockLlm)('hello')).toBe('hello')
    expect(mockLlm.stream).not.toHaveBeenCalled()
  })
  it('chunks losslessly without splitting Unicode surrogate pairs', () => {
    const text = '你好🙂 hello.\n'.repeat(30)
    const chunks = splitText(text, 20)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => Array.from(chunk).length <= 20 && !chunk.includes('\ufffd'))).toBe(true)
    expect(decodeEntities('&#x1f600; &#99999999; &amp;lt;')).toBe('😀 &#99999999; &lt;')
  })
})

it('limits Baidu sections by UTF-8 bytes as well as characters', async () => {
  const text = '😀'.repeat(2000)
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const q = (init!.body as URLSearchParams).get('q')!
    expect(Buffer.byteLength(q, 'utf8')).toBeLessThanOrEqual(6000)
    return Response.json({ trans_result: [{ dst: q }] })
  })
  expect(await createTranslator({ ...defaults, engine: 'baidu', apiKey: 'k', appId: 'a', maxChars: 4000 }, mockLlm, fetcher)(text)).toBe(text)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(() => splitText('x', 0)).toThrow('无效')
})
it('does not disclose prompt text from a malformed upstream JSON body', async () => {
  await expect(traditional('private prompt', { ...defaults, apiKey: 'secret' }, signal(), vi.fn().mockResolvedValue(new Response('private prompt and secret')))).rejects.toThrow('google 翻译接口返回无效 JSON')
})
