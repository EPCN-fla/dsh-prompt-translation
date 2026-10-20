import { installPresentation, type EventRegistry } from './presentation.js'
import { css } from './styles.js'
import { SettingsCard, QuickPicker, type Props } from './components.js'
import type { SettingsApi, Catalog } from './settings.js'
export const name = 'dsh-prompt-translation'
export const inject = ['slots', 'remote', 'remote.settings']
interface ClientContext {
  effect(factory: () => (() => void) | void): void
  inject?(services: string[], callback: (ctx: { uiConversation: { events: EventRegistry }; effect(factory: () => () => void): void }) => void): unknown
  on(event: string, callback: (...args: unknown[]) => void): () => void
  remote: { settings: SettingsApi; session?: Catalog; $on(event: string, callback: (...args: unknown[]) => void): () => void }
  slots: {
    inject(name: string, callback: () => (() => void)): () => void
    register(options: { name: string; id: string; key?: string; order?: number; inject: () => Props }, component: typeof SettingsCard): () => void
  }
}

/** Register plugin-list settings and a composer control; dispose with the fiber. */
export function apply(ctx: ClientContext): void {
  ctx.inject?.(['uiConversation'], child => { child.effect(() => installPresentation(child.uiConversation.events)) })
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const props = { api: ctx.remote.settings, catalog: ctx.remote.session, subscribe }
  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', id: name, key: name, inject: () => props }, SettingsCard)))
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: name, order: -1000, inject: () => props }, QuickPicker)))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPromptTranslation = ''
    style.textContent = css
    document.head.append(style)
    const refresh = () => { for (const listener of listeners) listener() }
    const dispose = ctx.remote.$on('settings/document-updated', ns => { if (ns === 'prompt-translation') refresh() })
    const reconnect = ctx.on('connection/reset', refresh)
    return () => { dispose(); reconnect(); style.remove(); listeners.clear() }
  })
}
