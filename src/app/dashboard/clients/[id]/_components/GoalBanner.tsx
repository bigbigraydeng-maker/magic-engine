'use client'

/**
 * Phase 31 M2 + Phase 32 — Active Goal banner for client header.
 *
 * Phase 32: supports multiple active Goals per client. When > 1, shows a stack
 * with a "+N more" indicator. Otherwise shows the single Goal full-width.
 *
 * Designed to be inserted into src/app/dashboard/clients/[id]/page.tsx
 * with minimal surgery — no breaking changes to the existing layout.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { GoalRow } from '@/types/strategy'
import { normalizeGoalList } from '@/lib/strategy/normalize'

interface Props {
  clientId: string
}

function daysRemaining(endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - Date.now()) / 86_400_000))
}

function intentEmoji(g: GoalRow): string {
  return g.intent === 'acquisition' ? '🎯' : g.intent === 'sales' ? '💰' : '📢'
}

export function GoalBanner({ clientId }: Props) {
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/goals/active-list`)
      .then(r => r.ok ? r.json() : Promise.reject())
      // B7 fix: normalize NUMERIC strings to numbers
      .then(j => setGoals(normalizeGoalList(j.goals ?? [])))
      .catch(() => setGoals([]))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return <div className="mb-4 h-[68px] rounded-xl border border-black/10 bg-white p-4 shadow-sm" />
  }

  // No active goal: show CTA
  if (goals.length === 0) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl border border-dashed border-black/15 bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">No active goal</div>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            Set a Goal to align all execution. Phase 32: 多 Goal 并行支持 (清仓 / 团报名 / 月营收持续).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}/goals/history`}
            className="text-xs font-black text-me-charcoal/55 hover:text-me-charcoal"
          >
            View History
          </Link>
          <Link
            href={`/dashboard/clients/${clientId}/goal/new`}
            className="rounded-lg bg-me-ochre px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre/90"
          >
            + New Goal
            <span className="ml-2 inline-block rounded-full bg-white/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
              Beta
            </span>
          </Link>
        </div>
      </div>
    )
  }

  // Single active goal — original full-width banner
  if (goals.length === 1) {
    return <SingleGoalRow clientId={clientId} goal={goals[0]} showHistory />
  }

  // Multiple active goals — stacked compact view + + New Goal button
  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
          {goals.length} Active Goals
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}/goals/history`}
            className="text-xs font-black text-me-charcoal/55 hover:text-me-charcoal"
          >
            History
          </Link>
          <Link
            href={`/dashboard/clients/${clientId}/goal/new`}
            className="rounded-lg bg-me-ochre px-3 py-1.5 text-xs font-black text-white transition-colors hover:bg-me-ochre/90"
          >
            + New Goal
          </Link>
        </div>
      </div>
      <div className="space-y-2">
        {goals.map(g => <SingleGoalRow key={g.id} clientId={clientId} goal={g} compact />)}
      </div>
    </div>
  )
}

// ─── One Goal row ────────────────────────────────────────────────────────────

function SingleGoalRow({
  clientId, goal, compact, showHistory,
}: {
  clientId: string
  goal: GoalRow
  compact?: boolean
  showHistory?: boolean
}) {
  const remaining = daysRemaining(goal.period_end)
  const isDecrease = goal.target_direction === 'decrease'
  const arrow = isDecrease ? '↓' : '→'

  return (
    <Link
      href={`/dashboard/clients/${clientId}/goal/${goal.id}`}
      className={`block rounded-xl border border-me-ochre/30 bg-me-ochre/10 transition-colors hover:bg-me-ochre/15 ${
        compact ? 'p-3' : 'mb-4 p-4'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={compact ? 'text-base' : 'text-lg'}>{intentEmoji(goal)}</span>
            <h3 className="text-sm font-black text-me-charcoal">{goal.title}</h3>
            {goal.is_beta && (
              <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-me-ochre">
                Beta
              </span>
            )}
            {isDecrease && (
              <span className="rounded-full bg-status-sched/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-status-sched">
                ↓ Decrease
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
            {goal.primary_metric_label}:&nbsp;
            <span className="font-bold text-me-charcoal/80">
              {goal.baseline_value.toLocaleString()} {arrow} {goal.target_value.toLocaleString()}
            </span>
            <span className="mx-2 text-me-charcoal/30">·</span>
            <span className="font-bold text-me-ochre">{remaining} days remaining</span>
          </p>
        </div>
        {showHistory && (
          <span className="shrink-0 text-xs font-black text-me-charcoal/55">
            History →
          </span>
        )}
      </div>
    </Link>
  )
}
