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
      <div className="mb-4 h-[68px] rounded-xl border border-black/10 bg-white p-4 shadow-sm" />
    )
  }

  // No active goal: show CTA
  if (!goal) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-xl border border-dashed border-black/15 bg-white p-4 shadow-sm">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">No active goal</div>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            Set a 90-day goal to align all execution under one north star.
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

  // Active goal: show summary
  const remaining = daysRemaining(goal.period_end)
  const intentEmoji = goal.intent === 'acquisition' ? '🎯' : goal.intent === 'sales' ? '💰' : '📢'

  return (
    <div className="mb-4 rounded-xl border border-me-ochre/30 bg-me-ochre/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/dashboard/clients/${clientId}/goal/${goal.id}`} className="min-w-0 flex-1 hover:opacity-80">
          <div className="flex items-center gap-2">
            <span className="text-lg">{intentEmoji}</span>
            <h3 className="text-sm font-black text-me-charcoal">{goal.title}</h3>
            {goal.is_beta && (
              <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-me-ochre">
                Beta
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
            {goal.primary_metric_label}:&nbsp;
            <span className="font-bold text-me-charcoal/80">
              {goal.baseline_value.toLocaleString()} → {goal.target_value.toLocaleString()}
            </span>
            <span className="mx-2 text-me-charcoal/30">·</span>
            <span className="font-bold text-me-ochre">{remaining} days remaining</span>
          </p>
        </Link>
        <Link
          href={`/dashboard/clients/${clientId}/goals/history`}
          className="shrink-0 text-xs font-black text-me-charcoal/55 hover:text-me-charcoal"
        >
          History
        </Link>
      </div>
    </div>
  )
}
