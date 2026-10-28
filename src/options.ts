
export const languages = {
  auto: '自动检测', zh: '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語',
  ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский',
  pt: 'Português', it: 'Italiano', ar: 'العربية', hi: 'हिन्दी',
} as const
export type Language = keyof typeof languages
export interface Options {
  enabled: boolean
  source: Language
  target: Exclude<Language, 'auto'>
  type: 'traditional' | 'agent'
  userPrompt: boolean
  reasoning: boolean
  output: boolean
  engine: 'google' | 'baidu' | 'deepl' | 'microsoft'
  apiKey: string
  appId: string
  region: string
  deeplFree: boolean
  provider: string
  model: string
  reasoningEffort: string
  timeoutMs: number
  maxChars: number
}
/** Quick composer choices that one Session can override independently. */
export type QuickOptions = Pick<Options, 'enabled' | 'source' | 'target'>
/** Complete quick-choice snapshots by DSH Session id. */
export type SessionOverrides = Record<string, QuickOptions>
export const defaults: Options = {
  enabled: false, source: 'auto', target: 'en', type: 'traditional',
  userPrompt: true, reasoning: false, output: false, engine: 'google',
  apiKey: '', appId: '', region: '', deeplFree: true,
  provider: '', model: '', reasoningEffort: '', timeoutMs: 60000, maxChars: 2000,
}
/** Project a full configuration onto the three Session-overridable fields. */
export function quickOptions(options: Options): QuickOptions {
  return { enabled: options.enabled, source: options.source, target: options.target }
}

/** One path-addressed write accepted by the independent settings API. */
export interface SettingsPathOp { op: 'set'; path: string[]; value: unknown }
