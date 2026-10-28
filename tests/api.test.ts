import { expect, it, vi } from 'vitest'
import { createSettingsApi, type ConnectionRpcLike } from '../src/client/api.js'
import { defaults } from '../src/options.js'

it('uses the independent Remote namespace and notifies only successful writes', async () => {
  const notify = vi.fn()
  const calls: { endpoint: string; payload: unknown }[] = []
  const rpc: ConnectionRpcLike = {
    async call(_channel, endpoint, payload) {
      calls.push({ endpoint, payload })
      if (endpoint.endsWith('/describe')) return { ok: true, value: { writable: true, namespaces: [{ ns: 'prompt-translation', value: defaults, revision: 3 }] } }
      return { ok: true, value: null }
    },
  }
  const api = createSettingsApi(rpc, notify)
  await expect(api.describe()).resolves.toMatchObject({ ok: true, value: { writable: true } })
  await expect(api.mutate('prompt-translation', [{ op: 'set', path: ['target'], value: 'de' }], 3)).resolves.toMatchObject({ ok: true })
  expect(calls).toEqual([
    { endpoint: 'promptTranslation/describe', payload: { args: {} } },
    { endpoint: 'promptTranslation/mutate', payload: { args: { ns: 'prompt-translation', ops: [{ op: 'set', path: ['target'], value: 'de' }], revision: 3 } } },
  ])
  expect(notify).toHaveBeenCalledOnce()
})

it('rejects malformed responses and does not notify failed writes', async () => {
  const notify = vi.fn()
  const api = createSettingsApi({ call: async () => ({ ok: true, value: {} }) }, notify)
  await expect(api.describe()).rejects.toThrow('无效响应')
  const failed = createSettingsApi({ call: async () => ({ ok: false, error: { code: 'settings/conflict', message: 'conflict' } }) }, notify)
  await expect(failed.mutate('prompt-translation', [], 1)).resolves.toMatchObject({ ok: false })
  expect(notify).not.toHaveBeenCalled()
})
