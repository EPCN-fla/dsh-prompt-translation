import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Options } from './options.js'
export const AUDIT_KEY = 'dshPromptTranslation'
export interface PromptAudit {
  version: 1
  source: Options['source']
  target: Options['target']
  original: readonly ContentBlock[]
}
/** Read only the plugin-owned, versioned metadata; old messages remain unchanged. */
export function promptAudit(source: unknown): PromptAudit | undefined {
  if (!source || typeof source !== 'object') return
  const value = (source as Record<string, unknown>)[AUDIT_KEY] as PromptAudit | undefined
  if (value?.version !== 1 || !Array.isArray(value.original) || typeof value.source !== 'string' || typeof value.target !== 'string') return
  if (!value.original.every(block => block && typeof block === 'object' && typeof block.type === 'string' && (block.type !== 'text' || typeof block.text === 'string'))) return
  return value
}

export const ASSISTANT_AUDIT_KEY = 'dshAssistantTranslation'
export interface AssistantAudit {
  version: 1
  original: string
}
/** Original text belongs to the completed block, never to provider replay metadata. */
export function assistantAudit(block: unknown): AssistantAudit | undefined {
  if (!block || typeof block !== 'object') return
  const value = (block as Record<string, unknown>)[ASSISTANT_AUDIT_KEY] as AssistantAudit | undefined
  if (value?.version !== 1 || typeof value.original !== 'string') return
  return value
}
