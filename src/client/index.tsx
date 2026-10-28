import { installPresentation, type EventRegistry } from './presentation.js'
import { css } from './styles.js'
import { SettingsCard, QuickPicker, type Props } from './components.js'
import type { Catalog } from './settings.js'
import { createSettingsApi, type ConnectionRpcLike } from './api.js'
export const name = 'dsh-prompt-translation'
export const inject = ['slots', 'remote', 'connection']
interface ClientContext {
  effect(factory: () => (() => void) | void): void
  inject?(services: string[], callback: (ctx: { uiConversation: { events: EventRegistry }; effect(factory: () => () => void): void }) => void): unknown
  on(event: string, callback: (...args: unknown[]) => void): () => void
  remote: { session?: Catalog }
  connection: { rpc: ConnectionRpcLike }
  slots: {
    inject(name: string, callback: () => (() => void)): () => void
    register(options: { name: string; id: string; key?: string; order?: number; inject: (sessionId: string) => Props }, component: typeof SettingsCard | typeof QuickPicker): () => void
  }
}

/** Register plugin-list settings and a composer control; dispose with the fiber. */
export function apply(ctx: ClientContext): void {
  ctx.inject?.(['uiConversation'], child => { child.effect(() => installPresentation(child.uiConversation.events)) })
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const refresh = () => { for (const listener of listeners) listener() }
  const props = { api: createSettingsApi(ctx.connection.rpc, refresh), catalog: ctx.remote.session, subscribe }
  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', id: name, key: name, inject: () => props }, SettingsCard)))
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: name, order: -1000, inject: (sessionId: string) => ({ ...props, sessionId }) }, QuickPicker)))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPromptTranslation = ''
    style.textContent = css
    document.head.append(style)
    const reconnect = ctx.on('connection/reset', refresh)
    return () => { reconnect(); style.remove(); listeners.clear() }
  })
}
