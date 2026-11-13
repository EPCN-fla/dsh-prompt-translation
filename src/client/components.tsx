import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { languages, defaults, type Options, type Language } from '../options.js'
import { loadSessionSettings, loadSettings, saveSessionSettings, saveSettings, type Catalog, type CatalogGroup, type SettingsApi } from './settings.js'
export interface Props { api: SettingsApi; catalog?: Catalog; sessionId?: string; subscribe: (fn: () => void) => () => void }
function useSettings({ api, sessionId, subscribe }: Props) {
  const [value, setValue] = useState(defaults)
  const [stateSession, setStateSession] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [writable, setWritable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const alive = useRef(false)
  const sessionRef = useRef(sessionId)
  sessionRef.current = sessionId
  const savingRef = useRef(false)
  const inFlightRefresh = useRef<{ ticket: number; promise: Promise<void> } | null>(null)
  const refresh = (): Promise<void> => {
    const targetSession = sessionId
    const ticket = ++generation.current
    const promise = (async () => {
      try {
        const result = targetSession === undefined ? await loadSettings(api) : await loadSessionSettings(api, targetSession)
        if (alive.current && ticket === generation.current && sessionRef.current === targetSession) {
          setValue(result.value); setStateSession(targetSession); setWritable(result.writable); setReady(true); setError('')
        }
      } catch (err) {
        if (alive.current && ticket === generation.current && sessionRef.current === targetSession) {
          setReady(false); setStateSession(targetSession); setError(err instanceof Error ? err.message : String(err))
        }
        throw err
      } finally {
        if (inFlightRefresh.current?.ticket === ticket) inFlightRefresh.current = null
      }
    })()
    inFlightRefresh.current = { ticket, promise }
    return promise
  }
  useEffect(() => {
    alive.current = true
    const reload = () => { void refresh().catch(() => {}) }
    reload()
    const dispose = subscribe(reload)
    return () => { alive.current = false; generation.current++; dispose() }
  }, [api, sessionId, subscribe])
  const save = async (patch: Partial<Options>): Promise<boolean> => {
    if (savingRef.current) return false
    const targetSession = sessionId
    const ticketBefore = generation.current
    savingRef.current = true
    setBusy(true); setError('')
    try {
      if (targetSession === undefined) await saveSettings(api, patch)
      else await saveSessionSettings(api, targetSession, patch)
      if (!alive.current || sessionRef.current !== targetSession) return false
      const pending = inFlightRefresh.current
      if (generation.current !== ticketBefore && pending) {
        await pending.promise
      } else if (generation.current === ticketBefore) {
        await refresh()
      }
      return true
    } catch (err) {
      if (alive.current && sessionRef.current === targetSession) setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      savingRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  const current = stateSession === sessionId
  return {
    value: current && ready ? value : defaults,
    ready: current && ready,
    disabled: !current || !ready || !writable || busy,
    error: current ? error : '',
    clearError: () => setError(''),
    save,
  }
}
export function LanguageSelect({ source, value, onChange, disabled, compact }: { compact?: boolean; source?: boolean; value: string; onChange: (value: Language) => void; disabled?: boolean }) {
  return <label className={compact ? 'dsh-pt-language-compact' : undefined}>{!compact && (source ? '原始语言' : '目标语言')}<select aria-label={source ? '原始语言' : '目标语言'} disabled={disabled} value={value} onChange={event => onChange(event.target.value as Language)}>
    {Object.entries(languages).filter(([key]) => source || key !== 'auto').map(([key, label]) => <option key={key} value={key}>{label}</option>)}
  </select></label>
}
/** The official ic_ds_chevron_down_outline_14 icon (verbatim path). */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <span className={`dsh-pt-card-chevron${open ? ' dsh-pt-card-chevron-open' : ''}`} aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}
const NUMBER_BOUNDS = {
  timeoutMs: { min: 1000, max: 300000, label: '超时时间' },
  maxChars: { min: 100, max: 4000, label: '分段字符数' },
} as const
function parseBoundedInt(raw: string, min: number, max: number): number | undefined {
  if (!raw.trim()) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined
}
export function SettingsCard(props: Props) {
  const state = useSettings(props)
  const catalogId = useId()
  const descriptionId = useId()
  const bodyId = useId()
  const [expanded, setExpanded] = useState(false)
  const { value, save, disabled, clearError } = state
  const [patch, setPatch] = useState<Partial<Options>>({})
  const [numberText, setNumberText] = useState<Partial<Record<'timeoutMs' | 'maxChars', string>>>({})
  const [saveError, setSaveError] = useState('')
  const [groups, setGroups] = useState<CatalogGroup[]>([])
  const [catalogError, setCatalogError] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const draft = { ...value, ...patch }
  const dirty = Object.entries(patch).some(([key, next]) => next !== value[key as keyof Options])
    || (numberText.timeoutMs !== undefined && numberText.timeoutMs !== String(value.timeoutMs))
    || (numberText.maxChars !== undefined && numberText.maxChars !== String(value.maxChars))
  const edit = <K extends keyof Options>(key: K, next: Options[K]) => { setSaveError(''); setPatch(current => ({ ...current, [key]: next })) }
  const editNumber = (key: 'timeoutMs' | 'maxChars', raw: string) => {
    setSaveError('')
    setNumberText(current => ({ ...current, [key]: raw }))
    const { min, max } = NUMBER_BOUNDS[key]
    const parsed = parseBoundedInt(raw, min, max)
    if (parsed !== undefined) setPatch(current => ({ ...current, [key]: parsed }))
  }
  useEffect(() => {
    let alive = true
    if (!props.catalog) { setGroups([]); setCatalogError(''); return }
    void props.catalog.modelCatalog().then(reply => {
      if (!alive) return
      if (reply.ok) { setGroups(reply.value.groups); setCatalogError('') }
      else setCatalogError(reply.error.message)
    }).catch(err => { if (alive) setCatalogError(String(err instanceof Error ? err.message : err)) })
    return () => { alive = false }
  }, [props.catalog])
  const providers = groups
  const models = useMemo(() => groups.find(group => group.id === draft.provider)?.models ?? [], [groups, draft.provider])
  const text = (key: 'apiKey' | 'appId' | 'region' | 'provider' | 'model' | 'reasoningEffort', label: string, list?: string) => <label>{label}<input
    type={key === 'apiKey' ? 'password' : 'text'} autoComplete="off" list={list ? `${catalogId}-${list}` : undefined}
    value={key === 'apiKey' ? patch.apiKey ?? '' : draft[key]}
    placeholder={key === 'apiKey' ? '留空保留已有密钥' : undefined}
    onChange={event => edit(key, event.target.value)} /></label>
  const submit = () => {
    const changes = { ...patch }
    setSaveError('')
    for (const key of ['timeoutMs', 'maxChars'] as const) {
      const raw = numberText[key]
      if (raw !== undefined) {
        const { min, max, label } = NUMBER_BOUNDS[key]
        const parsed = parseBoundedInt(raw, min, max)
        if (parsed === undefined) {
          setSaveError(`${label}须为 ${min}–${max} 之间的整数。`)
          return
        }
        changes[key] = parsed
      }
    }
    if (draft.engine !== value.engine && !changes.apiKey?.trim()) {
      setSaveError('切换翻译服务时，请输入新服务的 API 密钥。')
      return
    }
    if (changes.apiKey === '') delete changes.apiKey
    void save(changes).then(ok => {
      if (ok && mounted.current) { setPatch({}); setNumberText({}); setExpanded(false) }
    })
  }
  return <section className={`dsh-pt-card${expanded ? ' dsh-pt-card-open' : ''}`}>
    <button type="button" className="dsh-pt-card-header" aria-expanded={expanded} aria-controls={bodyId} aria-describedby={descriptionId} onClick={() => setExpanded(current => !current)}>
      <span className="dsh-pt-head-text"><span role="heading" aria-level={3} className="dsh-pt-card-name">提示词与输出翻译</span><span id={descriptionId} className="dsh-pt-card-description">输入译向目标语言，思考与回答译回原始语言。</span></span>
      {dirty && <span className="dsh-pt-tag">未保存</span>}
      <ChevronIcon open={expanded} />
    </button>
    <form id={bodyId} className="dsh-pt-card-body" hidden={!expanded} noValidate onSubmit={event => { event.preventDefault(); submit() }}>
    <fieldset disabled={disabled} className="dsh-pt-fields">
      <label><input type="checkbox" checked={draft.enabled} onChange={event => edit('enabled', event.target.checked)} />启用翻译</label>
      <div className="dsh-pt-row"><LanguageSelect source value={draft.source} onChange={next => edit('source', next)} /><span>→</span><LanguageSelect value={draft.target} onChange={next => { if (next !== 'auto') edit('target', next) }} /></div>
      <label>翻译类型<select value={draft.type} onChange={event => edit('type', event.target.value as Options['type'])}><option value="traditional">传统翻译接口</option><option value="agent">智能体（已有模型）</option></select></label>
      <div className="dsh-pt-row">{(['userPrompt', 'reasoning', 'output'] as const).map((key, index) => <label key={key}><input type="checkbox" checked={draft[key]} onChange={event => edit(key, event.target.checked)} />{['用户提示词', '思考内容', '输出内容'][index]}</label>)}</div>
      {draft.type === 'traditional' ? <>
        <label>翻译服务<select value={draft.engine} onChange={event => { setSaveError(''); setPatch(current => ({ ...current, engine: event.target.value as Options['engine'], apiKey: '' })) }}><option value="baidu">百度</option><option value="google">Google Cloud Translation</option><option value="deepl">DeepL</option><option value="microsoft">Microsoft Translator</option></select></label>
        {text('apiKey', draft.engine === 'baidu' ? '百度密钥' : 'API 密钥')}
        {draft.engine === 'baidu' && text('appId', '百度 App ID')}
        {draft.engine === 'microsoft' && text('region', '微软资源区域')}
        {draft.engine === 'deepl' && <label><input type="checkbox" checked={draft.deeplFree} onChange={event => edit('deeplFree', event.target.checked)} />DeepL Free API</label>}
      </> : <>
        {text('provider', '提供商 ID', 'dsh-pt-providers')}<datalist id={`${catalogId}-dsh-pt-providers`}>{providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist>
        {text('model', '模型 ID', 'dsh-pt-models')}<datalist id={`${catalogId}-dsh-pt-models`}>{models.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</datalist>
        {text('reasoningEffort', '推理强度（留空使用模型默认值）', 'dsh-pt-efforts')}<datalist id={`${catalogId}-dsh-pt-efforts`}>{(models.find(model => model.id === draft.model)?.reasoning?.efforts ?? []).map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}</datalist>
        <small>使用 DSH 已配置的提供商与模型。推理强度必须是该模型支持的 ID。</small>
        {catalogError && <p role="status">模型列表暂不可用：{catalogError}。可以手动填写已有 ID。</p>}
      </>}
      <details><summary>高级设置</summary>
        <label>超时（毫秒）<input type="number" min={1000} max={300000} step={1} value={numberText.timeoutMs ?? String(draft.timeoutMs)} onChange={event => editNumber('timeoutMs', event.target.value)} /></label>
        <label>分段字符数<input type="number" min={100} max={4000} step={1} value={numberText.maxChars ?? String(draft.maxChars)} onChange={event => editNumber('maxChars', event.target.value)} /></label>
      </details>
    </fieldset>
    <p className="dsh-pt-help">系统提示词不翻译。自动检测以本轮用户输入为准；思考与回答在完整文本块结束后显示译文。</p>
    <div className="dsh-pt-card-footer">
      {(saveError || state.error) && <p role="alert" className="dsh-pt-error">{saveError || state.error}</p>}
      <button type="button" className="dsh-pt-button" disabled={disabled || !dirty} onClick={() => { setPatch({}); setNumberText({}); setSaveError(''); clearError() }}>放弃修改</button>
      <button type="submit" className="dsh-pt-button dsh-pt-button-primary" disabled={disabled || !dirty}>保存设置</button>
    </div>
    </form>
  </section>
}
export function QuickPicker(props: Props & { sessionId: string }) {
  const state = useSettings(props)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [coords, setCoords] = useState<{ left: number; top?: number; bottom?: number }>({ left: 8, bottom: 56 })
  const anchor = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  useEffect(() => { setOpen(false) }, [props.sessionId])
  useLayoutEffect(() => {
    const marker = anchor.current
    if (!marker) return
    // Host renderer guarantees data-slot anchors. Restrict lookup to this composer.
    const outlet = marker.closest('[data-slot="conversation.input.left"]')
    const row = outlet?.parentElement
    if (!row) return
    const mount = document.createElement('span')
    mount.className = 'dsh-pt-seat'
    const reconcile = () => {
      const permission = row.querySelector('[data-slot="conversation.input.permission"]')
      if (!permission?.parentElement) {
        mount.remove()
        setTarget(null)
        return
      }
      if (mount.previousElementSibling !== permission) {
        permission.after(mount)
        setTarget(mount)
      }
    }
    const observer = new MutationObserver(reconcile)
    observer.observe(row, { childList: true, subtree: true })
    reconcile()
    return () => { observer.disconnect(); mount.remove() }
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = popover.current?.offsetWidth || 300
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      if (rect.top >= 140 || window.innerHeight - rect.bottom < rect.top) {
        setCoords({ left, bottom: Math.max(8, window.innerHeight - rect.top + 10) })
      } else {
        setCoords({ left, top: Math.max(8, rect.bottom + 10) })
      }
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      const node = event.target as Node | null
      if (!trigger.current?.contains(node) && !popover.current?.contains(node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const dialog = open && (
    <div className="dsh-pt-popover" ref={popover} role="dialog" aria-label="快捷翻译设置" style={coords}>
      <label><input type="checkbox" disabled={state.disabled} checked={state.value.enabled} onChange={event => { void state.save({ enabled: event.target.checked }) }} />启用翻译</label>
      <div className="dsh-pt-language-row"><LanguageSelect compact source disabled={state.disabled} value={state.value.source} onChange={source => { void state.save({ source }) }} />
      <span className="dsh-pt-arrow" aria-hidden="true">→</span><LanguageSelect compact disabled={state.disabled} value={state.value.target} onChange={target => { if (target !== 'auto') void state.save({ target }) }} />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  )
  const control = <div className="dsh-pt-quick">
    <button ref={trigger} type="button" aria-label="翻译" aria-haspopup="dialog" aria-expanded={open} title={`翻译${state.value.enabled ? '已开启' : '已关闭'}：${languages[state.value.source]} ⇄ ${languages[state.value.target]}`} data-enabled={state.value.enabled} onClick={() => setOpen(!open)} className={state.value.enabled ? 'dsh-pt-active' : ''}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 5h12M9 2v3M5 5c1 6 4 9 9 11M13 5c-1 6-4 9-10 12M13 21l4-10 4 10M15 17h4" />{!state.value.enabled && <path data-translation-disabled="" d="M3 3l18 18" strokeWidth="2" />}</svg>
    </button>
    {dialog && (typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog)}
  </div>
  return <><span ref={anchor} data-dsh-prompt-translation-anchor="" style={target ? { display: 'none' } : undefined}>{target ? null : control}</span>{target && createPortal(control, target)}</>
}
