import { defaults, quickOptions, type Options, type QuickOptions, type SessionOverrides, type SettingsPathOp } from '../options.js'
export const namespace = 'prompt-translation'
export type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export type DescribeReply = Reply<{ namespaces: Namespace[]; writable: boolean }>
export interface Namespace {
  ns: string
  value: Partial<Options> & { sessionOverrides?: SessionOverrides }
  revision: number
}
export interface SettingsApi {
  describe(): Promise<DescribeReply>
  mutate(ns: string, ops: SettingsPathOp[], revision: number): Promise<Reply<unknown>>
}
export interface CatalogModel { id: string; name: string; reasoning?: { efforts: { id: string; name: string }[] } }
export interface Catalog {
  modelCatalog(): Promise<Reply<{ groups: { id: string; name: string; models: CatalogModel[] }[] }>>
}
interface Snapshot { value: Options; overrides: SessionOverrides; writable: boolean; revision: number }
async function readSnapshot(api: SettingsApi): Promise<Snapshot> {
  const response = await api.describe()
  if (!response.ok) throw new Error(response.error.message)
  const row = response.value.namespaces.find(row => row.ns === namespace)
  if (!row) throw new Error('翻译插件配置尚未就绪')
  const { sessionOverrides, ...global } = row.value
  return {
    value: { ...defaults, ...global },
    overrides: sessionOverrides ?? {},
    writable: response.value.writable,
    revision: row.revision,
  }
}
export async function loadSettings(api: SettingsApi): Promise<{ value: Options; writable: boolean }> {
  const snapshot = await readSnapshot(api)
  return { value: snapshot.value, writable: snapshot.writable }
}
/** Read global defaults with only this Session's complete quick snapshot. */
export async function loadSessionSettings(api: SettingsApi, sessionId: string): Promise<{ value: Options; writable: boolean }> {
  const snapshot = await readSnapshot(api)
  return { value: { ...snapshot.value, ...snapshot.overrides[sessionId] }, writable: snapshot.writable }
}
/** Patch only edited global fields, retrying once against a fresh revision. */
export async function saveSettings(api: SettingsApi, patch: Partial<Options>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = await readSnapshot(api)
    if (!snapshot.writable) throw new Error('当前配置只读')
    const result = await api.mutate(namespace, Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value })), snapshot.revision)
    if (result.ok) return
    if (attempt === 0 && result.error.code === 'settings/conflict') continue
    throw new Error(result.error.message)
  }
}
/** Save one complete Session quick snapshot without restating other sessions or secrets. */
export async function saveSessionSettings(api: SettingsApi, sessionId: string, patch: Partial<QuickOptions>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = await readSnapshot(api)
    if (!snapshot.writable) throw new Error('当前配置只读')
    const value = quickOptions({ ...snapshot.value, ...snapshot.overrides[sessionId], ...patch })
    const result = await api.mutate(namespace, [{ op: 'set', path: ['sessionOverrides', sessionId], value }], snapshot.revision)
    if (result.ok) return
    if (attempt === 0 && result.error.code === 'settings/conflict') continue
    throw new Error(result.error.message)
  }
}
