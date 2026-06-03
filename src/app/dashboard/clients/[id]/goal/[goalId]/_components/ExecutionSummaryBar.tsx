'use client'

/**
 * Phase 33 M4 / P33.12 — Goal-level Execution Summary Bar
 *
 * Sits between VerdictPanel and InitiativeList in the Goal detail page.
 *
 * Shows at a glance:
 *   - N Initiative / X Campaign / Y action 已完成 / Z 进行中
 *   - aggregate completion bar (sum completed / sum (total - skipped))
 *
 * Notes per 子牙 review:
 *   - Action completion % and Campaign count are SEPARATE signals (not mixed
 *     into a single percentage). Mixing them produces an unbelievable number.
 *   - Campaign count comes from real campaign_briefs rows (dead-id filtered).
 *   - Uses the new GET /api/goals/[goalId]/execution-summary endpoint so the
 *     per-Initiative breakdown can also share this fetch (passed down via the
 *     same data → InitiativeList → InitiativeExecutionPanel).
 */

import { useEffect, useState } from 'react'
import type { GoalExecutionSummary } from '@/lib/strategy/initiatives'

interface Props {
  goalId: string
  /** Increment to force refresh (e.g. after an Initiative is added). */
  refreshKey?: number
  /** Notify parent when summary loads so InitiativeList can reuse data. */
  onLoaded?: (summary: GoalExecutionSummary) => void
}

export function ExecutionSummaryBar({ goalId, refreshKey = 0, onLoaded }: Props) {
  const [summary, setSummary] = useState<GoalExecutionSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/goals/${goalId}/execution-summary`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = await res.json() as { summary?: GoalExecutionSummary }
        if (cancelled || !json.summary) return
        setSummary(json.summary)
        onLoaded?.(json.summary)
      } catch {
        // non-fatal: bar will hide itself
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // intentionally exclude onLoaded — caller-provided callback would cause infinite re-fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId, refreshKey])

  if (loading) {
    return <div className="h-24 animate-pulse rounded-xl border border-black/10 bg-white" />
  }
  if (!summary) return null
  if (summary.initiativeCount === 0) return null  // Goal has no initiatives yet — no summary to show

  const pct = summary.aggregateCompletionPct
  const denom = summary.totalActions - summary.totalSkipped

  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-black uppercase tracking-wide text-me-charcoal/45">
          Execution Progress
        </span>
        <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-me-ochre">
          Phase 33 M4
        </span>
      </div>

      {/* Stat row */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Initiatives"    value={summary.initiativeCount} />
        <Stat label="Campaigns"      value={summary.totalCampaigns} />
        <Stat label="Actions Done"   value={summary.totalCompleted} accent="green" />
        <Stat label="In Progress"    value={summary.totalInProgress} accent="blue" />
      </div>

      {/* Aggregate completion bar — separate signal from Campaign count */}
      <div className="mt-5">
        <div className="mb-1 flex items-end justify-between">
          <span className="text-xs font-semibold text-me-charcoal/55">
            Action completion <span className="text-me-charcoal/35">(completed / (total − skipped))</span>
          </span>
          <span className="text-sm font-bold text-me-ochre">
            {pct !== null ? `${pct}%` : '—'}
            <span className="ml-1 text-[11px] font-semibold text-me-charcoal/45">
              {summary.totalCompleted} / {denom}
              {summary.totalSkipped > 0 && ` (${summary.totalSkipped} skipped)`}
            </span>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-me-stone">
          <div
            className="h-full rounded-full bg-me-ochre transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, pct ?? 0))}%` }}
          />
        </div>
      </div>

      {summary.totalActions === 0 && (
        <p className="mt-3 text-[11px] font-semibold text-me-charcoal/45">
          No actions yet under any Initiative. Generate a Marketing Plan from an
          Initiative card to populate the executions kanban.
        </p>
      )}
    </div>
  )
}

function Stat({
  label, value, accent,
}: { label: string; value: number; accent?: 'green' | 'blue' }) {
  const color =
    accent === 'green' ? 'text-status-track'
    : accent === 'blue'  ? 'text-status-sched'
    : 'text-me-charcoal'
  return (
    <div className="rounded-lg border border-black/8 bg-me-ivory px-3 py-2">
      <div className="text-[10px] font-black uppercase text-me-charcoal/45">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
