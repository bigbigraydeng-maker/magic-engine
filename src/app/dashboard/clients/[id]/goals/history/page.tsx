'use client'

/**
 * Phase 31 M4 — Goal history (archived goals) for one client.
 * URL: /dashboard/clients/[id]/goals/history
 *
 * Shows all archived goals + their verdict / progress / FDE summary.
 * This is where战略学习 happens — looking at past hypothesis vs actual outcomes.
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { GoalRow, GoalVerdict } from '@/types/strategy'
import { normalizeGoalList } from '@/lib/strategy/normalize'

const VERDICT_INFO: Record<GoalVerdict, { label: string; color: string; emoji: string }> = {
  confirmed:    { label: 'Confirmed',    color: 'text-status-track bg-status-track/10 border-status-track/30', emoji: '✅' },
  partial:      { label: 'Partial',      color: 'text-status-exec bg-status-exec/10 border-status-exec/30',     emoji: '🟡' },
  reversed:     { label: 'Reversed',     color: 'text-status-rej bg-status-rej/10 border-status-rej/30',       emoji: '❌' },
  inconclusive: { label: 'Inconclusive', color: 'text-me-taupe bg-me-stone border-me-taupe/30',                emoji: '➖' },
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function GoalHistoryPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [goals, setGoals] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/goals?status=archived,expired`)
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to load')
        return
      }
      const j = await res.json()
      // B7 fix: normalize NUMERIC strings to numbers
      setGoals(normalizeGoalList(j.goals ?? []))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  // Stats
  const stats = goals.reduce((acc, g) => {
    if (g.verdict) acc[g.verdict] = (acc[g.verdict] ?? 0) + 1
    return acc
  }, {} as Record<GoalVerdict, number>)
  const totalJudged = Object.values(stats).reduce((s, n) => s + n, 0)

  return (
    <div className="min-h-screen bg-[#f6f7f2] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="text-xs font-black text-me-charcoal/45 hover:text-me-charcoal/75"
          >
            ← Back to client
          </Link>
          <h1 className="mt-2 flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-me-charcoal">
            Goal History
            <span className="rounded-full bg-me-ochre/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-me-ochre">
              Beta
            </span>
          </h1>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            Archived goals — review verdicts, hypotheses, and what was learned.
          </p>
        </div>

        {/* Stats summary */}
        {totalJudged > 0 && (
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">Lifetime verdicts</div>
            <div className="flex flex-wrap gap-4">
              {(['confirmed', 'partial', 'reversed', 'inconclusive'] as GoalVerdict[]).map(v => {
                const count = stats[v] ?? 0
                const info = VERDICT_INFO[v]
                return (
                  <div key={v} className="flex items-center gap-2">
                    <span className="text-lg">{info.emoji}</span>
                    <div>
                      <div className="text-sm font-black text-me-charcoal">{count}</div>
                      <div className="text-[10px] font-semibold text-me-charcoal/45">{info.label}</div>
                    </div>
                  </div>
                )
              })}
              <div className="ml-auto text-xs font-semibold text-me-charcoal/55">
                Total judged: {totalJudged}
              </div>
            </div>
          </div>
        )}

        {loading && <p className="text-sm font-semibold text-me-charcoal/55">Loading…</p>}
        {error && (
          <div className="rounded-xl border border-status-rej/30 bg-status-rej/10 px-4 py-2 text-sm font-semibold text-status-rej">{error}</div>
        )}

        {!loading && goals.length === 0 && !error && (
          <div className="rounded-xl border border-dashed border-black/15 bg-white p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-me-charcoal/55">
              No archived goals yet. Once a goal completes (90 days or FDE submits early verdict), it appears here.
            </p>
          </div>
        )}

        {goals.length > 0 && (
          <div className="space-y-3">
            {goals.map(g => (
              <Link
                key={g.id}
                href={`/dashboard/clients/${clientId}/goal/${g.id}`}
                className="block rounded-xl border border-black/10 bg-white p-5 shadow-sm transition-colors hover:border-me-ochre/40 hover:shadow-card"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-black text-me-charcoal">{g.title}</h3>
                      <span className="rounded-full bg-me-ivory px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-me-charcoal/55">
                        {g.intent}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-me-charcoal/55">
                      {g.primary_metric_label}: <span className="font-bold text-me-charcoal/80">{g.baseline_value.toLocaleString()} → {g.target_value.toLocaleString()}</span>
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-me-charcoal/45">
                      {formatDate(g.period_start)} – {formatDate(g.period_end)}
                      {g.verdict_at && ` · judged ${formatDate(g.verdict_at)}`}
                    </p>
                    {g.verdict_summary && (
                      <p className="mt-2 line-clamp-2 text-xs font-semibold text-me-charcoal/55">{g.verdict_summary}</p>
                    )}
                  </div>

                  {g.verdict && (
                    <div className={`shrink-0 rounded-lg border px-3 py-2 text-center ${VERDICT_INFO[g.verdict].color}`}>
                      <div className="text-xl">{VERDICT_INFO[g.verdict].emoji}</div>
                      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide">
                        {VERDICT_INFO[g.verdict].label}
                      </div>
                    </div>
                  )}
                  {!g.verdict && g.status === 'expired' && (
                    <div className="shrink-0 rounded-lg border border-status-exec/30 bg-status-exec/10 px-3 py-2 text-center">
                      <div className="text-xl">⏰</div>
                      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-status-exec">
                        Needs Verdict
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
