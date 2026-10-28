import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { StoredConfig, readConfig, readSessionOverrides, type LiveConfig } from './config.js'
import { defaults, type Options, type SessionOverrides, type SettingsPathOp } from './options.js'

export const namespace = 'prompt-translation'
export interface NamespaceDocument {
  ns: string
  value: Partial<Options> & { sessionOverrides?: SessionOverrides }
  revision: number
}
export interface DescribeValue { namespaces: NamespaceDocument[]; writable: boolean }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'settings/rejected': { readonly ns: string }
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
  }
}

/** Resolve the independent user file; tests and launchers isolate it with DSH_HOME. */
export function defaultStorePath(): string {
  return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'prompt-translation.yml')
}

/** Lifecycle-owned YAML configuration with complete Session quick snapshots. */
export class TranslationStore {
  private options: Options
  private overrides: SessionOverrides = {}
  private currentRevision = 0

  constructor(readonly path: string, fallback: Partial<LiveConfig> = {}) {
    this.options = readConfig(fallback)
    if (!existsSync(path)) return
    const stored = StoredConfig(parse(readFileSync(path, 'utf8')) as never)
    this.options = readConfig(stored)
    this.overrides = { ...readSessionOverrides(stored) }
  }

  get revision(): number { return this.currentRevision }

  /** Read the global defaults or one Session's effective options. */
  read(sessionId?: string): Options {
    return sessionId === undefined ? { ...this.options } : { ...this.options, ...this.overrides[sessionId] }
  }

  /** Return a redacted Settings-like view for the browser. */
  describe(): DescribeValue {
    return {
      writable: true,
      namespaces: [{
        ns: namespace,
        value: { ...this.options, apiKey: '', sessionOverrides: { ...this.overrides } },
        revision: this.currentRevision,
      }],
    }
  }

  /** Validate and atomically persist path edits without restating secrets. */
  mutate(ops: readonly SettingsPathOp[], expectedRevision: number): void {
    if (expectedRevision !== this.currentRevision) {
      throw new RemoteError('settings/conflict', '翻译配置已被其他修改更新，请重试', {
        ns: namespace, expected: expectedRevision, actual: this.currentRevision,
      })
    }
    if (ops.length === 0) return
    let options = { ...this.options }
    let overrides = { ...this.overrides }
    for (const op of ops) {
      if (op.path[0] === 'sessionOverrides' && op.path.length === 2 && op.path[1]) {
        overrides = { ...overrides, [op.path[1]]: op.value as SessionOverrides[string] }
      } else if (op.path.length === 1 && Object.hasOwn(defaults, op.path[0])) {
        options = { ...options, [op.path[0]]: op.value }
      } else {
        throw new RemoteError('settings/rejected', `不支持的翻译配置路径：${op.path.join('.')}`, { ns: namespace })
      }
    }
    const stored = StoredConfig({ ...options, sessionOverrides: overrides } as never)
    const nextOptions = readConfig(stored)
    const nextOverrides = { ...readSessionOverrides(stored) }
    this.persist(nextOptions, nextOverrides)
    this.options = nextOptions
    this.overrides = nextOverrides
    this.currentRevision += 1
  }

  private persist(options: Options, overrides: SessionOverrides): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, stringify({ ...options, sessionOverrides: overrides }), { mode: 0o600 })
      renameSync(temporary, this.path)
      chmodSync(this.path, 0o600)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}
