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

const VERDICT_INFO: Record<GoalVerdict, { label: string; color: string; emoji: string }> = {
  confirmed:    { label: 'Confirmed',    color: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', emoji: '✅' },
  partial:      { label: 'Partial',      color: 'text-amber-300 bg-amber-500/10 border-amber-500/30',       emoji: '🟡' },
  reversed:     { label: 'Reversed',     color: 'text-rose-300 bg-rose-500/10 border-rose-500/30',           emoji: '❌' },
  inconclusive: { label: 'Inconclusive', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30',       emoji: '➖' },
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
      setGoals(j.goals ?? [])
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
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          ← Back to client
        </Link>
        <h1 className="mt-2 text-xl font-bold text-white flex items-center gap-2">
          Goal History
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300 uppercase">
            Beta
          </span>
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Archived goals — review verdicts, hypotheses, and what was learned.
        </p>
      </div>

      {/* Stats summary */}
      {totalJudged > 0 && (
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Lifetime verdicts</div>
          <div className="flex flex-wrap gap-4">
            {(['confirmed', 'partial', 'reversed', 'inconclusive'] as GoalVerdict[]).map(v => {
              const count = stats[v] ?? 0
              const info = VERDICT_INFO[v]
              return (
                <div key={v} className="flex items-center gap-2">
                  <span className="text-lg">{info.emoji}</span>
                  <div>
                    <div className="text-sm font-semibold text-white">{count}</div>
                    <div className="text-[10px] text-slate-500">{info.label}</div>
                  </div>
                </div>
              )
            })}
            <div className="ml-auto text-xs text-slate-500">
              Total judged: {totalJudged}
            </div>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-400">{error}</div>}

      {!loading && goals.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-white/15 bg-slate-900/40 p-8 text-center">
          <p className="text-sm text-slate-500">
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
              className="block rounded-xl border border-white/10 bg-slate-900/40 hover:bg-slate-900/70 p-5 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-white">{g.title}</h3>
                    <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase">
                      {g.intent}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {g.primary_metric_label}: <span className="text-slate-300">{g.baseline_value.toLocaleString()} → {g.target_value.toLocaleString()}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {formatDate(g.period_start)} – {formatDate(g.period_end)}
                    {g.verdict_at && ` · judged ${formatDate(g.verdict_at)}`}
                  </p>
                  {g.verdict_summary && (
                    <p className="mt-2 text-xs text-slate-400 line-clamp-2">{g.verdict_summary}</p>
                  )}
                </div>

                {g.verdict && (
                  <div className={`shrink-0 rounded-lg border px-3 py-2 text-center ${VERDICT_INFO[g.verdict].color}`}>
                    <div className="text-xl">{VERDICT_INFO[g.verdict].emoji}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5">
                      {VERDICT_INFO[g.verdict].label}
                    </div>
                  </div>
                )}
                {!g.verdict && g.status === 'expired' && (
                  <div className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center">
                    <div className="text-xl">⏰</div>
                    <div className="text-[10px] font-semibold text-amber-300 uppercase tracking-wide mt-0.5">
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
  )
}
