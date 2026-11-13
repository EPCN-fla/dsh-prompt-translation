import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { isAgentLoopRequest, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Config, type Options } from './config.js'
import { defaultStorePath, TranslationStore } from './store.js'
import { PromptTranslationApi, promptTranslationContribution } from './api.js'
import { createTranslator, type Translator } from './translation.js'
import { translatePrompts, translateStream } from './pipeline.js'
import { detectLanguage, type ReturnLanguage } from './direction.js'

export const name = 'dsh-prompt-translation'
export const inject = ['llm', 'typert']
export { Config }
interface TurnTranslation { agent: object; options: Options; language?: ReturnLanguage; failure?: string }
class TranslationFailure extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : '翻译失败', { cause })
  }
}
/** Register translation through the host's lifecycle-owned public waterfalls. */
export function apply(ctx: Context, config: Config = {}, store = new TranslationStore(defaultStorePath(), config)): void {
  ctx.effect(() => ctx.typert.register(promptTranslationContribution))
  ctx.plugin(PromptTranslationApi, store)
  const lifecycle = new AbortController()
  let disposed = false
  // Session keys isolate parallel conversations; agent teardown releases their state.
  const turns = new Map<string, TurnTranslation>()
  const owners = new WeakSet<object>()
  const agentDisposers = new Set<() => void>()
  ctx.effect(() => () => {
    disposed = true
    lifecycle.abort(new Error('翻译插件已卸载'))
    turns.clear()
    for (const dispose of [...agentDisposers]) {
      agentDisposers.delete(dispose)
      try { dispose() } catch {}
    }
  })
  const signalFor = (signal?: AbortSignal) => AbortSignal.any([lifecycle.signal, ...(signal ? [signal] : [])])
  ctx.on('agent/pre-step', async ({ agent, signal, step }, next) => {
    if (disposed || lifecycle.signal.aborted) return next()
    const decision = await next()
    if (disposed || lifecycle.signal.aborted || decision.kind !== 'enter') return decision
    const key = String(agent.session.id)
    const options = store.read(key)
    if (!owners.has(agent)) {
      owners.add(agent)
      if (agent.ctx !== ctx) {
        const dispose = agent.ctx.effect(() => () => {
          agentDisposers.delete(dispose)
          if (turns.get(key)?.agent === agent) turns.delete(key)
        })
        agentDisposers.add(dispose)
      } else {
        agent.ctx.effect(() => () => {
          if (turns.get(key)?.agent === agent) turns.delete(key)
        })
      }
    }
    const human: UserMessage[] = decision.messages.filter(message => message.source.kind === 'user')
    const previous = turns.get(key)
    if (step === 1) turns.delete(key)
    if (!human.length) return decision
    const state: TurnTranslation = { agent, options }
    turns.delete(key); turns.set(key, state)
    if (!options.enabled) return decision
    try {
      if (options.reasoning || options.output) {
        const text = human.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
        if (!text.trim() && step > 1 && previous?.agent === agent && previous.language) {
          state.language = previous.language
        } else {
          state.language = await detectLanguage(text, options, ctx.llm, signalFor(signal))
        }
      }
      if (disposed || lifecycle.signal.aborted || turns.get(key) !== state) return decision
      if (!options.userPrompt) return decision
      const translated = await translatePrompts(decision.messages, createTranslator(options, ctx.llm), signalFor(signal), { source: state.language ?? options.source, target: options.target })
      if (disposed || lifecycle.signal.aborted || turns.get(key) !== state) return decision
      return { ...decision, messages: translated }
    } catch (error) {
      if (disposed || lifecycle.signal.aborted) return decision
      // Claiming precedes pre-step; throwing here loses the visible user/message.
      // Admit the original batch, then fail the stream BEFORE invoking the main model.
      if (turns.get(key) === state) {
        state.failure = (signal.aborted || lifecycle.signal.aborted) ? '翻译已取消' : error instanceof Error ? error.message : '翻译失败'
      }
      return decision
    }
  })
  ctx.on('llm/stream', (request, next) => {
    if (disposed || lifecycle.signal.aborted || !isAgentLoopRequest(request)) return next()
    const sessionId = request.sessionId === undefined ? undefined : String(request.sessionId)
    const state = sessionId === undefined ? undefined : turns.get(sessionId)
    const options = state?.options ?? store.read(sessionId)
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
    const streamSignal = signalFor(request.signal)
    const rawTranslate = createTranslator({ ...options, source: 'auto', target: language }, ctx.llm)
    const translate: Translator = async (text, signal) => {
      try { return await rawTranslate(text, signal) }
      catch (error) { throw new TranslationFailure(error) }
    }
    return (async function* (): AsyncIterable<StreamChunk> {
      try {
        yield* translateStream(next(), options, translate, streamSignal)
      } catch (error) {
        if (error instanceof TranslationFailure || streamSignal.aborted) {
          if (streamSignal.aborted) {
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '翻译已取消' } } }
          } else {
            yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TRANSLATION_FAILED', message: error instanceof Error ? error.message : '翻译失败' } } }
          }
          return
        }
        throw error
      }
    })()
  })
}
