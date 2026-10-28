import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { expect, it } from 'vitest'
import { TranslationStore } from '../src/store.js'
import { defaults } from '../src/options.js'
import { createStorage } from './storage.js'

it('persists global and Session settings in one private YAML while redacting credentials', () => {
  const storage = createStorage({ ...defaults, apiKey: 'initial-secret' })
  const { store } = storage
  try {
    store.mutate([{ op: 'set', path: ['source'], value: 'ja' }], store.revision)
    store.mutate([{ op: 'set', path: ['sessionOverrides', 'session-a'], value: { enabled: true, source: 'zh', target: 'en' } }], store.revision)
    const document = parse(readFileSync(storage.path, 'utf8'))
    expect(document.source).toBe('ja')
    expect(document.apiKey).toBe('initial-secret')
    expect(document.sessionOverrides['session-a']).toEqual({ enabled: true, source: 'zh', target: 'en' })
    expect(statSync(storage.path).mode & 0o777).toBe(0o600)
    const described = store.describe().namespaces[0]!
    expect(described.value.apiKey).toBe('')
    expect(JSON.stringify(described)).not.toContain('initial-secret')
    expect(described.revision).toBe(2)
    const reloaded = new TranslationStore(storage.path)
    expect(reloaded.read('session-a')).toMatchObject({ enabled: true, source: 'zh', target: 'en', apiKey: 'initial-secret' })
    expect(reloaded.read('session-b')).toMatchObject({ enabled: false, source: 'ja', target: 'en' })
  } finally { storage.cleanup() }
})

it('rejects stale revisions and invalid paths without changing the file', () => {
  const storage = createStorage()
  const { store } = storage
  try {
    store.mutate([{ op: 'set', path: ['target'], value: 'de' }], store.revision)
    const before = readFileSync(storage.path, 'utf8')
    expect(() => store.mutate([{ op: 'set', path: ['target'], value: 'fr' }], 0)).toThrowError(expect.objectContaining({ code: 'settings/conflict' }))
    expect(() => store.mutate([{ op: 'set', path: ['sessionOverrides', 'bad', 'enabled'], value: true }], store.revision)).toThrowError(expect.objectContaining({ code: 'settings/rejected' }))
    expect(readFileSync(storage.path, 'utf8')).toBe(before)
    expect(store.revision).toBe(1)
  } finally { storage.cleanup() }
})

it('fails loudly on malformed stored configuration and never creates a file on read', () => {
  const root = mkdtempSync(join(tmpdir(), 'translation-store-invalid-'))
  const path = join(root, 'prompt-translation.yml')
  try {
    expect(() => new TranslationStore(path)).not.toThrow()
    expect(statSync(root).isDirectory()).toBe(true)
    expect(() => statSync(path)).toThrow()
    writeFileSync(path, 'enabled: true\nsessionOverrides:\n  broken:\n    enabled: true\n')
    expect(() => new TranslationStore(path)).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
