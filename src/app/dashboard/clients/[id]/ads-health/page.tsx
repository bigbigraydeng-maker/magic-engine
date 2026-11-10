'use client'

/**
 * Ads Health dashboard — P21.K.3
 *
 * The PM-facing face of the Ad Strategy Engine. Built for a non-technical
 * reader (板桥 review): one-line conclusion first, worst campaign first, every
 * verdict backed by the last 7 days of raw numbers so the PM can see the decay
 * with their own eyes rather than trust a black box. All judgement is done by
 * the daily cron; this page only reads ad_health_narratives.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
// Pure data module (no server imports) — safe in a client component.
import { resolveAdsPlaybook, type AdsPlaybook } from '@/lib/ads-strategy/playbooks'
import AutonomySettings from './autonomy-settings'
import GrowthPanel, { type GrowthStateView } from './growth-panel'
import BreakdownPanel from './breakdown-panel'
import LiveTodayPanel from './live-today-panel'
import EntityTreePanel from './entity-tree-panel'
import AutoPausePanel from './auto-pause-panel'
import { PAGE_TABS, tabFromQuery, type PageTab } from './tabs'
import { AdsHealthTodayTab } from './ads-health-today-tab'
import { CurrentWinnerPanel } from './current-winner-panel'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'

type Verdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

interface MetricVerdict {
  metric: 'ctr' | 'cost_per_result'
  verdict: Verdict
  baseline: number | null
  recent: number | null
  ratio: number | null
  reason: string
}

interface Prescription {
  kind: 'refresh_creatives' | 'rotate_audience' | 'review_offer'
  title: string
  why: string
  executable: boolean
  execute_hint?: string
}

interface CampaignNarrative {
  campaign_id: string
  campaign_name: string
  verdict: Verdict
  headline: string
  metrics: MetricVerdict[]
  ctr_series: Array<{ date: string; ctr: number | null }>
  latest_spend_7d: number
  latest_results_7d: number
  frequency_7d: number | null
  /** Optional: narratives written before the prescription layer have none. */
  prescription?: Prescription | null
}

interface Payload {
  overall_verdict: Verdict
  headline: string
  campaigns: CampaignNarrative[]
  evaluated: number
  generated_for: string
}

interface AdHealthResponse {
  success: boolean
  latest: {
    insight_date: string
    overall_verdict: Verdict
    headline: string
    payload: Payload
  } | null
  history: Array<{ insight_date: string; overall_verdict: Verdict }>
  /** clients.industry — picks the result words; absent → neutral words. */
  industry?: string | null
  /** 卫青巡察当天的经营状态。null = 今天还没跑；缺字段 = 这一段读不到（接口出错）。 */
  growth?: GrowthStateView | ClientGrowthView | null
  /** 今天 CRM 表单进线（新西兰日）；null = 读不到 */
  today_crm_leads?: number | null
}

// ─── Verdict styling (colour = conclusion, per 板桥) ───────────────────────────

const VERDICT_META: Record<Verdict, { label: string; dot: string; tint: string; text: string }> = {
  alert:                { label: '该动手了', dot: 'bg-status-rej',   tint: 'border-status-rej/25 bg-status-rej/10', text: 'text-status-rej' },
  watch:                { label: '留意',     dot: 'bg-status-exec',  tint: 'border-me-ochre/30 bg-me-ochre/10',     text: 'text-me-ochre' },
  healthy:              { label: '健康',     dot: 'bg-status-track', tint: 'border-status-track/25 bg-status-track/10', text: 'text-status-track' },
  insufficient_history: { label: '数据积累中', dot: 'bg-status-attn',  tint: 'border-me-stone bg-me-ivory',            text: 'text-status-attn' },
  paused:               { label: '已停投',   dot: 'bg-me-taupe',     tint: 'border-me-stone bg-me-stone/40 opacity-80', text: 'text-me-taupe' },
}

function fmtDataUpdatedLine(insightDate: string): string {
  const parts = insightDate.split('-').map((x) => parseInt(x, 10))
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return `数据更新于 ${insightDate}（新西兰时间）`
  const [, month, day] = parts
  return `数据更新于 ${month}月${day}日 早上 6:00（新西兰时间）`
}

function fmtPct(fraction: number | null): string {
  return fraction == null ? '—' : `${(fraction * 100).toFixed(1)}%`
}

const VERDICT_RANK: Record<Verdict, number> = {
  alert: 3, watch: 2, healthy: 1, insufficient_history: 0, paused: -1,
}

/** Short date like "7/14" for the mobile-friendly strip endpoints. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

// ─── Last 7 days of link CTR (link clicks ÷ impressions) ───────────────────────
// All-click "best week" is not shown beside these days: that baseline is a different count.

function CtrStrip({ series }: { series: Array<{ date: string; ctr: number | null }> }) {
  const points = series.filter(p => p.ctr != null)
  if (points.length < 1) return null

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-gray-400 mr-0.5">近 7 天链接点击率:</span>
        {points.map((p, i) => {
          const prev = i > 0 ? points[i - 1].ctr : null
          const down = prev != null && p.ctr != null && p.ctr < prev
          return (
            <span key={p.date} className="inline-flex items-center" title={p.date}>
              <span className={`tabular-nums ${down ? 'text-red-600' : 'text-gray-600'}`}>
                {down && <span aria-hidden className="mr-0.5">↓</span>}
                {fmtPct(p.ctr)}
              </span>
              {i < points.length - 1 && <span className="text-gray-300 mx-0.5">→</span>}
            </span>
          )
        })}
      </div>
      <div className="mt-1 text-[11px] text-gray-400">
        {shortDate(points[0].date)} → {shortDate(points[points.length - 1].date)}
        <span className="ml-1">点进链接的次数 ÷ 曝光，不含点头像、评论那些。</span>
      </div>
    </div>
  )
}

// ─── Prescription block (DAPE P→E: the remedy + the button) ───────────────────

function PrescriptionBlock({ clientId, c }: { clientId: string; c: CampaignNarrative }) {
  const p = c.prescription
  const [running, setRunning] = useState(false)
  // Once a run succeeds the button stays disabled for this page session —
  // a fast second click must not add a second batch (板桥 #7).
  const [done, setDone] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  if (!p) {
    // Old narratives (pre-prescription) — keep the original placeholder line.
    return (
      <p className="mt-3 text-xs text-gray-400 border-t border-gray-200/60 pt-2">
        → 具体怎么处理（换素材 / 调整），下一步的处方会给到，无需你手动操作。
      </p>
    )
  }

  const run = async () => {
    // The one line that makes it safe to press (板桥): existing ads untouched.
    const confirmText = `确定执行「${p.title}」?\n现有广告一条都不动,只是往里加暂停状态的新素材。\n${p.execute_hint ?? ''}`
    if (!window.confirm(confirmText)) return
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-health/execute-prescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: p.kind }),
      })
      const json = await res.json()

      // A prescription that cannot supply creative is NOT an error and must not
      // read as one. It also must never end with "明天再扫" — a reply with no
      // next step is what made the PM call this button unclosed (2026-07-25).
      // Every branch below hands back something to do right now.
      if (res.status === 409 || json.no_supply) {
        setDone(true)
        setResult({
          kind: 'err',
          text: '这个客户还没有可回收的老素材,所以补不了 —— 新片要现做。\n钱这边你现在就能按住:上面的「预算降 20%」或「先全停」。做片的事我去接,接通了告诉你。',
        })
        return
      }
      if (res.status === 403) {
        setResult({ kind: 'err', text: '需要内部账号操作。广告没有变更。' })
        return
      }
      if (res.status === 429) {
        setResult({ kind: 'err', text: '10 分钟内已补过,请稍后。' })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      const n =(json.adsAdded ?? []).length
      setDone(true)
      setResult({
        kind: 'ok',
        text: n > 0
          // No invented third party: ME did it, or it needs your click. Nothing
          // is ever "已通知团队" (板桥) — the PM knows there is no such team.
          ? `已出 ${n} 张确认卡。点确认之后才会建成暂停广告，不会直接开投。`
          : '现成的老素材里没有能用的,所以这次没补上 —— 新片要现做。\n钱这边你现在就能按住:上面的「预算降 20%」或「先全停」。做片的事我去接,接通了告诉你。',
      })
    } catch (err) {
      // Raw API errors are English tech-speak — log them, speak human (板桥 #5).
      console.error('[ads-health] execute-prescription failed:', err)
      setResult({ kind: 'err', text: '这次没执行成功,钱没动。稍后再点一次;连续失败我去查。' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mt-3 border-t border-gray-200/60 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-700">处方:{p.title}</p>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed">{p.why}</p>
          {p.execute_hint && <p className="mt-1 text-xs text-gray-400">{p.execute_hint}</p>}
        </div>
        {p.executable && (
          <button
            type="button"
            disabled={running || done}
            onClick={run}
            className="min-h-11 shrink-0 rounded-xl bg-me-charcoal px-4 py-2 text-sm font-semibold text-me-ivory hover:bg-me-black disabled:opacity-50"
          >
            {running ? '执行中…' : done ? '已执行 ✓' : '执行'}
          </button>
        )}
      </div>
      {result && (
        <p className={`mt-2 text-xs ${result.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
          {result.text}
        </p>
      )}
    </div>
  )
}

// ─── Campaign card ─────────────────────────────────────────────────────────────

interface StopLossPreview {
  campaign_name: string
  current_daily: number
  planned_daily: number | null
  cuttable: boolean
  pausable: boolean
  error?: string
}

/**
 * The money decision, offered BEFORE the creative one.
 *
 * Why it leads (板桥, 2026-07-25): behind a 🔴 card the PM is not asking "where
 * is more creative", he is asking "is my money still burning". Cutting or
 * pausing is the only action here that changes the answer the moment it is
 * pressed, and it needs no creative supply at all.
 *
 * Real numbers are fetched on click, not on render — a page with six cards must
 * not fire six ad-platform lookups nobody asked for.
 */
function StopLossBlock({ clientId, c, playbook }: { clientId: string; c: CampaignNarrative; playbook: AdsPlaybook }) {
  const [busy, setBusy] = useState<'cut' | 'pause' | null>(null)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [settled, setSettled] = useState(false)

  const run = async (action: 'cut' | 'pause') => {
    setBusy(action)
    setResult(null)
    try {
      const pv = await fetch(
        `/api/clients/${clientId}/ad-health/stop-loss?campaign_id=${c.campaign_id}`,
      ).then(r => r.json()) as StopLossPreview

      if (pv.error === 'no_meta_token') {
        setResult({ kind: 'err', text: '这个客户的广告账户还没连上 ME,暂时改不了。我去接,接好告诉你。' })
        return
      }
      if (pv.error) {
        setResult({ kind: 'err', text: '没读到这条广告的当前预算。稍后再点一次;连续失败我去查。' })
        return
      }

      if (action === 'pause' && pv.pausable === false) {
        setResult({ kind: 'err', text: '这条广告现在已经不在投放中,不需要再停。广告没有变更。' })
        return
      }

      if (action === 'cut' && !pv.cuttable) {
        // Not a dead end: offer pause as the next step (when the campaign is
        // still ACTIVE; the server may also refuse it with no_active_goal).
        setResult({
          kind: 'err',
          text: `这条广告的每天预算改不了(它用的不是「每日预算」)。能立刻做的是先全停 —— 要停就点右边的「先全停」。`,
        })
        return
      }

      const confirmText = action === 'cut'
        ? `把这条广告的每天预算降 20%?\n\n现在每天 $${pv.current_daily.toFixed(2)} → 降到 $${(pv.planned_daily ?? 0).toFixed(2)}\n广告继续跑,只是花得慢一点。随时可以调回来。`
        : `把这条广告先全停?\n\n它近 7 天花了 $${c.latest_spend_7d.toFixed(0)},带来 ${c.latest_results_7d} 个${playbook.resultNoun}。\n停了就不再花钱,随时可以重新开。`
      if (!window.confirm(confirmText)) return

      const res = await fetch(`/api/clients/${clientId}/ad-health/stop-loss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: c.campaign_id, action, request_id: globalThis.crypto.randomUUID() }),
      })
      if (res.status === 403) {
        setResult({ kind: 'err', text: '需要内部账号操作。广告没有变更。' })
        return
      }
      const json = await res.json()
      if (json.error === 'no_active_goal') {
        setResult({ kind: 'err', text: '这个客户还没有生效的增长目标，暂停动作暂时提交不了，广告没有变更。先在「目标与设置」补上目标后再试。' })
        return
      }
      if (json.error === 'goal_unreadable' || json.error === 'adsets_unreadable' || json.error === 'timezone_unreadable') {
        setResult({ kind: 'err', text: '系统暂时读不到执行所需资料，没有提交任何 Meta 修改。稍后再试；如果持续出现我会排查。' })
        return
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      if (json.not_cuttable) {
        setResult({ kind: 'err', text: '这条广告的每天预算改不了。能立刻做的是先全停。' })
        return
      }
      if (json.status === 'awaiting_confirmation') {
        setResult({ kind: 'err', text: '确认卡已出，预算和投放都还没改。请到确认卡上点确认。' })
        return
      }
      if (json.status === 'awaiting_approval') {
        setResult({ kind: 'err', text: '止损请求已登记，正在等待授权；广告目前还没有确认变更。' })
        return
      }
      if (json.status === 'in_progress') {
        setResult({ kind: 'err', text: '止损请求已在执行中，尚未拿到完成回执。请稍后刷新广告状态，不要重复提交。' })
        return
      }
      if (json.status === 'refused') {
        const denied = json.runs?.every((run: { kind: string }) => run.kind === 'denied')
        setResult({ kind: 'err', text: denied
          ? (json.reason ? `执行内核没有放行这次操作：${json.reason}` : '执行内核没有放行这次操作，广告没有变更。')
          : '执行内核没有给出完成回执；请先到 Meta 核实当前状态，再决定是否重试。' })
        return
      }
      if (json.status === 'partial') {
        setResult({ kind: 'err', text: `本次结果不一致：${json.succeeded_count} 项完成、${json.pending_count} 项待审批、${json.in_progress_count} 项执行中、${json.refused_count} 项未放行。请核对 Meta 当前状态后再决定下一步。` })
        return
      }
      if (!json.ok) {
        setResult({ kind: 'err', text: '广告平台这次没接受这个改动,钱没动。稍后再点一次;连续失败我去查。' })
        return
      }

      const warn = (json.warnings as string[] | undefined)?.filter(Boolean) ?? []
      const done = action === 'cut'
        ? `已降到每天 $${(json.new_daily as number).toFixed(2)}(原来 $${(json.current_daily as number).toFixed(2)})。`
        : '已停投,这条广告不再花钱了。'
      setResult({ kind: 'ok', text: warn.length > 0 ? `${done}\n⚠️ ${warn.join(' ')}` : done })
      setSettled(true)
    } catch (err) {
      console.error('[ads-health] stop-loss failed:', err)
      setResult({ kind: 'err', text: '系统没有收到明确回执，广告状态可能已变化。先去 Meta 核实，再决定是否重试。' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 border-t border-gray-200/60 pt-3">
      <p className="text-sm font-medium text-gray-700">先按住钱</p>
      <p className="mt-1 text-xs text-gray-500">
        换素材要时间。在那之前,先决定这条广告继续按现在的速度花钱,还是先慢下来 / 先停。
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null || settled}
          onClick={() => run('cut')}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium text-me-charcoal hover:bg-me-stone/50 disabled:opacity-50"
        >
          {busy === 'cut' ? '正在改…' : '预算降 20%'}
        </button>
        <button
          type="button"
          disabled={busy !== null || settled}
          onClick={() => run('pause')}
          className="min-h-11 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-medium text-me-charcoal hover:bg-me-stone/50 disabled:opacity-50"
        >
          {busy === 'pause' ? '正在停…' : '先全停'}
        </button>
        <button
          type="button"
          disabled={busy !== null || settled}
          onClick={() => { setSettled(true); setResult({ kind: 'ok', text: '好,先不动。这条继续按原速跑,明天体检还会看它。' }) }}
          className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          先不动
        </button>
      </div>
      {result && (
        <p className={`mt-2 text-xs whitespace-pre-line ${result.kind === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>
          {result.text}
        </p>
      )}
    </div>
  )
}

function CampaignCard({ clientId, c, playbook }: { clientId: string; c: CampaignNarrative; playbook: AdsPlaybook }) {
  const meta = VERDICT_META[c.verdict]
  // Cost per lead is always derivable from the 7-day aggregates when there are
  // results — show it directly so the PM doesn't have to divide in their head.
  const cpl = c.latest_results_7d > 0 ? c.latest_spend_7d / c.latest_results_7d : null

  return (
    <div className={`rounded-xl border p-4 ${meta.tint}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${meta.dot}`} />
          <span className="font-medium text-gray-800 truncate" title={c.campaign_name}>
            {c.campaign_name}
          </span>
        </div>
        <span className={`text-sm font-semibold shrink-0 ${meta.text}`}>{meta.label}</span>
      </div>

      <p className="mt-2 text-sm text-gray-600">{c.headline}</p>

      <CtrStrip series={c.ctr_series} />

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-400">
        <span>近 7 天花费 <span className="text-gray-600 tabular-nums">${c.latest_spend_7d.toFixed(0)}</span></span>
        <span>近 7 天{playbook.resultNoun} <span className="text-gray-600 tabular-nums">{c.latest_results_7d}</span></span>
        {/* Labelled 实付 on purpose: this is total spend ÷ total results, i.e.
            what was actually paid. The headline above compares a TYPICAL DAY
            (median of daily costs, which resists one freak day skewing the
            verdict), so the two numbers differ legitimately — without the label
            they read as a contradiction and cost the page its credibility. */}
        {cpl != null && (
          <span>实付{playbook.costPerResultLabel} <span className="text-gray-600 tabular-nums">${cpl.toFixed(1)}</span></span>
        )}
        {c.frequency_7d != null && (
          <span>看腻程度 <span className="text-gray-600 tabular-nums">{c.frequency_7d.toFixed(2)}</span>（1 以下算正常，越高越腻）</span>
        )}
      </div>

      {/* Money first, creative second (板桥): the stop-loss decision needs no
          creative supply and takes effect immediately, so it must not sit below
          a prescription that may have nothing to give. */}
      {(c.verdict === 'alert' || c.verdict === 'watch') && (
        <>
          <StopLossBlock clientId={clientId} c={c} playbook={playbook} />
          <PrescriptionBlock clientId={clientId} c={c} />
        </>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function AdsHealthPageHeader({
  clientId,
  insightDate,
}: {
  clientId: string
  insightDate?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="text-sm text-me-charcoal/45 hover:text-me-charcoal/70"
        >
          ← 返回客户
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-me-charcoal md:text-3xl">
          广告健康
        </h1>
        <p className="mt-1 max-w-xl text-sm text-me-charcoal/55">
          先看现在花得怎么样、有没有要你点头的事，其余往下翻。
        </p>
      </div>
      {insightDate ? (
        <p className="shrink-0 text-xs text-me-charcoal/45 sm:text-right">
          {fmtDataUpdatedLine(insightDate)}
        </p>
      ) : null}
    </div>
  )
}

function TabBar({ tab, onChange }: { tab: PageTab; onChange: (t: PageTab) => void }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-me-stone">
      {PAGE_TABS.map(item => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          title={item.hint}
          className={`-mb-px min-h-11 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            tab === item.key
              ? 'border-me-ochre text-me-charcoal'
              : 'border-transparent text-me-charcoal/45 hover:text-me-charcoal/70'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default function AdsHealthPage() {
  const params = useParams()
  const clientId = params.id as string
  const searchParams = useSearchParams()

  const [data, setData] = useState<AdHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * 初值从网址 `?tab=` 取；待办 deep link 和合并卡链接会改 query，
   * 需要跟着 searchParams 同步标签（不只 mount 读一次）。
   */
  const [tab, setTab] = useState<PageTab>(() => tabFromQuery(searchParams.get('tab')))

  useEffect(() => {
    setTab(tabFromQuery(searchParams.get('tab')))
  }, [searchParams])

  const [nextStepRefreshKey, setNextStepRefreshKey] = useState(0)
  const [confirmCardCount, setConfirmCardCount] = useState(0)
  const bumpNextStepCard = useCallback(() => {
    setNextStepRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/clients/${clientId}/ad-health`)
      .then(r => r.json())
      .then((json: AdHealthResponse & { error?: string }) => {
        if (!alive) return
        if (json.error) setError(json.error)
        else setData(json)
      })
      .catch(() => alive && setError('加载失败'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [clientId])

  const latest = data?.latest
  const overall = latest?.overall_verdict ?? 'insufficient_history'
  const overallMeta = VERDICT_META[overall]
  const playbook = resolveAdsPlaybook(data?.industry ?? null)

  const campaigns = latest ? [...latest.payload.campaigns].sort((a, b) => VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict]) : []
  const live = campaigns.filter(c => c.verdict !== 'paused')
  const stopped = campaigns.filter(c => c.verdict === 'paused')

  return (
    <div className="mx-auto max-w-5xl bg-me-ivory px-4 py-6 md:py-8">
      <AdsHealthPageHeader clientId={clientId} insightDate={latest?.insight_date} />

      <TabBar tab={tab} onChange={setTab} />

      {tab === 'today' && (
        <AdsHealthTodayTab
          clientId={clientId}
          loading={loading}
          error={error}
          playbook={playbook}
          growth={data?.growth}
          todayCrmLeads={data?.today_crm_leads}
          campaigns={latest?.payload.campaigns ?? []}
          liveCampaigns={live}
          overallHeadline={latest?.headline ?? null}
          insightDate={latest?.insight_date ?? null}
          evaluated={latest?.payload.evaluated ?? 0}
          scorecard={data?.growth && !('viewer' in data.growth) ? data.growth.payload?.scorecard : undefined}
          refreshKey={nextStepRefreshKey}
          confirmCardCount={confirmCardCount}
          onConfirmCardCount={setConfirmCardCount}
          overallTint={overallMeta.tint}
          overallDot={overallMeta.dot}
          overallText={overallMeta.text}
        />
      )}

      {tab === 'ads' && (
        <>
          <LiveTodayPanel clientId={clientId} part="new" />
          <EntityTreePanel clientId={clientId} />
          {loading && <div className="text-gray-400 text-sm py-12 text-center">加载中…</div>}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">加载出错:{error}</div>
          )}
          {!loading && !error && !latest && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">广告数据还在积累中。</div>
          )}
          {!loading && !error && latest && (
            <>
              {/* 最差的排最前：引擎已排序，这里再排一次兜底，免得坏的被健康的盖住 */}
              <div className="grid gap-3 md:grid-cols-2">
                {live.map(c => (
                  <CampaignCard key={c.campaign_id} clientId={clientId} c={c} playbook={playbook} />
                ))}
              </div>
              {live.length === 0 && <p className="text-sm text-gray-500">现在没有在投的广告。</p>}
              {stopped.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gray-500">已停投的 {stopped.length} 条（点开看）</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {stopped.map(c => (
                      <CampaignCard key={c.campaign_id} clientId={clientId} c={c} playbook={playbook} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </>
      )}

      {tab === 'winners' && <CurrentWinnerPanel clientId={clientId} />}

      {tab === 'breakdown' && <BreakdownPanel clientId={clientId} />}

      {/*
        「等你点头」标签 —— 这个客户等人点头的广告动作，就在这一页批
        （设计稿 `docs/specs/2026-10-18-ads-door-merge-design-v0.1.md` §5 步 1/2）。

        🔴 **这个标签就在批准链路上**：它取待批准列表、渲染「批准（立刻暂停）」按钮，
        点下去直接走 `POST .../ad-health/auto-pause/[runId]/decision`。
        改这一块等于改批准入口 —— 要过「请求的网址、方法、请求体一个字没变」那道审查。
        （第一步只立了门牌、不取数据；那句话从第二步搬进真内容起就不成立了。）

        介绍文案在面板自己里头，这里不要再写一遍（两段同话会在屏幕上出现两遍）。
      */}
      {tab === 'approvals' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400">
            通用审批页对这类动作只签字、不执行（那边是批不了的），要批就在这里。
          </p>
          {/* 从旧的专属页整段搬来；两个接口的网址、方法、请求体一个字没动。 */}
          <AutoPausePanel clientId={clientId} onPendingAdsChanged={bumpNextStepCard} />
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-6">
          {!loading && !error && (
            <GrowthPanel
              state={data ? data.growth : undefined}
              clientId={clientId}
              onPendingAdsChanged={bumpNextStepCard}
            />
          )}
          <AutonomySettings clientId={clientId} />
        </div>
      )}

      <p className="mt-8 text-center text-xs text-me-charcoal/35">
        所有判断由系统每天自动生成 · 数字直接来自广告平台，可自行核对
      </p>
    </div>
  )
}
