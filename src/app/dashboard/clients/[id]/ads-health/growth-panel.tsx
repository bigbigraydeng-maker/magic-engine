'use client'

/**
 * 经营视图（spec 2026-09-24 §3 G12）。卫青每天写的那一行 `ads_growth_states` 的读侧。
 *
 * 跟下面的体检卡片分工：体检回答「每条广告跟自己比怎么样」，这一段回答
 * 「目标追不追得上、今天有哪些要看的事、哪里还有空间」。全部只读。
 *
 * 🔴 三种「没有数字」必须分开显示，不能都渲染成 0 或空白：
 *    读不到（接口出错）· 今天还没巡察（没有行）· 判不了（数据不全 / 归属缺失）。
 * 🔴 客户账号拿到的是服务端裁剪过的客户版（viewer: 'client'，见 growth-client-view.ts），
 *    只有目标进度和已转成客户话术的单条广告卡片；内部结论（D11、机会等）根本不在响应里。
 */

import React, { useCallback, useEffect, useState } from 'react'
import type { ClientGrowthView } from '@/lib/ads-strategy/agents/growth-client-view'

export type GrowthVerdict = 'on_track' | 'behind' | 'unreachable_within_caps' | 'unknown'

export interface GoalPaceView {
  expectedToDate: number | null
  actualToDate: number | null
  gapPct: number | null
  projectedEnd: number | null
  verdict: GrowthVerdict
  reason: string
}

export interface GrowthFinding {
  code: string
  status: 'hit' | 'not_comparable'
  title: string
  reasons?: string[]
  sample?: Array<{ label: string; value: number }>
  units?: Array<{ id: string; name: string | null }>
  evidence?: Record<string, unknown>
}

export interface GrowthStateView {
  date: string
  /** 目标卡是不是刚读出来的（员工版）；缺省 = 旧接口，按「每日缓存」处理 */
  goal_live?: { live: boolean; readAtIso: string }
  data_completeness: 'complete' | 'partial'
  goal_pace: GoalPaceView | null
  payload: {
    headline?: string
    completenessReasons?: string[]
    problems?: GrowthFinding[]
    opportunities?: GrowthFinding[]
    opportunitiesSkippedReason?: string | null
    problemsSupersededByOpportunities?: number
    goal?: { title: string; label: string; target: number; dayIndex: number; totalDays: number } | null
  } | null
}

const PACE_TONE: Record<GrowthVerdict, { dot: string; text: string; tint: string; label: string }> = {
  on_track:                { dot: 'bg-emerald-500', text: 'text-emerald-700', tint: 'border-emerald-200 bg-emerald-50', label: '按节奏走' },
  behind:                  { dot: 'bg-amber-500',   text: 'text-amber-700',   tint: 'border-amber-200 bg-amber-50',     label: '进度落后' },
  unreachable_within_caps: { dot: 'bg-red-500',     text: 'text-red-700',     tint: 'border-red-200 bg-red-50',         label: '按现在的预算到不了' },
  unknown:                 { dot: 'bg-gray-300',    text: 'text-gray-600',    tint: 'border-gray-200 bg-gray-50',       label: '未判' },
}

/** 客户版：「按现在的预算到不了」带加钱暗示，换成中性说法。 */
const CLIENT_PACE_LABEL: Record<GrowthVerdict, string> = {
  on_track: '按节奏走',
  behind: '进度落后',
  unreachable_within_caps: '按现在的速度可能到不了',
  unknown: '暂时判断不了',
}

function goalLiveNote(meta: GrowthStateView['goal_live']): string | undefined {
  if (!meta) return undefined
  if (!meta.live) return '实时没读到生效中的目标（读取失败或已无目标），这张卡显示的是昨晚的缓存，可能不是最新。'
  const t = new Date(meta.readAtIso)
  if (Number.isNaN(t.getTime())) return '实时读取'
  return `实时读取 · ${t.toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: false })}`
}

type GoalView = { title: string; label: string; target: number; dayIndex: number; totalDays: number }

function GoalBar({ goal, pace, clientView = false, liveNote }: { goal: GoalView | null; pace: GoalPaceView | null; clientView?: boolean; liveNote?: string }) {
  if (!goal || !pace) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        {clientView
          ? '这段时间还没有设定广告目标，设好后这里会显示进度。'
          : '这个客户还没有生效中的目标 —— 设了目标之后，这里会显示「还差多少、来不来得及」。'}
      </div>
    )
  }
  const tone = PACE_TONE[pace.verdict]
  const label = clientView ? CLIENT_PACE_LABEL[pace.verdict] : tone.label
  // 未判时进度条不画：画一条 0% 的条会被读成「一个都没有」。
  const pct = pace.verdict === 'unknown' || pace.actualToDate === null
    ? null
    : Math.max(0, Math.min(100, Math.round((pace.actualToDate / goal.target) * 100)))

  return (
    <div className={`rounded-xl border p-5 ${tone.tint}`}>
      <div className="flex items-center gap-2.5">
        <span className={`inline-block w-3 h-3 rounded-full ${tone.dot}`} />
        <span className={`text-base font-semibold ${tone.text}`}>{goal.title} · {label}</span>
      </div>

      {pct === null ? (
        <p className="mt-2 text-sm text-gray-600">{pace.reason}</p>
      ) : (
        <>
          <div className="mt-3 h-2 w-full rounded-full bg-white/70 overflow-hidden">
            <div className={`h-full ${tone.dot}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-sm text-gray-700">
            目标 {goal.target} {goal.label} · 第 {goal.dayIndex}/{goal.totalDays} 天 · 已到{' '}
            <b>{pace.actualToDate}</b>
            {pace.projectedEnd !== null && <> · 按现在的速度到期约 <b>{pace.projectedEnd}</b></>}
          </p>
          <p className="mt-1 text-xs text-gray-500">{pace.reason}</p>
        </>
      )}
      {liveNote && <p className="mt-2 text-xs text-gray-500">{liveNote}</p>}
    </div>
  )
}

function FindingCard({ f, kind, clientId, cycleDate }: { f: GrowthFinding; kind: 'problem' | 'opportunity'; clientId?: string; cycleDate?: string }) {
  const isHit = f.status === 'hit'
  const tint = !isHit ? 'border-gray-200 bg-gray-50'
    : kind === 'problem' ? 'border-amber-200 bg-amber-50' : 'border-sky-200 bg-sky-50'
  return (
    <div className={`rounded-xl border p-4 ${tint}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono text-gray-500 bg-white/80 border border-gray-200">{f.code}</span>
        <p className="text-sm text-gray-800">{f.title}</p>
      </div>
      {f.units && f.units.length > 0 && (
        <p className="mt-1.5 text-xs text-gray-500">涉及：{f.units.map(u => u.name ?? u.id).join('、')}</p>
      )}
      {f.sample && f.sample.length > 0 && (
        <p className="mt-1 text-xs text-gray-400">样本：{f.sample.map(s => `${s.label} ${s.value}`).join(' · ')}</p>
      )}
      {f.reasons && f.reasons.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">{f.reasons[0]}</p>
      )}
      {kind === 'opportunity' && f.code === 'O1' && clientId && f.units?.map(unit => (
        <O1Approval key={unit.id} clientId={clientId} adsetId={unit.id} cycleDate={cycleDate} o1Evidence={f.evidence ?? {}} />
      ))}
    </div>
  )
}

interface O1Run { id: string; status: string; input: Record<string, unknown>; evidence: Record<string, unknown>; authorization_decision_id: string | null }
function O1Approval({ clientId, adsetId, cycleDate, o1Evidence }: { clientId: string; adsetId: string; cycleDate?: string; o1Evidence: Record<string, unknown> }) {
  const [runs, setRuns] = useState<O1Run[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyReviewed, setHistoryReviewed] = useState(false)
  const endpoint = `/api/clients/${clientId}/ad-health/o1-scale`
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint)
    if (!response.ok) return
    const json = await response.json() as { items?: O1Run[] }
    setRuns(json.items ?? [])
  }, [endpoint])
  useEffect(() => { void refresh() }, [refresh])
  const submit = async () => {
    setBusy(true); setMessage('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adset_id: adsetId }) })
      const json = await response.json() as { error?: string }
      setMessage(response.ok ? '已提交，等待负责人核对并批准。' : json.error ?? '暂时无法提交。')
      await refresh()
    } catch { setMessage('网络暂时不可用，请稍后重试。') }
    finally { setBusy(false) }
  }
  const decide = async (run: O1Run, resolution: 'approve' | 'reject') => {
    if (!run.authorization_decision_id) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`${endpoint}/${run.id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution, expectedDecisionId: run.authorization_decision_id, historyReviewed }) })
      const json = await response.json() as { error?: string }
      setMessage(response.ok ? (resolution === 'approve' ? '已批准，正在排队执行；完成后会记录 Meta 回读结果。' : '已驳回。') : json.error ?? '处理失败。')
      await refresh()
    } catch { setMessage('网络暂时不可用，请稍后重试。') }
    finally { setBusy(false) }
  }
  const related = runs.filter(run => (run.input as { adset_id?: unknown }).adset_id === adsetId
    && (run.evidence as { date?: unknown }).date === cycleDate)
  const pending = related.find(run => run.status === 'pending_approval')
  const active = related.find(run => ['authorized', 'running'].includes(run.status))
  const terminal = related.find(run => ['succeeded', 'denied', 'dead_letter', 'failed', 'superseded'].includes(run.status))
  const evidence = pending?.evidence ?? active?.evidence ?? terminal?.evidence
  const before = evidence?.current_daily_budget_cents
  const after = evidence?.proposed_daily_budget_cents
  const currency = typeof evidence?.currency === 'string' ? evidence.currency : ''
  const budgetTarget = evidence?.target_level === 'campaign' ? '系列' : '广告组'
  const money = (cents: number) => `${currency} ${(cents / 100).toFixed(2)}`.trim()
  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-white p-3 text-xs text-gray-700">
      <p>这是系统建议，不会自动加预算。批准后最多上调 20%，并受客户预算上限约束。</p>
      {typeof before === 'number' && typeof after === 'number' && <p className="mt-1">当前{budgetTarget}日预算 {money(before)} → 建议 {money(after)}</p>}
      {typeof o1Evidence.ctr_by_day === 'string' && <p className="mt-1 text-gray-500">最近三天 CTR：{o1Evidence.ctr_by_day.split('|').join(' / ')}；账户中位数：{String(o1Evidence.median_by_day ?? '—').split('|').join(' / ')}</p>}
      {pending ? (
        <>
          <label className="mt-2 flex gap-2 text-gray-600"><input type="checkbox" checked={historyReviewed} onChange={event => setHistoryReviewed(event.target.checked)} />我已核对更长周期表现和 Meta 变更记录，确认没有近期改动影响这次判断。</label>
          <div className="mt-2 flex gap-2">
          <button disabled={busy || !historyReviewed} onClick={() => void decide(pending, 'approve')} className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-50">批准并排队</button>
          <button disabled={busy} onClick={() => void decide(pending, 'reject')} className="rounded border px-3 py-1.5 disabled:opacity-50">不批准</button>
          </div>
        </>
      ) : active ? <div className="mt-2 flex items-center gap-2"><p>状态：{active.status === 'authorized' ? '已批准，等待执行' : '正在执行'}</p>{active.status === 'authorized' && <button disabled={busy} onClick={() => void decide(active, 'approve')} className="rounded border px-2 py-1 disabled:opacity-50">重新排队</button>}</div>
        : terminal ? <p className="mt-2">本轮处理状态：{terminal.status === 'succeeded' ? '已完成，系统已保存执行和回读记录' : terminal.status === 'denied' ? '已驳回' : '未完成，请先查看这条记录'}</p>
        : <button disabled={busy} onClick={() => void submit()} className="mt-2 rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-50">提交预算建议供审批</button>}
      {message && <p role="status" className="mt-2">{message}</p>}
    </div>
  )
}

function isClientView(state: GrowthStateView | ClientGrowthView): state is ClientGrowthView {
  return 'viewer' in state && state.viewer === 'client'
}

function ClientGrowthPanel({ view }: { view: ClientGrowthView }) {
  const cards = view.adCards
  return (
    <div className="space-y-4">
      <GoalBar goal={view.goal} pace={view.goal_pace} clientView />

      <section>
        {cards ? (
          <>
            <h3 className="mb-1 text-sm font-semibold text-gray-700">{cards.title}</h3>
            <p className="mb-2 text-xs text-gray-500">{cards.intro}</p>
            <div className="space-y-2">
              {cards.cards.map((c, i) => (
                <div key={`${c.adLabel}-${i}`} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs text-gray-500">{c.adLabel}</p>
                  <p className="mt-1 text-sm text-gray-800">{c.headline}</p>
                  <p className="mt-1 text-xs text-gray-600">{c.detail}</p>
                  <p className="mt-1 text-xs text-gray-600">{c.action}</p>
                </div>
              ))}
            </div>
            {cards.promise && <p className="mt-2 text-xs text-gray-500">{cards.promise}</p>}
          </>
        ) : (
          <h3 className="mb-1 text-sm font-semibold text-gray-700">需要留意的广告</h3>
        )}
        {view.adNote && <p className="mt-1 text-xs text-gray-500">{view.adNote}</p>}
      </section>

      <p className="text-xs text-gray-300 text-center">
        数据日期 {view.date}
      </p>
    </div>
  )
}

/**
 * @param state  null = 今天还没巡察过；undefined = 这一段读不到（接口出错）
 */
export default function GrowthPanel({ state, clientId }: { state: GrowthStateView | ClientGrowthView | null | undefined; clientId?: string }) {
  if (state === undefined) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        经营视图这一段读不到，下面的体检结果不受影响。
      </div>
    )
  }
  if (state === null) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        今天的广告检查还没跑完，跑完后这里会显示结果。
      </div>
    )
  }

  if (isClientView(state)) return <ClientGrowthPanel view={state} />

  const problems = (state.payload?.problems ?? []).filter(f => f.status === 'hit')
  const opportunities = (state.payload?.opportunities ?? []).filter(f => f.status === 'hit')
  const partial = state.data_completeness === 'partial'

  return (
    <div className="space-y-4">
      <GoalBar goal={state.payload?.goal ?? null} pace={state.goal_pace} liveNote={goalLiveNote(state.goal_live)} />

      {partial && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">当天数据没拉全，机会没判</p>
          <p className="mt-1 text-xs text-amber-700">
            {state.payload?.opportunitiesSkippedReason ?? '机会判断靠占比和趋势，数据缺一块最容易凭空报出「潜在爆款」，所以这天只看不动。'}
          </p>
          {(state.payload?.completenessReasons ?? []).length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
              {state.payload!.completenessReasons!.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">要看的事（{problems.length}）</h3>
          {problems.length === 0
            ? <p className="text-xs text-gray-400">今天没发现要紧的问题。</p>
            : <div className="space-y-2">{problems.map((f, i) => <FindingCard key={`${f.code}-${i}`} f={f} kind="problem" />)}</div>}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">可以加力的地方（{opportunities.length}）</h3>
          {partial
            ? <p className="text-xs text-gray-400">数据不全，这天没判。</p>
            : opportunities.length === 0
              ? <p className="text-xs text-gray-400">今天没发现明显还有空间的地方。</p>
            : <div className="space-y-2">{opportunities.map((f, i) => <FindingCard key={`${f.code}-${i}`} f={f} kind="opportunity" clientId={clientId} cycleDate={state.date} />)}</div>}
        </section>
      </div>

      {(state.payload?.problemsSupersededByOpportunities ?? 0) > 0 && (
        <p className="text-xs text-gray-400">
          有 {state.payload!.problemsSupersededByOpportunities} 条「钱和结果错配」讲的是右边同一条广告组，
          已合并到右栏显示，避免同一件事在两边各说一遍。
        </p>
      )}

      <p className="text-xs text-gray-300 text-center">
        巡察日期 {state.date} · 只读，系统这一段不改任何广告和预算
      </p>
    </div>
  )
}
