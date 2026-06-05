'use client'

/**
 * Phase 31 M2 — Goal detail page (minimal version)
 * URL: /dashboard/clients/[id]/goal/[goalId]
 *
 * 本页展示单个 Goal 的详情 + Activate/Archive 控制。
 * M3 将在此基础上扩展 "Initiative 列表 + AI 参谋面板"。
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import type { GoalRow } from '@/types/strategy'
import { normalizeGoalRow } from '@/lib/strategy/normalize'
import { InitiativeList } from './_components/InitiativeList'
import { BacklogMigrator } from './_components/BacklogMigrator'
import { VerdictPanel } from './_components/VerdictPanel'
import { ExecutionSummaryBar } from './_components/ExecutionSummaryBar'
import { CurrentValueCell } from './_components/CurrentValueCell'
import type { GoalExecutionSummary } from '@/lib/strategy/initiatives'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function daysBetween(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000)
}

function progressPct(baseline: number, target: number, current: number): number {
  if (target === baseline) return 0
  const pct = ((current - baseline) / (target - baseline)) * 100
  return Math.max(0, Math.min(100, pct))
}

export function GoalDetailClient() {
  const router = useRouter()
  const params = useParams<{ id: string; goalId: string }>()
  const { id: clientId, goalId } = params

  const [goal, setGoal] = useState<GoalRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Phase 33 M4: shared execution summary so the bar + per-Initiative cards
  // render off the same fetch.
  const [execSummary, setExecSummary] = useState<GoalExecutionSummary | null>(null)
  const [execRefreshKey, setExecRefreshKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/goals/${goalId}`)
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to load goal')
        return
      }
      const j = await res.json()
      // B7 fix: normalize NUMERIC strings to numbers
      setGoal(j.goal ? normalizeGoalRow(j.goal) : null)
    } finally {
      setLoading(false)
    }
  }, [goalId])

  useEffect(() => { load() }, [load])

  async function activate() {
    if (!confirm('Activate this goal? Client will see it on the dashboard.')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/goals/${goalId}/activate`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json()
        alert(`Activate failed: ${j.error}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    if (!confirm('Archive this goal? You can no longer activate it.')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/goals/${goalId}/archive`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json()
        alert(`Archive failed: ${j.error}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function deleteDraft() {
    if (!confirm('Delete this draft goal permanently?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/goals/${goalId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json()
        alert(`Delete failed: ${j.error}`)
        return
      }
      router.push(`/dashboard/clients/${clientId}`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f6f7f2] p-8 text-sm font-semibold text-me-charcoal/55">Loading…</div>
  )
  if (error) return (
    <div className="min-h-screen bg-[#f6f7f2] p-8 text-sm font-semibold text-status-rej">{error}</div>
  )
  if (!goal) return (
    <div className="min-h-screen bg-[#f6f7f2] p-8 text-sm font-semibold text-me-charcoal/55">Goal not found</div>
  )

  const periodDays = daysBetween(goal.period_start, goal.period_end)
  const daysElapsed = Math.max(0, daysBetween(goal.period_start, new Date().toISOString().slice(0, 10)))
  const daysRemaining = Math.max(0, periodDays - daysElapsed)

  return (
    <div className="min-h-screen bg-[#f6f7f2] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="text-xs font-black text-me-charcoal/45 hover:text-me-charcoal/75"
            >
              ← 返回客户主页
            </Link>
            <h1 className="mt-2 flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-me-charcoal">
              {goal.title}
              {goal.is_beta && (
                <span className="rounded-full bg-me-ochre/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-me-ochre">
                  Beta
                </span>
              )}
              <StatusBadge status={goal.status} verdict={goal.verdict} />
            </h1>
            <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
              {goal.intent === 'acquisition' && '🎯 Acquisition'}
              {goal.intent === 'sales' && '💰 Sales'}
              {goal.intent === 'awareness' && '📢 Awareness'}
              {goal.awareness_subtype && ` · ${goal.awareness_subtype.replace(/_/g, ' ')}`}
            </p>
          </div>

          <div className="flex gap-2">
            {goal.status === 'draft' && goal.title !== '[Migration] Unassigned Backlog' && (
              <>
                <button
                  onClick={activate}
                  disabled={busy}
                  className="rounded-lg bg-status-track px-4 py-2 text-sm font-black text-white transition-colors hover:bg-status-track/90 disabled:opacity-50"
                >
                  Activate Goal
                </button>
                <button
                  onClick={deleteDraft}
                  disabled={busy}
                  className="rounded-lg border border-status-rej/30 bg-white px-4 py-2 text-sm font-black text-status-rej transition-colors hover:bg-status-rej/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </>
            )}
            {goal.status === 'active' && (
              <button
                onClick={archive}
                disabled={busy}
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-black text-me-charcoal/75 transition-colors hover:border-black/15 hover:text-me-charcoal disabled:opacity-50"
              >
                Archive
              </button>
            )}
          </div>
        </div>

        {/* Primary metric card (P32: direction-aware) */}
        <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">Primary Metric</div>
            {goal.target_direction === 'decrease' && (
              <span className="rounded-full bg-status-sched/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-status-sched">
                ↓ Decrease (清仓型)
              </span>
            )}
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-me-charcoal">
            {goal.primary_metric_label}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-[11px] font-black uppercase text-me-charcoal/45">
                {goal.target_direction === 'decrease' ? '起始库存' : 'Baseline'}
              </div>
              <div className="text-lg font-bold text-me-charcoal/75">
                {goal.baseline_value.toLocaleString()}
              </div>
              <div className="text-[10px] font-semibold text-me-charcoal/45">{goal.primary_metric_unit}</div>
            </div>
            {/* A2.1 — auto-fetched current value (or "—" for self_report metrics) */}
            <CurrentValueCell goal={goal} />
            <div>
              <div className="text-[11px] font-black uppercase text-me-charcoal/45">
                {goal.target_direction === 'decrease' ? '清空目标' : 'Target'}
              </div>
              <div className="text-lg font-bold text-status-track">
                {goal.target_value.toLocaleString()}
              </div>
              <div className="text-[10px] font-semibold text-me-charcoal/45">{goal.primary_metric_unit}</div>
            </div>
            <div>
              <div className="text-[11px] font-black uppercase text-me-charcoal/45">
                {goal.target_direction === 'decrease' ? 'Reduction' : 'Growth'}
              </div>
              <div className="text-lg font-bold text-me-ochre">
                {(() => {
                  const b = goal.baseline_value
                  const t = goal.target_value
                  // B4 fix: baseline=0 → "From zero" (e.g. product launch signups 0→30)
                  if (b === 0) return 'From zero'
                  const pct = goal.target_direction === 'decrease'
                    ? (1 - t / b) * 100
                    : (t / b - 1) * 100
                  if (!Number.isFinite(pct)) return '—'
                  return `${pct.toFixed(0)}%`
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Period + budget */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">Period</div>
            <div className="mt-2 text-sm font-semibold text-me-charcoal">
              {formatDate(goal.period_start)} → {formatDate(goal.period_end)}
            </div>
            <div className="mt-1 text-xs font-semibold text-me-charcoal/55">
              {periodDays} days total · {(() => {
                // B11 fix: status-aware period label
                switch (goal.status) {
                  case 'draft':
                    return 'not started yet'
                  case 'active':
                    return `${daysRemaining} days remaining`
                  case 'expired':
                    return 'period ended · awaiting verdict'
                  case 'archived':
                    return goal.verdict_at
                      ? `archived ${formatDate(goal.verdict_at.slice(0, 10))}`
                      : 'archived'
                  default:
                    return goal.status
                }
              })()}
            </div>
          </div>
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">Budget</div>
            <div className="mt-2 text-sm font-semibold text-me-charcoal">
              {goal.budget_amount
                ? `${goal.budget_currency} ${goal.budget_amount.toLocaleString()}`
                : <span className="text-me-charcoal/45">— not set</span>}
            </div>
          </div>
        </div>

        {/* FDE reasoning */}
        {goal.fde_reasoning && (
          <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">FDE Reasoning</div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-me-charcoal/80">{goal.fde_reasoning}</p>
          </div>
        )}

        {/* Verdict panel (M4) — visible for active/expired/archived */}
        <VerdictPanel goal={goal} onJudged={load} />

      {/* Phase 33 M4: Goal-level execution summary bar (P33.12) */}
      <ExecutionSummaryBar
        goalId={goalId}
        refreshKey={execRefreshKey}
        onLoaded={setExecSummary}
      />

        {/* Initiatives (M3) */}
        <InitiativeList
        goal={goal}
        canEdit={goal.status === 'draft' || goal.status === 'active'}
        executionSummaries={execSummary?.perInitiative}
        onExecutionChanged={() => setExecRefreshKey(k => k + 1)}
      />

        {/* Backlog migrator (M3.5) — only shows if client has unassigned actions */}
        {goal.title !== '[Migration] Unassigned Backlog' && (
          <BacklogMigrator clientId={clientId} goal={goal} />
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status, verdict }: { status: string; verdict: string | null }) {
  const colorMap: Record<string, string> = {
    draft:    'bg-me-ivory text-me-charcoal/55',
    active:   'bg-me-ochre/15 text-me-ochre',
    expired:  'bg-status-exec/15 text-status-exec',
    archived: 'bg-me-stone text-me-charcoal/45',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${colorMap[status] ?? 'bg-me-ivory text-me-charcoal/55'}`}>
      {status}{verdict ? ` · ${verdict}` : ''}
    </span>
  )
}
