'use client'

/**
 * /dashboard/today — 今日待办 (22.E.S18 前置 · 滚动排班).
 *
 * The in-ME home of the PM's rolling to-do: today's pillar theme + live
 * counts with deep links. Reads GET /api/workbench/today — the same lib the
 * pm-daily-todo email renders, so inbox and dashboard never disagree.
 *
 * First brick of the "一条待办流" product surface (2026-07-28 拍板):
 * today it serves the PM; the data shape is per-client so FDE / client-boss
 * filtered views can layer on top later (四视角).
 */

import { useState, useEffect, useCallback } from 'react'

/**
 * 跟 `src/lib/pm-todo/daily-todo.ts` 的 TodoView 同形状。这里是客户端组件，
 * 不能直接 import 那个文件（它会把服务端的取数模块一起拖进浏览器，整页会崩），
 * 所以在这里照抄一份类型。
 */
interface TodoRow {
  pm_kind: string
  kind: string
  client_id: string
  client_name: string
  what: string
  how: string
  href: string
  action_label: string
  count: number
  samples: string[]
}

interface TodoSection {
  pm_kind: string
  emoji: string
  title: string
  rows: TodoRow[]
}

interface TodayPayload {
  weekday: number
  weekday_label: string
  theme: { title: string; hint: string } | null
  nz_date: string
  view: {
    sections: TodoSection[]
    totalItems: number
    blindSpots: string[]
  }
  routed_note: string
  /** 有开发欠账时给链接，没有时是 null。 */
  dev_debt_url: string | null
}

interface ReconciliationCluster {
  rootCauseKey: string
  clientName: string | null
  label: string
  occurrenceCount: number
  reason: string
}

interface ReconciliationSuppressedGroup {
  reason: string
  count: number
  sample: string
}

interface ReconciliationPreviewPayload {
  fixture: string
  before: number
  after: number
  unresolvedClusters: ReconciliationCluster[]
  suppressed: ReconciliationSuppressedGroup[]
}

type ReconciliationState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; data: ReconciliationPreviewPayload }

type PageState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: TodayPayload }

function SectionCard({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-black text-slate-800">
        {emoji} {title}
      </p>
      {children}
    </div>
  )
}

const REASON_LABEL: Record<string, string> = {
  GENUINE_UNRESOLVED: '真实未解决',
  HUMAN_DECISION_REQUIRED: '需要人工决策',
  CHECK_FAILED_UNRESOLVED: '核实失败（保留可见）',
  INTENTIONAL_STATE: '系统故意状态（非问题）',
  NOT_YET_DUE: '太新，还不到检查时间',
  CONNECTOR_ALREADY_CONNECTED: '其实已连接（误报）',
  DUPLICATE_WORK_ITEM: '和别处重复计数',
  TERMINAL_COMPLETED: '已经结束，只是没摘下来',
  AUTO_EXECUTABLE_NOT_HUMAN_WORK: '系统能自己做，不该算人工活',
}

/**
 * #1169 WP1 — reconciliation preview. Runs on the FROZEN audited-280
 * fixture, not live data (see the route's own comment): this proves the
 * reconciliation logic before it is wired to the real counts above.
 */
function ReconciliationPreviewCard({ state }: { state: ReconciliationState }) {
  if (state.phase === 'loading') {
    return <div className="mb-6 text-xs text-slate-400">加载 Todo Reconciliation 预览…</div>
  }
  if (state.phase === 'error') {
    return null
  }

  const { data } = state
  const suppressedSorted = [...data.suppressed].sort((a, b) => b.count - a.count)
  const clustersSorted = [...data.unresolvedClusters].sort((a, b) => b.occurrenceCount - a.occurrenceCount)

  return (
    <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50 p-4">
      <p className="mb-1 text-sm font-black text-violet-900">
        🧮 Todo Reconciliation Gate 预览（#1169 WP1 · 基于冻结审计样本，非实时数据）
      </p>
      <p className="mb-3 text-xs text-violet-700">
        原始记录 <b>{data.before}</b> 条 → 去重合并后真正未解决 <b>{data.after}</b> 组
        （被抑制 {data.suppressed.reduce((s, g) => s + g.count, 0)} 条，每条都带原因码，不会静默消失）
      </p>

      <p className="mb-1 text-xs font-bold text-violet-800">未解决（{clustersSorted.length} 组）</p>
      <div className="mb-3 space-y-1">
        {clustersSorted.slice(0, 8).map((c) => (
          <div key={c.rootCauseKey} className="flex items-center justify-between text-xs text-slate-700">
            <span className="truncate">
              {c.clientName ? `${c.clientName} · ` : ''}
              {c.label}
              {c.occurrenceCount > 1 ? ` ×${c.occurrenceCount}` : ''}
            </span>
            <span className="ml-2 shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-violet-700">
              {REASON_LABEL[c.reason] ?? c.reason}
            </span>
          </div>
        ))}
        {clustersSorted.length > 8 && (
          <p className="text-[11px] text-violet-500">还有 {clustersSorted.length - 8} 组未展示…</p>
        )}
      </div>

      <p className="mb-1 text-xs font-bold text-violet-800">被抑制的原因分布</p>
      <div className="flex flex-wrap gap-1.5">
        {suppressedSorted.map((g) => (
          <span
            key={g.reason}
            title={g.sample}
            className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600"
          >
            {REASON_LABEL[g.reason] ?? g.reason} × {g.count}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function TodayPage() {
  const [state, setState] = useState<PageState>({ phase: 'loading' })
  const [reconciliation, setReconciliation] = useState<ReconciliationState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch('/api/workbench/today')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as TodayPayload
      setState({ phase: 'ready', data })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  const loadReconciliation = useCallback(async () => {
    setReconciliation({ phase: 'loading' })
    try {
      const res = await fetch('/api/workbench/today/reconciliation-preview')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as ReconciliationPreviewPayload
      setReconciliation({ phase: 'ready', data })
    } catch {
      setReconciliation({ phase: 'error' })
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadReconciliation() }, [loadReconciliation])

  if (state.phase === 'loading') {
    return <div className="p-8 text-sm text-slate-400">加载今日待办...</div>
  }

  if (state.phase === 'error') {
    return (
      <div className="p-8">
        <p className="text-sm font-bold text-red-700">加载失败：{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { data } = state
  const { sections, totalItems } = data.view

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-black text-slate-900">
          📋 今日待办 · {data.weekday_label} {data.nz_date}
          {totalItems > 0 ? ` · ${totalItems} 件` : ''}
        </h1>
        {data.theme && (
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-bold text-slate-700">{data.theme.title}</span>
            {data.theme.hint ? ` — ${data.theme.hint}` : ''}
          </p>
        )}
      </div>

      <ReconciliationPreviewCard state={reconciliation} />

      {data.view.blindSpots.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          {data.view.blindSpots.map((b) => (
            <p key={b} className="text-xs text-amber-800">⚠️ 今天没查成：{b}</p>
          ))}
        </div>
      )}

      {totalItems === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm font-bold text-emerald-700">
          今天没有待办 ✅ 没有要你做的事。
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((sec) => (
            <SectionCard key={sec.pm_kind} emoji={sec.emoji} title={sec.title}>
              {sec.rows.map((r, i) => (
                <div key={`${r.kind}-${r.client_id}-${i}`} className="border-b border-slate-100 py-2 last:border-b-0">
                  <p className="text-sm text-slate-800">
                    <span className="font-bold">{r.client_name}</span>：{r.what}
                  </p>
                  {r.samples.length > 0 && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      另外几条：{r.samples.join('；')}{r.count - 1 > r.samples.length ? ' …' : ''}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    {r.how ? <span>→ {r.how}</span> : null}
                    {/* 🔴 没有 href = 这条现在**没有地方可点**（比如入口还没上线）。
                        这时绝不能照样渲染一个按钮 —— 一个点了没反应的按钮比没有按钮更糟。
                        外部授权页必须整页导航，所以一律用 <a>，不用 next/link。 */}
                    {r.href ? (
                      <a
                        href={r.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1 text-xs font-bold text-white hover:bg-cyan-700"
                      >
                        {r.action_label}
                      </a>
                    ) : null}
                  </p>
                </div>
              ))}
            </SectionCard>
          ))}
        </div>
      )}

      {data.routed_note ? (
        <p className="mt-4 text-xs text-slate-500">
          {data.routed_note}
          {data.dev_debt_url ? (
            <>
              {' '}
              <a href={data.dev_debt_url} className="text-cyan-700 underline">开发欠账清单</a>
            </>
          ) : null}
        </p>
      ) : null}

      <p className="mt-6 text-xs text-slate-400">
        每个工作日早上这份清单也会发到你的邮箱，内容跟这里一模一样。只列五类要你做的事：拍板、点一次、转给客户、发前看一眼、认真假。办完自动消失。
      </p>
    </div>
  )
}
