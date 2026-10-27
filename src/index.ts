import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { isAgentLoopRequest, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Config, readConfig, readSessionConfig, type LiveConfig, type Options } from './config.js'
import { createTranslator } from './translation.js'
import { translatePrompts, translateStream } from './pipeline.js'
import { detectLanguage, type ReturnLanguage } from './direction.js'

export const name = 'dsh-prompt-translation'
export const inject = ['llm']
export { Config }
interface TurnTranslation { options: Options; language?: ReturnLanguage; failure?: string }
/** Register translation through the host's lifecycle-owned public waterfalls. */
export function apply(ctx: Context, config: LiveConfig): void {
  const lifecycle = new AbortController()
  // Session keys isolate parallel conversations; agent teardown releases their state.
  const turns = new Map<string, TurnTranslation>()
  const owners = new WeakSet<object>()
  ctx.effect(() => () => { lifecycle.abort(new Error('翻译插件已卸载')); turns.clear() })
  const signalFor = (signal?: AbortSignal) => AbortSignal.any([lifecycle.signal, ...(signal ? [signal] : [])])
  ctx.on('agent/pre-step', async ({ agent, signal, step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const key = String(agent.session.id)
    const options = readSessionConfig(config, key)
    if (!options.enabled) { turns.delete(key); return decision }
    if (!owners.has(agent)) {
      owners.add(agent)
      agent.ctx.effect(() => () => { turns.delete(key) })
    }
    const human: UserMessage[] = decision.messages.filter(message => message.source.kind === 'user')
    if (step === 1) turns.delete(key)
    if (!human.length) return decision
    const state: TurnTranslation = { options }
    turns.delete(key); turns.set(key, state)
    try {
      if (options.reasoning || options.output) {
        const text = human.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
        state.language = await detectLanguage(text, options, ctx.llm, signalFor(signal))
      }
      if (!options.userPrompt) return decision
      return { ...decision, messages: await translatePrompts(decision.messages, createTranslator(options, ctx.llm), signalFor(signal), { source: state.language ?? options.source, target: options.target }) }
    } catch (error) {
      // Claiming precedes pre-step; throwing here loses the visible user/message.
      // Admit the original batch, then fail the stream BEFORE invoking the main model.
      state.failure = signal.aborted ? '翻译已取消' : error instanceof Error ? error.message : '翻译失败'
      return decision
    }
  })
  ctx.on('llm/stream', (request, next) => {
    if (!isAgentLoopRequest(request)) return next()
    const sessionId = request.sessionId === undefined ? undefined : String(request.sessionId)
    const state = sessionId === undefined ? undefined : turns.get(sessionId)
    const options = state?.options ?? (sessionId === undefined ? readConfig(config) : readSessionConfig(config, sessionId))
    if (!options.enabled) return next()
    const failure = state?.failure
    if (failure) return (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSLATION_FAILED', message: failure } } }
    })()
    if (!options.reasoning && !options.output) return next()
    const language = options.source === 'auto' ? state?.language : options.source
    if (!language) return (async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSLATION_LANGUAGE_UNKNOWN', message: '未确定本轮原始语言，请明确选择原始语言后重试。' } } }
    })()
    // Answers may already use the user's language, so detect their source independently.
    return translateStream(next(), options, createTranslator({ ...options, source: 'auto', target: language }, ctx.llm), signalFor(request.signal))
  })
}
