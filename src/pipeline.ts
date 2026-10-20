import { freezeMessage, type StreamChunk, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Options } from './config.js'
import { AUDIT_KEY, ASSISTANT_AUDIT_KEY, promptAudit } from './audit.js'
import type { Translator } from './translation.js'

/** Translate only actual human text, retaining identity and all non-text blocks. */
export async function translatePrompts(messages: UserMessage[], translate: Translator, signal?: AbortSignal, direction?: Pick<Options, 'source' | 'target'>): Promise<UserMessage[]> {
  const result: UserMessage[] = []
  for (const message of messages) {
    if (message.source.kind !== 'user') { result.push(message); continue }
    const original = promptAudit(message.source)?.original ?? message.content
    const content = []
    for (const block of original) content.push(block.type === 'text' ? { ...block, text: await translate(block.text, signal) } : block)
    result.push(freezeMessage({ ...message, content, source: { ...message.source, ...(direction ? { [AUDIT_KEY]: { version: 1, ...direction, original } } : {}) } }))
  }
  return result
}

/** Translate assembled text blocks; retain block indexes, tool payloads, accounting and terminal outcomes. */
export async function* translateStream(stream: AsyncIterable<StreamChunk>, options: Options, translate: Translator, signal?: AbortSignal): AsyncIterable<StreamChunk> {
  const selected = (type: string) => type === 'text' ? options.output : type === 'reasoning' && options.reasoning
  let changed = false
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    if (chunk.type === 'text-delta' && options.output || chunk.type === 'reasoning-delta' && options.reasoning) continue
    if (chunk.type === 'block-end' && selected(chunk.block.type) && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) {
      const text = await translate(chunk.block.text, signal)
      changed ||= text !== chunk.block.text
      yield { type: chunk.block.type === 'text' ? 'text-delta' : 'reasoning-delta', index: chunk.index, text }
      const block = { ...chunk.block, text, [ASSISTANT_AUDIT_KEY]: { version: 1 as const, original: chunk.block.text } }
      yield { ...chunk, block }
    } else if (chunk.type === 'finish' && changed && chunk.replayState !== undefined) {
      // Signed/native provider text no longer describes the translated durable blocks.
      const { replayState: _stale, ...finish } = chunk
      yield finish
    } else yield chunk
  }
}
