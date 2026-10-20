import { defaults, type Options } from '../options.js'
export const namespace = 'prompt-translation'
type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export interface Namespace { ns: string; value: Partial<Options>; revision: number }
export interface SettingsApi {
  describe(): Promise<Reply<{ namespaces: Namespace[]; writable: boolean }>>
  mutate(ns: string, ops: { op: 'set'; path: string[]; value: unknown }[], revision: number): Promise<Reply<unknown>>
}
export interface CatalogModel { id: string; name: string; reasoning?: { efforts: { id: string; name: string }[] } }
export interface Catalog {
  modelCatalog(): Promise<Reply<{ groups: { id: string; name: string; models: CatalogModel[] }[] }>>
}
export async function loadSettings(api: SettingsApi): Promise<{ value: Options; writable: boolean }> {
  const response = await api.describe()
  if (!response.ok) throw new Error(response.error.message)
  const row = response.value.namespaces.find(row => row.ns === namespace)
  if (!row) throw new Error('翻译插件配置尚未就绪')
  return { value: { ...defaults, ...row.value }, writable: response.value.writable }
}
/** Patch only edited fields, retrying once against a fresh revision. */
export async function saveSettings(api: SettingsApi, patch: Partial<Options>): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await api.describe()
    if (!response.ok) throw new Error(response.error.message)
    if (!response.value.writable) throw new Error('当前配置只读')
    const row = response.value.namespaces.find(row => row.ns === namespace)
    if (!row) throw new Error('翻译插件配置尚未就绪')
    const result = await api.mutate(namespace, Object.entries(patch).map(([key, value]) => ({ op: 'set', path: [key], value })), row.revision)
    if (result.ok) return
    if (attempt === 0 && result.error.code === 'settings/conflict') continue
    throw new Error(result.error.message)
  }
}
