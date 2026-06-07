'use client'

/**
 * LocaleSettingsPanel — FDE-managed business locale (country/state/city/scope).
 *
 * Single write entry for clients.{country, state_code, city, business_scope};
 * semrush_db is auto-synced server-side from country (AU↔au, NZ↔nz).
 * timezone is not stored — it is derived from country at consume sites
 * (Australia/Sydney, Pacific/Auckland — see src/lib/diagnostic/synthesis/market-context.ts).
 *
 * BUG-FMT-S07 — fills the empty "§ 2 · 业务地域" section in SettingsDrawer.
 * Previously embedded <LocaleConfirmBanner /> which returns null once
 * locale_confirmed_at is set, leaving the FDE with a titled-but-empty card.
 *
 * Consumed by
 *   - DataForSEO market routing (semrush_db)
 *   - Reputation/Competitor diagnostic adapters (country + city)
 *   - AI Tracker market-context (country → timezone)
 *
 * Mirrors MetaAdAccountPanel.tsx layout (load / draft / save / savedAt).
 */

import { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
}

type Country = 'AU' | 'NZ'
type Scope   = 'local' | 'state' | 'national'

interface LocaleData {
  country:             Country
  state_code:          string | null
  city:                string | null
  business_scope:      Scope
  locale_confirmed_at: string | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   locale: LocaleData; auStates: string[]; nzRegions: string[] }

const AU_STATE_LABELS: Record<string, string> = {
  VIC: 'Victoria',
  NSW: 'New South Wales',
  QLD: 'Queensland',
  WA:  'Western Australia',
  SA:  'South Australia',
  TAS: 'Tasmania',
  ACT: 'Australian Capital Territory',
  NT:  'Northern Territory',
}

const NZ_REGION_LABELS: Record<string, string> = {
  AKL: 'Auckland',
  WLG: 'Wellington',
  CAN: 'Canterbury',
  WKO: 'Waikato',
  OTG: 'Otago',
  HKB: "Hawke's Bay",
  NLS: 'Nelson',
  MBR: 'Marlborough',
  STH: 'Southland',
  TRK: 'Taranaki',
}

const SCOPE_OPTIONS: { value: Scope; label: string; desc: string }[] = [
  { value: 'local',    label: '本地',  desc: '仅服务本城市/本区' },
  { value: 'state',    label: '州级',  desc: '服务整个州/省' },
  { value: 'national', label: '全国',  desc: '服务全澳/全新西兰' },
]

export function LocaleSettingsPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [country, setCountry] = useState<Country>('AU')
  const [stateCode, setStateCode] = useState('')
  const [city,    setCity]    = useState('')
  const [scope,   setScope]   = useState<Scope>('local')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/locale`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as {
        locale:     LocaleData
        au_states:  string[]
        nz_regions: string[]
      }
      setState({
        phase:     'ready',
        locale:    body.locale,
        auStates:  body.au_states ?? [],
        nzRegions: body.nz_regions ?? [],
      })
      setCountry(body.locale.country)
      setStateCode(body.locale.state_code ?? '')
      setCity(body.locale.city ?? '')
      setScope(body.locale.business_scope)
    } catch (err) {
      setState({
        phase:   'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { locale, auStates, nzRegions } = state
  const stateOptions = country === 'AU' ? auStates : nzRegions
  const stateLabels  = country === 'AU' ? AU_STATE_LABELS : NZ_REGION_LABELS
  const stateLabel   = country === 'AU' ? '州/地区' : '省/地区'

  const trimmedCity = city.trim()
  const dirty =
    country    !== locale.country ||
    stateCode  !== (locale.state_code ?? '') ||
    trimmedCity !== (locale.city ?? '') ||
    scope      !== locale.business_scope

  const semrushDb = country === 'NZ' ? 'nz' : 'au'
  const timezone  = country === 'NZ' ? 'Pacific/Auckland' : 'Australia/Sydney'

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/locale`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          country,
          state_code: stateCode || null,
          city:       trimmedCity || null,
          business_scope: scope,
          // Always renew locale_confirmed_at on save so the timestamp tracks
          // "last reviewed" instead of "first ever confirmed". Route uses a
          // single-direction gate (`if (body.confirm === true)`) so this never
          // un-confirms a previously confirmed locale.
          confirm:    true,
        }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      const { locale: saved } = (await res.json()) as { locale: LocaleData & { semrush_db?: string } }
      setState({
        phase:     'ready',
        locale: {
          country:             (saved.country as Country) ?? country,
          state_code:          saved.state_code ?? null,
          city:                saved.city ?? null,
          business_scope:      (saved.business_scope as Scope) ?? scope,
          locale_confirmed_at: saved.locale_confirmed_at ?? new Date().toISOString(),
        },
        auStates,
        nzRegions,
      })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-4 text-sm text-slate-600">
        客户业务所在国家、地区、城市 + 服务范围。多模块共用（6 维诊断 reputation/competitor、AI Tracker market-context、DataForSEO 路由）。
      </p>

      {/* Country */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">国家</label>
        <div className="flex gap-2">
          {(['AU','NZ'] as const).map(c => (
            <button
              key={c}
              onClick={() => { setCountry(c); setStateCode('') }}
              className={`flex-1 rounded-lg border py-2 text-sm font-bold transition-colors ${
                country === c
                  ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                  : 'border-slate-300 text-slate-500 hover:border-slate-400'
              }`}
            >
              {c === 'AU' ? '🇦🇺 Australia' : '🇳🇿 New Zealand'}
            </button>
          ))}
        </div>
      </div>

      {/* State / Region */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{stateLabel}</label>
        <select
          value={stateCode}
          onChange={e => setStateCode(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        >
          <option value="">— 请选择 —</option>
          {stateOptions.map(code => (
            <option key={code} value={code}>
              {stateLabels[code] ? `${stateLabels[code]} (${code})` : code}
            </option>
          ))}
        </select>
      </div>

      {/* City */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">城市</label>
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="e.g. Auckland CBD, Melbourne"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        />
      </div>

      {/* Business scope */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">业务范围</label>
        <div className="flex gap-2">
          {SCOPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setScope(opt.value)}
              className={`flex-1 rounded-lg border px-2 py-2 text-center transition-colors ${
                scope === opt.value
                  ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                  : 'border-slate-300 text-slate-500 hover:border-slate-400'
              }`}
            >
              <div className="text-sm font-bold">{opt.label}</div>
              <div className="mt-0.5 text-xs text-slate-400">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Derived (read-only) fields */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
        <p className="mb-1 font-bold text-slate-600">由国家自动推导（不必手填）</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
          <span>SEMrush DB: <code className="rounded bg-white px-1 font-mono">{semrushDb}</code></span>
          <span>时区: <code className="rounded bg-white px-1 font-mono">{timezone}</code></span>
        </div>
      </div>

      {errMsg && (
        <p className="mb-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => {
              setCountry(locale.country)
              setStateCode(locale.state_code ?? '')
              setCity(locale.city ?? '')
              setScope(locale.business_scope)
            }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && savedAt && (
          <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>
        )}
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        消费方：6 维诊断（reputation 用 country + city 跑 GBP / Apify；competitor 用 country 路由 DataForSEO）·
        AI Tracker（用 country 推时区当 location signal）· SEO 关键词（用 semrush_db 跑搜索量）。
      </p>
    </div>
  )
}
