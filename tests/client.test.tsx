// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { QuickPicker, SettingsCard, type Props } from '../src/client/components.js'
import { saveSessionSettings, saveSettings, type SettingsApi } from '../src/client/settings.js'
import { defaults, type Options, type SessionOverrides } from '../src/options.js'
import { apply } from '../src/client/index.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const cleanup: (() => void)[] = []
afterEach(async () => { await act(async () => { for (const dispose of cleanup.splice(0)) dispose() }); document.body.innerHTML = '' })
function fixture() {
  const current: Partial<Options> & { sessionOverrides?: SessionOverrides } = { ...defaults }
  const api: SettingsApi = {
    describe: vi.fn<SettingsApi['describe']>(async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: 'prompt-translation', value: current, revision: 1 }] } })),
    mutate: vi.fn<SettingsApi['mutate']>(async (_ns, ops) => {
      for (const op of ops) {
        if (op.path[0] === 'sessionOverrides') {
          const id = op.path[1]!
          current.sessionOverrides = { ...current.sessionOverrides, [id]: op.value as SessionOverrides[string] }
        } else Object.assign(current, { [op.path[0]!]: op.value })
      }
      return { ok: true, value: null }
    }),
  }
  const listeners = new Set<() => void>()
  const props: Props = { api, subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } } }
  const quickProps = { ...props, sessionId: 'session-a' }
  return { props, quickProps, current, api, listeners }
}
it('mounts directly after the permission slot, saves a language and cleans its portal on unload', async () => {
  document.body.innerHTML = '<div id="row"><div id="modes"><div data-slot="conversation.input.permission"><button>权限</button></div><div data-slot="conversation.input.plan"><button>计划</button></div></div><div data-slot="conversation.input.left"></div></div>'
  const fixtureState = fixture()
  const root = createRoot(document.querySelector('[data-slot="conversation.input.left"]')!)
  cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(QuickPicker, fixtureState.quickProps)))
  const permission = document.querySelector('[data-slot="conversation.input.permission"]')!
  expect(permission.nextElementSibling?.querySelector('[aria-label="翻译"]')).not.toBeNull()
  await act(async () => (document.querySelector('[aria-label="翻译"]') as HTMLButtonElement).click())
  const source = document.querySelector('[aria-label="原始语言"]') as HTMLSelectElement
  expect(source.value).toBe('auto')
  expect(document.querySelector('[aria-label="目标语言"] option[value="auto"]')).toBeNull()
  await act(async () => { source.value = 'ja'; source.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(fixtureState.api.mutate).toHaveBeenCalledWith('prompt-translation', [{ op: 'set', path: ['sessionOverrides', 'session-a'], value: { enabled: false, source: 'ja', target: 'en' } }], 1)
  const parent = permission.parentElement!
  await act(async () => { permission.remove(); await Promise.resolve() })
  expect(document.querySelector('.dsh-pt-seat')).toBeNull()
  expect(document.querySelector('[data-dsh-prompt-translation-anchor] [aria-label="翻译"]')).not.toBeNull()
  await act(async () => { parent.prepend(permission); await Promise.resolve() })
  expect(permission.nextElementSibling?.querySelector('[aria-label="翻译"]')).not.toBeNull()
  await act(async () => root.unmount())
  cleanup.pop()
  expect(document.querySelector('.dsh-pt-seat')).toBeNull()
  expect(fixtureState.listeners.size).toBe(0)
})
it('collapses plugin settings by default and toggles through an accessible header button', async () => {
  const f = fixture()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, f.props)))
  const header = host.querySelector('button.dsh-pt-card-header') as HTMLButtonElement
  const form = host.querySelector('form')!
  const chevron = header.querySelector('.dsh-pt-card-chevron')!
  expect(header.getAttribute('aria-expanded')).toBe('false')
  expect(header.getAttribute('aria-controls')).toBe(form.id)
  expect(header.getAttribute('aria-describedby')).toBe(host.querySelector('.dsh-pt-card-description')?.id)
  expect(chevron).not.toBeNull()
  expect(chevron.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 14 14')
  expect(chevron.classList.contains('dsh-pt-card-chevron-open')).toBe(false)
  expect(form.hidden).toBe(true)
  await act(async () => header.click())
  expect(header.getAttribute('aria-expanded')).toBe('true')
  expect(chevron.classList.contains('dsh-pt-card-chevron-open')).toBe(true)
  expect(form.hidden).toBe(false)
  await act(async () => header.click())
  expect(header.getAttribute('aria-expanded')).toBe('false')
  expect(chevron.classList.contains('dsh-pt-card-chevron-open')).toBe(false)
  expect(form.hidden).toBe(true)
})
it('retains edited configuration and displays failure when saving is rejected', async () => {
  const f = fixture()
  f.api.mutate = vi.fn<SettingsApi['mutate']>(async () => ({ ok: false, error: { code: 'denied', message: '保存被拒绝' } }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, f.props)))
  await act(async () => (host.querySelector('.dsh-pt-card-header') as HTMLButtonElement).click())
  const select = host.querySelector('select[aria-label="原始语言"]') as HTMLSelectElement
  await act(async () => { select.value = 'fr'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('保存被拒绝')
  expect(select.value).toBe('fr')
  expect((host.querySelector('form') as HTMLFormElement).hidden).toBe(false)
  expect(host.querySelector('.dsh-pt-card-header')?.getAttribute('aria-expanded')).toBe('true')
  await act(async () => (host.querySelector('.dsh-pt-card-footer button[type=button]') as HTMLButtonElement).click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
it('collapses settings after a successful save', async () => {
  const f = fixture()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, f.props)))
  const header = host.querySelector('.dsh-pt-card-header') as HTMLButtonElement
  await act(async () => header.click())
  const select = host.querySelector('select[aria-label="原始语言"]') as HTMLSelectElement
  await act(async () => { select.value = 'fr'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
  expect(f.current.source).toBe('fr')
  expect((host.querySelector('form') as HTMLFormElement).hidden).toBe(true)
  expect(header.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('.dsh-pt-tag')).toBeNull()
})
it('retries a stale revision without overwriting unrelated settings or secrets', async () => {
  const f = fixture()
  f.api.mutate = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'settings/conflict', message: 'conflict' } }).mockResolvedValueOnce({ ok: true, value: null })
  await saveSettings(f.api, { target: 'de' })
  expect(f.api.mutate).toHaveBeenCalledTimes(2)
  expect(f.api.mutate).toHaveBeenLastCalledWith('prompt-translation', [{ op: 'set', path: ['target'], value: 'de' }], 1)
})
it('registers both host slots and revokes styles and subscriptions on unload', () => {
  const f = fixture()
  const disposers: (() => void)[] = []
  const removeSlot = vi.fn()
  const offReconnect = vi.fn()
  const register = vi.fn(() => removeSlot)
  apply({
    effect: fn => { const dispose = fn(); if (dispose) disposers.push(dispose) },
    on: () => offReconnect,
    remote: {},
    connection: { rpc: { call: vi.fn() } },
    slots: { inject: (_name, fn) => fn(), register },
  })
  expect(register.mock.calls.map(call => (call as unknown as [{ name: string }])[0].name)).toEqual(['plugins.bundle.config', 'conversation.input.left'])
  expect(document.querySelector('style[data-dsh-prompt-translation]')).not.toBeNull()
  for (const dispose of disposers.reverse()) dispose()
  expect(removeSlot).toHaveBeenCalledTimes(2)
  expect(offReconnect).toHaveBeenCalledOnce()
  expect(document.querySelector('style[data-dsh-prompt-translation]')).toBeNull()
})

it('refuses to reuse a redacted credential when switching translation providers', async () => {
  const f = fixture()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, f.props)))
  await act(async () => (host.querySelector('.dsh-pt-card-header') as HTMLButtonElement).click())
  const select = [...host.querySelectorAll('select')].find(el => el.value === 'google')!
  await act(async () => { select.value = 'deepl'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
  expect(f.api.mutate).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('新服务的 API 密钥')
})
it('ignores stale settings reads that finish after a newer invalidation', async () => {
  const f = fixture()
  let stale: ((value: Awaited<ReturnType<SettingsApi['describe']>>) => void) | undefined
  f.api.describe = vi.fn<SettingsApi['describe']>()
    .mockImplementationOnce(() => new Promise(resolve => { stale = resolve }))
    .mockResolvedValue({ ok: true, value: { writable: true, namespaces: [{ ns: 'prompt-translation', revision: 2, value: { ...defaults, source: 'ja' } }] } })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, f.props)))
  await act(async () => { for (const listener of f.listeners) listener() })
  await act(async () => stale!({ ok: true, value: { writable: true, namespaces: [{ ns: 'prompt-translation', revision: 1, value: defaults }] } }))
  expect((host.querySelector('[aria-label="原始语言"]') as HTMLSelectElement).value).toBe('ja')
})

it('uses an icon-only toggle state and a single compact language row', async () => {
  const f = fixture()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(QuickPicker, f.quickProps)))
  const button = host.querySelector('button[aria-label="翻译"]') as HTMLButtonElement
  expect(button.textContent).toBe('')
  expect(button.querySelector('[data-translation-disabled]')).not.toBeNull()
  await act(async () => button.click())
  const dialog = document.body.querySelector('.dsh-pt-popover')!
  expect(dialog).not.toBeNull()
  expect(host.contains(dialog)).toBe(false)
  const row = dialog.querySelector('.dsh-pt-language-row')!
  expect(row.querySelectorAll('select')).toHaveLength(2)
  expect([...row.querySelectorAll('label')].every(label => label.childNodes.length === 1)).toBe(true)
  expect(dialog.querySelector('.dsh-pt-scope')).toBeNull()
  await act(async () => (dialog.querySelector('input[type=checkbox]') as HTMLInputElement).click())
  expect(button.querySelector('[data-translation-disabled]')).toBeNull()
  expect(f.current.enabled).toBe(false)
  expect(f.current.sessionOverrides?.['session-a']?.enabled).toBe(true)
})

it('retries a Session quick-settings conflict without changing global defaults', async () => {
  const f = fixture()
  f.api.mutate = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'settings/conflict', message: 'conflict' } }).mockResolvedValueOnce({ ok: true, value: null })
  await saveSessionSettings(f.api, 'session-a', { target: 'de' })
  expect(f.api.mutate).toHaveBeenCalledTimes(2)
  expect(f.api.mutate).toHaveBeenLastCalledWith('prompt-translation', [{ op: 'set', path: ['sessionOverrides', 'session-a'], value: { enabled: false, source: 'auto', target: 'de' } }], 1)
  expect(f.current.target).toBe('en')
})

it('keeps quick choices independent between two conversations', async () => {
  const f = fixture()
  const aHost = document.createElement('div')
  const bHost = document.createElement('div')
  document.body.append(aHost, bHost)
  const aRoot = createRoot(aHost)
  const bRoot = createRoot(bHost)
  cleanup.push(() => aRoot.unmount(), () => bRoot.unmount())
  await act(async () => aRoot.render(createElement(QuickPicker, f.quickProps)))
  await act(async () => bRoot.render(createElement(QuickPicker, { ...f.props, sessionId: 'session-b' })))
  const aButton = aHost.querySelector('button[aria-label="翻译"]') as HTMLButtonElement
  const bButton = bHost.querySelector('button[aria-label="翻译"]') as HTMLButtonElement
  await act(async () => aButton.click())
  await act(async () => (document.body.querySelector('.dsh-pt-popover input[type=checkbox]') as HTMLInputElement).click())
  await act(async () => { for (const listener of f.listeners) listener() })
  expect(f.current.enabled).toBe(false)
  expect(f.current.sessionOverrides?.['session-a']?.enabled).toBe(true)
  expect(f.current.sessionOverrides?.['session-b']).toBeUndefined()
  expect(aButton.querySelector('[data-translation-disabled]')).toBeNull()
  expect(bButton.querySelector('[data-translation-disabled]')).not.toBeNull()
  expect(aHost.querySelector('.dsh-pt-scope')).toBeNull()
})


it('does not expose the previous conversation controls while the next one is loading', async () => {
  const f = fixture()
  f.current.sessionOverrides = {
    'session-a': { enabled: true, source: 'ja', target: 'de' },
    'session-b': { enabled: false, source: 'fr', target: 'en' },
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(QuickPicker, f.quickProps)))
  const button = host.querySelector('button[aria-label="翻译"]') as HTMLButtonElement
  expect(button.getAttribute('data-enabled')).toBe('true')
  let loadB: ((value: Awaited<ReturnType<SettingsApi['describe']>>) => void) | undefined
  f.api.describe = vi.fn<SettingsApi['describe']>(() => new Promise(resolve => { loadB = resolve }))
  await act(async () => root.render(createElement(QuickPicker, { ...f.props, sessionId: 'session-b' })))
  expect(button.getAttribute('data-enabled')).toBe('false')
  await act(async () => button.click())
  const dialog = document.body.querySelector('.dsh-pt-popover')!
  const checkbox = dialog.querySelector('input[type=checkbox]') as HTMLInputElement
  expect(checkbox.disabled).toBe(true)
  expect(checkbox.checked).toBe(false)
  expect((dialog.querySelector('[aria-label="原始语言"]') as HTMLSelectElement).value).toBe('auto')
  await act(async () => loadB!({ ok: true, value: { writable: true, namespaces: [{ ns: 'prompt-translation', revision: 2, value: f.current }] } }))
  expect(checkbox.disabled).toBe(false)
  expect(checkbox.checked).toBe(false)
  expect((dialog.querySelector('[aria-label="原始语言"]') as HTMLSelectElement).value).toBe('fr')
})

it('discards staged settings in the expanded themed card', async () => {
  const f = fixture()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, f.props)))
  await act(async () => (host.querySelector('.dsh-pt-card-header') as HTMLButtonElement).click())
  const select = host.querySelector('[aria-label="原始语言"]') as HTMLSelectElement
  await act(async () => { select.value = 'fr'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.querySelector('.dsh-pt-tag')?.textContent).toBe('未保存')
  await act(async () => (host.querySelector('.dsh-pt-card-footer button[type=button]') as HTMLButtonElement).click())
  expect(select.value).toBe('auto')
  expect(host.querySelector('.dsh-pt-tag')).toBeNull()
  expect((host.querySelector('.dsh-pt-card-body') as HTMLElement).hidden).toBe(false)
})

it('fetches modelCatalog once, validates number bounds, clears errors on discard and avoids double refresh', async () => {
  const f = fixture()
  const modelCatalog = vi.fn(async () => ({
    ok: true as const,
    value: { groups: [{ id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }] },
  }))
  const baseMutate = f.api.mutate
  f.api.mutate = vi.fn<SettingsApi['mutate']>(async (ns, ops, rev) => {
    const res = await baseMutate(ns, ops, rev)
    for (const listener of f.listeners) listener()
    return res
  })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(SettingsCard, { ...f.props, catalog: { modelCatalog } })))
  expect(modelCatalog).toHaveBeenCalledTimes(1)
  await act(async () => (host.querySelector('.dsh-pt-card-header') as HTMLButtonElement).click())
  const typeSelect = [...host.querySelectorAll('select')].find(el => el.value === 'traditional')!
  await act(async () => { typeSelect.value = 'agent'; typeSelect.dispatchEvent(new Event('change', { bubbles: true })) })
  const providerInput = host.querySelector('input[list]') as HTMLInputElement
  await act(async () => { providerInput.value = 'p'; providerInput.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { providerInput.value = 'p1'; providerInput.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(modelCatalog).toHaveBeenCalledTimes(1)
  const setInputValue = (input: HTMLInputElement, next: string) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const numberInput = host.querySelector('input[type=number]') as HTMLInputElement
  await act(async () => setInputValue(numberInput, ''))
  await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('1000–300000')
  expect(f.api.mutate).not.toHaveBeenCalled()
  await act(async () => (host.querySelector('.dsh-pt-card-footer button[type=button]') as HTMLButtonElement).click())
  expect(host.querySelector('[role="alert"]')).toBeNull()
  const describeCallsBeforeSave = (f.api.describe as ReturnType<typeof vi.fn>).mock.calls.length
  const sourceSelect = host.querySelector('select[aria-label="原始语言"]') as HTMLSelectElement
  await act(async () => { sourceSelect.value = 'ja'; sourceSelect.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => (host.querySelector('button[type=submit]') as HTMLButtonElement).click())
  expect((f.api.describe as ReturnType<typeof vi.fn>).mock.calls.length - describeCallsBeforeSave).toBe(2)
})

it('closes QuickPicker on sessionId change and Escape while isolating listener errors and stabilizing slot props', async () => {
  const f = fixture()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(QuickPicker, f.quickProps)))
  const trigger = host.querySelector('button[aria-label="翻译"]') as HTMLButtonElement
  await act(async () => trigger.click())
  expect(document.body.querySelector('.dsh-pt-popover')).not.toBeNull()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(document.body.querySelector('.dsh-pt-popover')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await act(async () => trigger.click())
  expect(document.body.querySelector('.dsh-pt-popover')).not.toBeNull()
  await act(async () => root.render(createElement(QuickPicker, { ...f.props, sessionId: 'session-b' })))
  expect(document.body.querySelector('.dsh-pt-popover')).toBeNull()

  const registered: Array<{ name: string; inject: (sessionId: string) => Props }> = []
  let reconnect: (() => void) | undefined
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const disposers: (() => void)[] = []
  try {
    apply({
      effect: fn => { const d = fn(); if (d) disposers.push(d) },
      on: (_event, cb) => { reconnect = cb; return () => {} },
      remote: {},
      connection: { rpc: { call: vi.fn() } },
      slots: {
        inject: (_name, fn) => fn(),
        register: (opts) => { registered.push(opts); return () => {} },
      },
    })
    const quick = registered.find(r => r.name === 'conversation.input.left')!
    const p1 = quick.inject('s1')
    const p1Again = quick.inject('s1')
    expect(p1).toBe(p1Again)
    const good = vi.fn()
    p1.subscribe(() => { throw new Error('boom') })
    p1.subscribe(good)
    reconnect!()
    expect(good).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()
  } finally {
    warn.mockRestore()
    for (const d of disposers.reverse()) d()
  }
})

it('ignores a rejected save error if the conversation switched before completion', async () => {
  const f = fixture()
  let rejectWrite!: (err: Error) => void
  f.api.mutate = vi.fn<SettingsApi['mutate']>(() => new Promise((_resolve, reject) => { rejectWrite = reject }))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); cleanup.push(() => root.unmount())
  await act(async () => root.render(createElement(QuickPicker, f.quickProps)))
  await act(async () => (host.querySelector('button[aria-label="翻译"]') as HTMLButtonElement).click())
  await act(async () => {
    (document.body.querySelector('.dsh-pt-popover input[type=checkbox]') as HTMLInputElement).click()
  })
  await act(async () => root.render(createElement(QuickPicker, { ...f.props, sessionId: 'session-b' })))
  await act(async () => { rejectWrite(new Error('stale write failed')); await Promise.resolve() })
  await act(async () => (host.querySelector('button[aria-label="翻译"]') as HTMLButtonElement).click())
  expect(document.body.querySelector('.dsh-pt-popover [role="alert"]')).toBeNull()
})
