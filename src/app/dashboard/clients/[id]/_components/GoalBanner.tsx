'use client'

/**
 * Phase 31 M2 — Active Goal banner for client header
 *
 * Drops into the client page header. Shows current active goal
 * (if any) with progress placeholder. Otherwise shows "New Goal" CTA.
 *
 * Designed to be inserted into src/app/dashboard/clients/[id]/page.tsx
 * with minimal surgery — no breaking changes to the existing layout.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { GoalRow } from '@/types/strategy'

interface Props {
  clientId: string
}

function daysRemaining(endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - Date.now()) / 86_400_000))
}

export function GoalBanner({ clientId }: Props) {
  const [goal, setGoal] = useState<GoalRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/goals/active`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setGoal(j.goal))
      .catch(() => setGoal(null))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4 mb-4 h-[68px]" />
    )
  }

  // No active goal: show CTA
  if (!goal) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 bg-slate-900/40 p-4 mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">No active goal</div>
          <p className="text-sm text-slate-400 mt-1">
            Set a 90-day goal to align all execution under one north star.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/clients/${clientId}/goals/history`}
            className="text-xs text-slate-400 hover:text-white"
          >
            View History
          </Link>
          <Link
            href={`/dashboard/clients/${clientId}/goal/new`}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white"
          >
            + New Goal
            <span className="ml-2 inline-block rounded bg-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-200 uppercase">
              Beta
            </span>
          </Link>
        </div>
      </div>
    )
  }

  // Active goal: show summary
  const remaining = daysRemaining(goal.period_end)
  const intentEmoji = goal.intent === 'acquisition' ? '🎯' : goal.intent === 'sales' ? '💰' : '📢'

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/[0.04] p-4 mb-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/dashboard/clients/${clientId}/goal/${goal.id}`} className="flex-1 min-w-0 hover:opacity-80">
          <div className="flex items-center gap-2">
            <span className="text-lg">{intentEmoji}</span>
            <h3 className="text-sm font-semibold text-white">{goal.title}</h3>
            {goal.is_beta && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300 uppercase">
                Beta
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {goal.primary_metric_label}:&nbsp;
            <span className="font-medium text-slate-300">
              {goal.baseline_value.toLocaleString()} → {goal.target_value.toLocaleString()}
            </span>
            <span className="text-slate-600 mx-2">·</span>
            <span className="text-blue-300">{remaining} days remaining</span>
          </p>
        </Link>
        <Link
          href={`/dashboard/clients/${clientId}/goals/history`}
          className="shrink-0 text-xs text-slate-400 hover:text-white"
        >
          History
        </Link>
      </div>
    </div>
  )
}
