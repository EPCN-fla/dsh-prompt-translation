import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranslationStore } from '../src/store.js'
import type { Context } from '@deepseek-ai/cordis'
import type { LiveConfig } from '../src/config.js'
import type { QuickOptions } from '../src/options.js'

export function createStorage(config: Partial<LiveConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'translation-store-'))
  const path = join(root, 'prompt-translation.yml')
  const store = new TranslationStore(path, config)
  return {
    store,
    path,
    setSession(sessionId: string, value: QuickOptions) {
      store.mutate([{ op: 'set', path: ['sessionOverrides', sessionId], value }], store.revision)
    },
    cleanup() { rmSync(root, { recursive: true, force: true }) },
  }
}

export function stubTypert(ctx: Context): void {
  ctx.reflect.provide('typert', { register: () => () => {} })
}
