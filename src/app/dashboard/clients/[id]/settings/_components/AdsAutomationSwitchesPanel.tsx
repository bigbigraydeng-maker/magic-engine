'use client'

/**
 * Internal-admin switches for the three ads automation flags.
 * Portal users get 403 and see nothing. Writes go through the automation-switches route.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AdsAutomationSwitchKey, AdsAutomationSwitches } from '@/lib/ads-strategy/automation-switches'

const ROWS: Array<{ key: AdsAutomationSwitchKey; title: string; help: string }> = [
  {
    key: 'ads_predictive_early_warning',
    title: '日内成本预警',
    help: '今天的获客成本或对话成本，比过去 7 天的平均贵了两成，就提醒内部的人。不会改广告。',
  },
  {
    key: 'ads_trend_check',
    title: '日趋势检查',
    help: '每天看广告效果有没有变差，变差了写进巡察和今日待办。不会改广告。',
  },
  {
    key: 'ads_tune_cards',
    title: '调优确认卡',
    help: '巡察点名要调的广告组时，先出一张确认卡等人点头。点头之后才走现有流程；这张卡要等调优那部分上线才会真的发出。',
  },
]

const OFF: AdsAutomationSwitches = {
  ads_predictive_early_warning: false,
  ads_trend_check: false,
  ads_tune_cards: false,
}

type Phase = 'loading' | 'hidden' | 'error' | 'ready'

export function AdsAutomationSwitchesPanel({ clientId }: { clientId: string }) {
  const state = useAdsAutomationSwitches(clientId)
  if (state.phase === 'hidden') return null
  if (state.phase === 'loading') return <p className="mt-3 text-sm text-slate-400">加载广告自动化开关…</p>
  if (state.phase === 'error') {
    return (
      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">广告自动化开关加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.loadError}</p>
      </div>
    )
  }
  return (
    <div className="mt-3 space-y-3">
      {ROWS.map((row) => (
        <SwitchRow
          key={row.key}
          title={row.title}
          help={row.help}
          on={state.switches[row.key]}
          busy={state.savingKey !== null}
          onToggle={() => void state.toggle(row.key, !state.switches[row.key])}
        />
      ))}
      {state.saveError && <p className="text-xs text-red-600">⚠ {state.saveError}</p>}
    </div>
  )
}

function SwitchRow({
  title,
  help,
  on,
  busy,
  onToggle,
}: {
  title: string
  help: string
  on: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{help}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-slate-500">{on ? '已开启' : '已关闭'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`开关${title}`}
            disabled={busy}
            onClick={onToggle}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-cyan-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}

async function fetchSwitches(base: string): Promise<
  | { kind: 'hidden' }
  | { kind: 'ready'; switches: AdsAutomationSwitches }
  | { kind: 'error'; message: string }
> {
  try {
    const res = await fetch(base, { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) return { kind: 'hidden' }
    const json = (await res.json().catch(() => ({}))) as { switches?: AdsAutomationSwitches; error?: string }
    if (!res.ok || !json.switches) return { kind: 'error', message: json.error ?? `HTTP ${res.status}` }
    return { kind: 'ready', switches: json.switches }
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

async function postSwitch(base: string, key: AdsAutomationSwitchKey, next: boolean): Promise<AdsAutomationSwitches> {
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: next }),
  })
  const json = (await res.json().catch(() => ({}))) as { switches?: AdsAutomationSwitches; error?: string }
  if (!res.ok || !json.switches) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.switches
}

function useAdsAutomationSwitches(clientId: string) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [switches, setSwitches] = useState<AdsAutomationSwitches>(OFF)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<AdsAutomationSwitchKey | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const base = `/api/clients/${clientId}/ad-strategy-config/automation-switches`

  const reload = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    const loaded = await fetchSwitches(base)
    if (loaded.kind === 'hidden') setPhase('hidden')
    else if (loaded.kind === 'error') {
      setPhase('error')
      setLoadError(loaded.message)
    } else {
      setSwitches(loaded.switches)
      setPhase('ready')
    }
  }, [base])

  useEffect(() => {
    void reload()
  }, [reload])

  const toggle = useCallback(async (key: AdsAutomationSwitchKey, next: boolean) => {
    if (phase !== 'ready') return
    setSavingKey(key)
    setSaveError(null)
    const prev = switches
    setSwitches({ ...prev, [key]: next })
    try {
      setSwitches(await postSwitch(base, key, next))
    } catch (err) {
      setSwitches(prev)
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(null)
    }
  }, [base, phase, switches])

  return { phase, switches, loadError, savingKey, saveError, toggle }
}
