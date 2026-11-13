import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function rejectReservedOverrideKeys(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const overrides = (raw as { sessionOverrides?: unknown }).sessionOverrides
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return
  for (const key of Object.getOwnPropertyNames(overrides)) {
    if (RESERVED_KEYS.has(key)) throw new Error(`不支持的会话配置键：${key}`)
  }
}

function cloneOverrides(overrides: SessionOverrides | undefined): SessionOverrides {
  const clean: SessionOverrides = {}
  if (!overrides) return clean
  for (const key of Object.keys(overrides)) {
    if (!RESERVED_KEYS.has(key) && Object.hasOwn(overrides, key)) clean[key] = overrides[key]!
  }
  return clean
}

/** Resolve the independent user file; tests and launchers isolate it with DSH_HOME. */
export function defaultStorePath(): string {
  const base = process.env.DSH_HOME?.trim()
  return resolve(base || join(homedir(), '.dsh'), 'prompt-translation.yml')
}

/** Lifecycle-owned YAML configuration with complete Session quick snapshots. */
export class TranslationStore {
  private options: Options
  private overrides: SessionOverrides = {}
  private currentRevision = 0

  constructor(readonly path: string, fallback: Partial<LiveConfig> = {}) {
    this.options = readConfig(fallback)
    if (!existsSync(path)) return
    const parsed = parse(readFileSync(path, 'utf8'))
    rejectReservedOverrideKeys(parsed)
    const stored = StoredConfig(parsed as never)
    this.options = readConfig(stored)
    this.overrides = cloneOverrides(readSessionOverrides(stored))
  }

  get revision(): number { return this.currentRevision }

  /** Read the global defaults or one Session's effective options. */
  read(sessionId?: string): Options {
    const override = sessionId !== undefined && Object.hasOwn(this.overrides, sessionId) ? this.overrides[sessionId] : undefined
    return override ? { ...this.options, ...override } : { ...this.options }
  }

  /** Return a redacted Settings-like view for the browser. */
  describe(): DescribeValue {
    return {
      writable: true,
      namespaces: [{
        ns: namespace,
        value: { ...this.options, apiKey: '', sessionOverrides: cloneOverrides(this.overrides) },
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
    let overrides = cloneOverrides(this.overrides)
    for (const op of ops) {
      if (!op || op.op !== 'set' || !Array.isArray(op.path)) {
        throw new RemoteError('settings/rejected', '不支持的翻译配置操作', { ns: namespace })
      }
      if (op.path[0] === 'sessionOverrides' && op.path.length === 2 && op.path[1] && !RESERVED_KEYS.has(op.path[1])) {
        overrides = { ...overrides, [op.path[1]]: op.value as SessionOverrides[string] }
      } else if (op.path.length === 1 && Object.hasOwn(defaults, op.path[0]!)) {
        options = { ...options, [op.path[0]!]: op.value }
      } else {
        throw new RemoteError('settings/rejected', `不支持的翻译配置路径：${op.path.join('.')}`, { ns: namespace })
      }
    }
    let stored
    try {
      stored = StoredConfig({ ...options, sessionOverrides: overrides })
    } catch (error) {
      throw new RemoteError('settings/rejected', error instanceof Error ? error.message : '翻译配置无效', { ns: namespace })
    }
    const nextOptions = readConfig(stored)
    const nextOverrides = cloneOverrides(readSessionOverrides(stored))
    this.persist(nextOptions, nextOverrides)
    this.options = nextOptions
    this.overrides = nextOverrides
    this.currentRevision += 1
  }

  private persist(options: Options, overrides: SessionOverrides): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, stringify({ ...options, sessionOverrides: overrides }), { flag: 'wx', mode: 0o600 })
      renameSync(temporary, this.path)
      chmodSync(this.path, 0o600)
    } finally {
      try { unlinkSync(temporary) } catch {}
    }
  }
}
