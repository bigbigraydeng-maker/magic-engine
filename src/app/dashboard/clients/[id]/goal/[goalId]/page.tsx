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
import { InitiativeList } from './_components/InitiativeList'
import { BacklogMigrator } from './_components/BacklogMigrator'
import { VerdictPanel } from './_components/VerdictPanel'

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

export default function GoalDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string; goalId: string }>()
  const { id: clientId, goalId } = params

  const [goal, setGoal] = useState<GoalRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
      setGoal(j.goal)
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

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading…</div>
  if (error) return <div className="p-8 text-sm text-red-400">{error}</div>
  if (!goal) return <div className="p-8 text-sm text-slate-500">Goal not found</div>

  const periodDays = daysBetween(goal.period_start, goal.period_end)
  const daysElapsed = Math.max(0, daysBetween(goal.period_start, new Date().toISOString().slice(0, 10)))
  const daysRemaining = Math.max(0, periodDays - daysElapsed)

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            ← Back to client
          </Link>
          <h1 className="mt-2 text-xl font-bold text-white flex items-center gap-2">
            {goal.title}
            {goal.is_beta && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 uppercase">
                Beta
              </span>
            )}
            <StatusBadge status={goal.status} verdict={goal.verdict} />
          </h1>
          <p className="mt-1 text-sm text-slate-400">
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
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
              >
                Activate Goal
              </button>
              <button
                onClick={deleteDraft}
                disabled={busy}
                className="rounded-lg border border-red-500/30 hover:bg-red-500/10 disabled:opacity-50 px-4 py-2 text-sm text-red-400"
              >
                Delete
              </button>
            </>
          )}
          {goal.status === 'active' && (
            <button
              onClick={archive}
              disabled={busy}
              className="rounded-lg border border-white/10 hover:bg-white/[0.04] disabled:opacity-50 px-4 py-2 text-sm text-slate-300"
            >
              Archive
            </button>
          )}
        </div>
      </div>

      {/* Primary metric card */}
      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-6">
        <div className="text-xs text-slate-500 uppercase tracking-wide">Primary Metric</div>
        <div className="mt-2 text-2xl font-bold text-white">
          {goal.primary_metric_label}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[11px] text-slate-500 uppercase">Baseline</div>
            <div className="text-lg font-semibold text-slate-300">
              {goal.baseline_value.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-600">{goal.primary_metric_unit}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 uppercase">Target</div>
            <div className="text-lg font-semibold text-emerald-400">
              {goal.target_value.toLocaleString()}
            </div>
            <div className="text-[10px] text-slate-600">{goal.primary_metric_unit}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 uppercase">Growth</div>
            <div className="text-lg font-semibold text-blue-400">
              {(((goal.target_value / goal.baseline_value) - 1) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* Period + budget */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Period</div>
          <div className="mt-2 text-sm text-white">
            {formatDate(goal.period_start)} → {formatDate(goal.period_end)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {periodDays} days total · {goal.status === 'active' ? `${daysRemaining} remaining` : 'not started'}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Budget</div>
          <div className="mt-2 text-sm text-white">
            {goal.budget_amount
              ? `${goal.budget_currency} ${goal.budget_amount.toLocaleString()}`
              : <span className="text-slate-500">— not set</span>}
          </div>
        </div>
      </div>

      {/* FDE reasoning */}
      {goal.fde_reasoning && (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
          <div className="text-xs text-slate-500 uppercase tracking-wide">FDE Reasoning</div>
          <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{goal.fde_reasoning}</p>
        </div>
      )}

      {/* Verdict panel (M4) — visible for active/expired/archived */}
      <VerdictPanel goal={goal} onJudged={load} />

      {/* Initiatives (M3) */}
      <InitiativeList goal={goal} canEdit={goal.status === 'draft' || goal.status === 'active'} />

      {/* Backlog migrator (M3.5) — only shows if client has unassigned actions */}
      {goal.title !== '[Migration] Unassigned Backlog' && (
        <BacklogMigrator clientId={clientId} goal={goal} />
      )}
    </div>
  )
}

function StatusBadge({ status, verdict }: { status: string; verdict: string | null }) {
  const colorMap: Record<string, string> = {
    draft:    'bg-slate-500/20 text-slate-400',
    active:   'bg-blue-500/20 text-blue-300',
    expired:  'bg-amber-500/20 text-amber-300',
    archived: 'bg-slate-700/40 text-slate-500',
  }
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colorMap[status] ?? 'bg-slate-500/20 text-slate-400'}`}>
      {status}{verdict ? ` · ${verdict}` : ''}
    </span>
  )
}
