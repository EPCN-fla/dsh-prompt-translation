import type { SettingsPathOp } from '../options.js'
import type { DescribeReply, Reply, SettingsApi } from './settings.js'

export interface ConnectionRpcLike {
  call(channel: '/api', endpoint: string, payload: unknown): Promise<unknown>
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isReply(value: unknown): value is Reply<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false
  if (value.ok) return 'value' in value
  return isRecord(value.error) && typeof value.error.code === 'string' && typeof value.error.message === 'string'
}
function isDescribeReply(value: unknown): value is DescribeReply {
  if (!isReply(value) || !value.ok) return isReply(value)
  const result = value.value
  return isRecord(result) && typeof result.writable === 'boolean' && Array.isArray(result.namespaces)
    && result.namespaces.every(row => isRecord(row) && typeof row.ns === 'string' && typeof row.revision === 'number' && isRecord(row.value))
}

/** Adapt the public Connection RPC carrier to the existing settings controller. */
export function createSettingsApi(rpc: ConnectionRpcLike, notify: () => void): SettingsApi {
  return {
    async describe() {
      const reply = await rpc.call('/api', 'promptTranslation/describe', { args: {} })
      if (!isDescribeReply(reply)) throw new Error('翻译配置接口返回无效响应')
      return reply
    },
    async mutate(ns: string, ops: SettingsPathOp[], revision: number) {
      const reply = await rpc.call('/api', 'promptTranslation/mutate', { args: { ns, ops, revision } })
      if (!isReply(reply)) throw new Error('翻译配置接口返回无效响应')
      if (reply.ok) notify()
      return reply
    },
  }
}
