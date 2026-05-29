'use client'

/**
 * AdsFixDrawer — P18.A.2
 *
 * Execution-board drawer for performing real Meta Ads actions:
 *   - Pause a campaign (stop budget bleed)
 *   - Adjust daily budget (reduce spend on high-CPA campaigns)
 *
 * Data source: meta_ads_snapshots.campaigns JSONB (top campaigns by spend).
 * Execution: POST /api/clients/[id]/meta-ads/execute
 * Audit:     flywheel_actions table (written by execute route)
 */

import { useState, useEffect } from 'react'
import type { ItemWithLogs } from '../execution-view-model'

interface MetaCampaign {
  campaign_id:   string
  campaign_name: string
  spend:         number
  impressions:   number
  clicks:        number
  roas:          number | null
  ctr:           number | null
  cpc:           number | null
}

type ActionType = 'ads.pause_campaign' | 'ads.adjust_bid'
type Phase = 'select' | 'confirm' | 'submitting' | 'done' | 'error'

interface ExecuteResult {
  success:    boolean
  actionId?:  string
  campaignId: string
  before:     { status: string; name: string; daily_budget: string | null }
  after:      { status: string; name: string; daily_budget: string | null }
  warning?:   string
}

interface Props {
  clientId: string
  item:     ItemWithLogs
  onClose:  () => void
}

export function AdsFixDrawer({ clientId, item, onClose }: Props) {
  const [campaigns, setCampaigns]         = useState<MetaCampaign[]>([])
  const [loadingCampaigns, setLoadingCampaigns] = useState(true)
  const [selected, setSelected]           = useState<MetaCampaign | null>(null)
  const [actionType, setActionType]       = useState<ActionType>('ads.pause_campaign')
  const [newDailyBudget, setNewDailyBudget] = useState('')
  const [phase, setPhase]                 = useState<Phase>('select')
  const [result, setResult]               = useState<ExecuteResult | null>(null)
  const [errorMsg, setErrorMsg]           = useState('')

  // Fetch latest snapshot campaigns
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/meta-ads/snapshots?limit=1`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as {
          latest?: { campaigns?: MetaCampaign[] | null }
        }
        if (!cancelled) {
          setCampaigns(json.latest?.campaigns ?? [])
        }
      } catch {
        if (!cancelled) setCampaigns([])
      } finally {
        if (!cancelled) setLoadingCampaigns(false)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  async function handleExecute() {
    if (!selected) return
    setPhase('submitting')

    try {
      const body: Record<string, unknown> = {
        action_type:       actionType,
        campaign_id:       selected.campaign_id,
        params: {
          execution_item_id: item.id,
          ...(actionType === 'ads.adjust_bid' && newDailyBudget
            ? { new_daily_budget: parseFloat(newDailyBudget) }
            : {}),
        },
      }

      const res = await fetch(`/api/clients/${clientId}/meta-ads/execute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      const data = await res.json() as ExecuteResult & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setResult(data)
      setPhase('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  const fmtCurrency = (v: number) =>
    `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const fmtPct = (v: number | null) =>
    v != null ? `${(v * 100).toFixed(2)}%` : '—'

  const budgetFromCents = (s: string | null) =>
    s ? `$${(parseInt(s, 10) / 100).toFixed(2)}` : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-slate-950/35" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 z-[80] flex h-dvh w-full flex-col bg-[#fbfcf7] shadow-2xl lg:w-[min(780px,calc(100vw-30rem))] xl:w-[min(880px,48vw)]">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-orange-700">
              Meta Ads · 直接执行
            </p>
            <h2 className="mt-1 truncate text-xl font-black text-slate-950">
              {item.title}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              选择广告系列并执行修复动作 — 操作将实时写入 Meta Ads
            </p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl font-black text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700"
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">

          {/* Done state */}
          {phase === 'done' && result && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm font-black text-emerald-700">执行成功</p>
                {result.warning && (
                  <p className="mt-1 text-xs text-amber-700">⚠ {result.warning}</p>
                )}
              </div>

              {/* Before / After comparison */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <p className="text-xs font-black text-slate-700 uppercase tracking-wide">执行详情</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">执行前</p>
                    <p className="text-sm font-black text-slate-800">{result.before.name}</p>
                    <p className="text-xs text-slate-500 mt-1">状态: {result.before.status}</p>
                    {result.before.daily_budget && (
                      <p className="text-xs text-slate-500">日预算: {budgetFromCents(result.before.daily_budget)}</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-[10px] font-black text-emerald-500 uppercase mb-1">执行后</p>
                    <p className="text-sm font-black text-slate-800">{result.after.name}</p>
                    <p className="text-xs text-slate-500 mt-1">状态: <strong className="text-emerald-700">{result.after.status}</strong></p>
                    {result.after.daily_budget && result.after.daily_budget !== result.before.daily_budget && (
                      <p className="text-xs text-slate-500">日预算: <strong className="text-emerald-700">{budgetFromCents(result.after.daily_budget)}</strong></p>
                    )}
                  </div>
                </div>
                {result.actionId && (
                  <p className="text-[10px] font-mono text-slate-400">Action ID: {result.actionId}</p>
                )}
              </div>

              <button
                onClick={onClose}
                className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-slate-800"
              >
                关闭
              </button>
            </div>
          )}

          {/* Error state */}
          {phase === 'error' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                <p className="text-sm font-black text-red-700">执行失败</p>
                <p className="mt-1 break-all text-sm font-semibold text-red-900">{errorMsg}</p>
                {errorMsg.includes('424') || errorMsg.toLowerCase().includes('token') ? (
                  <p className="mt-2 text-xs text-red-600">
                    需要在 Render 环境变量中设置 META_SYSTEM_USER_TOKEN（长效 System User Token）
                  </p>
                ) : null}
              </div>
              <button
                onClick={() => { setPhase('confirm'); setErrorMsg('') }}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-colors hover:border-slate-300"
              >
                重试
              </button>
            </div>
          )}

          {/* Select / Confirm state */}
          {(phase === 'select' || phase === 'confirm' || phase === 'submitting') && (
            <div className="space-y-5">

              {/* Campaign list */}
              <div className="space-y-2">
                <p className="text-sm font-black text-slate-800">选择广告系列</p>
                {loadingCampaigns ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
                    ))}
                  </div>
                ) : campaigns.length === 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-800">尚无广告系列数据</p>
                    <p className="mt-1 text-xs text-amber-600">
                      先运行一次 Meta Ads Sync 拉取最新广告系列数据，然后再执行修复动作。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {campaigns.map(c => (
                      <button
                        key={c.campaign_id}
                        onClick={() => { setSelected(c); setPhase('confirm') }}
                        disabled={phase === 'submitting'}
                        className={`w-full rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${
                          selected?.campaign_id === c.campaign_id
                            ? 'border-orange-300 bg-orange-50 shadow-sm'
                            : 'border-slate-200 bg-white hover:border-orange-200 hover:shadow-sm'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-black text-slate-900 leading-snug">{c.campaign_name}</p>
                          <span className="shrink-0 text-xs font-semibold text-slate-500">
                            {fmtCurrency(c.spend)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                          <span>ROAS {c.roas != null ? c.roas.toFixed(2) : '—'}</span>
                          <span>CTR {fmtPct(c.ctr)}</span>
                          <span>{c.clicks.toLocaleString()} clicks</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Action type selector (shown once campaign is selected) */}
              {selected && (
                <div className="space-y-3">
                  <p className="text-sm font-black text-slate-800">执行动作</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setActionType('ads.pause_campaign')}
                      disabled={phase === 'submitting'}
                      className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${
                        actionType === 'ads.pause_campaign'
                          ? 'border-red-300 bg-red-50'
                          : 'border-slate-200 bg-white hover:border-red-200'
                      }`}
                    >
                      <p className="text-sm font-black text-slate-900">暂停广告系列</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">停止所有花费，可随时恢复</p>
                    </button>
                    <button
                      onClick={() => setActionType('ads.adjust_bid')}
                      disabled={phase === 'submitting'}
                      className={`rounded-xl border p-3 text-left transition-all disabled:opacity-50 ${
                        actionType === 'ads.adjust_bid'
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-blue-200'
                      }`}
                    >
                      <p className="text-sm font-black text-slate-900">调整日预算</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">降低花费，保留投放（需 CBO）</p>
                    </button>
                  </div>

                  {/* Budget input for adjust_bid */}
                  {actionType === 'ads.adjust_bid' && (
                    <div className="space-y-2">
                      <label className="block text-sm font-black text-slate-800">
                        新日预算（AUD）
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={newDailyBudget}
                        onChange={e => setNewDailyBudget(e.target.value)}
                        placeholder="50.00"
                        disabled={phase === 'submitting'}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100 disabled:opacity-50"
                      />
                      <p className="text-xs text-slate-400">
                        仅适用于开启了 CBO（广告系列预算优化）的广告系列。
                        如需调整广告组预算，请前往 Meta Ads Manager 操作。
                      </p>
                    </div>
                  )}

                  {/* Confirm summary */}
                  {phase === 'confirm' && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                      <p className="text-sm font-black text-orange-900">确认执行</p>
                      <p className="mt-1 text-sm text-orange-800">
                        将对广告系列「{selected.campaign_name}」执行：
                        <strong className="ml-1">
                          {actionType === 'ads.pause_campaign' ? '暂停' : `调整日预算至 $${newDailyBudget}`}
                        </strong>
                      </p>
                      <p className="mt-1 text-xs text-orange-600">此操作将实时写入 Meta Ads，花费立即停止或变化。</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === 'select' || phase === 'confirm' || phase === 'submitting') && selected && (
          <footer className="border-t border-slate-200 bg-white px-5 py-4">
            {phase === 'select' && (
              <p className="text-center text-xs text-slate-400">请在上方选择广告系列和动作后确认</p>
            )}
            {(phase === 'confirm' || phase === 'submitting') && (
              <button
                onClick={() => void handleExecute()}
                disabled={
                  phase === 'submitting' ||
                  !selected ||
                  (actionType === 'ads.adjust_bid' && (!newDailyBudget || parseFloat(newDailyBudget) <= 0))
                }
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-sm font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === 'submitting' ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    执行中…
                  </>
                ) : '确认执行 →'}
              </button>
            )}
          </footer>
        )}
      </aside>
    </>
  )
}
