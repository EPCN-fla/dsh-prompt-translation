import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { defaults } from '../src/options.js'
const state = { ...defaults }
const listeners = new Set<(ns: string) => void>()
const disposers: (() => void)[] = []
const roots: ReturnType<typeof createRoot>[] = []
const settings = {
  async describe() { return { ok: true, value: { writable: true, namespaces: [{ ns: 'prompt-translation', revision: 1, value: state }] } } },
  async mutate(_ns: string, ops: { path: string[]; value: unknown }[]) {
    for (const op of ops) Object.assign(state, { [op.path[0]!]: op.value })
    for (const listener of listeners) listener('prompt-translation')
    return { ok: true, value: null }
  },
}
Object.assign(window, {
  fixtureState: state,
  disposeFixture: () => { for (const root of roots) root.unmount(); for (const dispose of disposers.reverse()) dispose() },
  __ModuleLoader__: { load({ factory }: { factory: (require: (name: string) => unknown) => { apply: (ctx: unknown) => void } }) {
    const plugin = factory(name => {
      if (name === 'react') return React
      if (name === 'react-dom') return ReactDOM
      if (name === 'react/jsx-runtime') return jsxRuntime
      throw new Error(`Unexpected external: ${name}`)
    })
    plugin.apply({
      effect(fn: () => (() => void) | undefined) { const dispose = fn(); if (dispose) disposers.push(dispose) },
      on() { return () => {} },
      remote: { settings, session: { async modelCatalog() { return { ok: true, value: { groups: [{ id: 'existing-provider', name: 'Existing provider', models: [{ id: 'existing-model', name: 'Existing model', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }] }] } } } }, $on(_event: string, listener: (ns: string) => void) { listeners.add(listener); return () => listeners.delete(listener) } },
      slots: {
        inject(_name: string, fn: () => () => void) { return fn() },
        register(options: { name: string; inject: () => unknown }, Component: React.ComponentType<any>) {
          const mount = document.querySelector(`[data-slot="${options.name}"]`)!
          const root = createRoot(mount); roots.push(root)
          root.render(React.createElement(Component, options.inject()))
          return () => {}
        },
      },
    })
  } },
})
