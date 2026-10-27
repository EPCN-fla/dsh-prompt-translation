// Test-only deterministic external model. Runs inside the actual DSH Web Profile.
import { LlmAdapter, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { appendFile } from 'node:fs/promises'
import Schema from '@deepseek-ai/schemastery'
export const name = 'translation-smoke-model'
export const inject = ['llm']
export const Config = Schema.object({ log: Schema.string().required() })
export function apply(ctx, config) {
  class Adapter extends LlmAdapter {
    async listModels(provider) {
      return ['main', 'translator'].map(id => ({ provider, id, name: id }))
    }
    async resolveModel(provider, id) {
      return { provider, id, name: id, context: { contextWindow: 128000 }, defaultMaxTokens: 4096 }
    }
    async *stream(request) {
      const text = request.messages.filter(m => m.role === 'user').flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join('\n')
      if (request.model === 'translator' && text.includes('FAIL_TRANSLATION')) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE_FAILURE', message: 'test translation failure' } } }
        return
      }
      await appendFile(config.log, JSON.stringify({ model: request.model, sessionId: request.sessionId, loop: isAgentLoopRequest(request), system: request.system, messages: request.messages }) + '\n')
      const values = request.model === 'translator'
        ? [{ type: 'text', text: request.system?.startsWith('Detect the language') ? 'zh' : request.system?.includes('to 日本語.') ? `日本語:${text}` : request.system?.includes('to English.') ? `English:${text}` : `中文:${text}` }]
        : [{ type: 'reasoning', text: 'SMOKE_THINK' }, { type: 'text', text: 'SMOKE_ANSWER' }]
      for (const [index, block] of values.entries()) {
        yield { type: 'block-start', index, blockType: block.type }
        yield { type: block.type === 'reasoning' ? 'reasoning-delta' : 'text-delta', index, text: block.text }
        yield { type: 'block-end', index, block }
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['translation-smoke'], new Adapter())
}
