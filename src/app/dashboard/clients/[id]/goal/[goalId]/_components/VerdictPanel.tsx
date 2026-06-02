'use client'

/**
 * Phase 31 M4 — Verdict Panel
 *
 * Three states:
 *
 * 1. status='active' or 'expired' AND no verdict yet
 *    → "Submit Verdict" button + modal where FDE supplies current_value + summary
 *
 * 2. status='archived' WITH verdict
 *    → Show verdict badge + progress + summary (read-only)
 *
 * 3. status='draft' (or unassigned migration placeholder)
 *    → Not rendered
 */

import { useState } from 'react'
import type { GoalRow, GoalVerdict } from '@/types/strategy'

const VERDICT_BADGE: Record<GoalVerdict, { label: string; color: string; emoji: string }> = {
  confirmed:    { label: 'Confirmed',    color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', emoji: '✅' },
  partial:      { label: 'Partial',      color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',       emoji: '🟡' },
  reversed:     { label: 'Reversed',     color: 'bg-rose-500/20 text-rose-300 border-rose-500/30',           emoji: '❌' },
  inconclusive: { label: 'Inconclusive', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30',       emoji: '➖' },
}

interface Props {
  goal: GoalRow
  onJudged: () => void   // refetch goal after verdict submitted
}

export function VerdictPanel({ goal, onJudged }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  // Draft / migration placeholder → not rendered
  if (goal.status === 'draft') return null

  // Archived with verdict → show result
  if (goal.status === 'archived' && goal.verdict) {
    return <VerdictResult goal={goal} />
  }

  // Active or expired → show "Submit Verdict" CTA
  const dueDate = new Date(goal.period_end)
  const daysOverdue = Math.floor((Date.now() - dueDate.getTime()) / 86_400_000)

  return (
    <div className={`rounded-xl border p-6 ${
      goal.status === 'expired'
        ? 'border-amber-500/40 bg-amber-500/[0.05]'
        : 'border-blue-500/30 bg-blue-500/[0.04]'
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-white">
            {goal.status === 'expired'
              ? `⚠️ Goal Expired ${daysOverdue} day(s) ago`
              : '📊 Goal in progress'}
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {goal.status === 'expired'
              ? 'Supply current value of primary metric to compute verdict and archive this goal.'
              : 'Goal still active. You can submit an early verdict if needed (or wait until period ends).'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium text-white ${
            goal.status === 'expired'
              ? 'bg-amber-600 hover:bg-amber-500'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          Submit Verdict
        </button>
      </div>

      {modalOpen && (
        <VerdictModal
          goal={goal}
          onClose={() => setModalOpen(false)}
          onSubmitted={() => { setModalOpen(false); onJudged() }}
        />
      )}
    </div>
  )
}

// ─── Read-only verdict display (archived state) ─────────────────────────────

function VerdictResult({ goal }: { goal: GoalRow }) {
  if (!goal.verdict) return null
  const badge = VERDICT_BADGE[goal.verdict]

  return (
    <div className={`rounded-xl border p-6 ${badge.color}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{badge.emoji}</span>
            <div>
              <div className="text-xs uppercase tracking-wide opacity-80">90-Day Verdict</div>
              <div className="text-2xl font-bold">{badge.label}</div>
            </div>
          </div>
          {goal.verdict_summary && (
            <p className="mt-4 text-sm whitespace-pre-wrap opacity-90 max-w-2xl">
              {goal.verdict_summary}
            </p>
          )}
          {goal.verdict_at && (
            <p className="mt-3 text-[11px] opacity-60">
              Judged on {new Date(goal.verdict_at).toLocaleString('en-NZ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Submit verdict modal ────────────────────────────────────────────────────

function VerdictModal({
  goal, onClose, onSubmitted,
}: { goal: GoalRow; onClose: () => void; onSubmitted: () => void }) {
  const [currentValue, setCurrentValue] = useState<string>('')
  const [extraSummary, setExtraSummary] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Live preview of verdict
  const numericCurrent = currentValue ? parseFloat(currentValue) : null
  const preview = numericCurrent != null
    ? (() => {
        const progress = (numericCurrent - goal.baseline_value) / (goal.target_value - goal.baseline_value)
        const pct = Math.round(progress * 1000) / 10
        let verdict: GoalVerdict = 'inconclusive'
        if (progress >= 0.80) verdict = 'confirmed'
        else if (progress >= 0.50) verdict = 'partial'
        else verdict = 'reversed'
        return { pct, verdict }
      })()
    : null

  async function submit() {
    if (numericCurrent == null) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/goals/${goal.id}/judge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_value: numericCurrent,
          extra_summary: extraSummary.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to submit')
        return
      }
      onSubmitted()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-slate-900 border border-white/10 p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">Submit Goal Verdict</h3>
        <p className="text-xs text-slate-400">
          {goal.title}
        </p>

        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase tracking-wide">
            Current value of {goal.primary_metric_label}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={currentValue}
              onChange={e => setCurrentValue(e.target.value)}
              placeholder={`Was ${goal.baseline_value}, target ${goal.target_value}`}
              className="w-48 rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white"
              autoFocus
            />
            <span className="text-xs text-slate-500">{goal.primary_metric_unit}</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Baseline {goal.baseline_value.toLocaleString()} → Target {goal.target_value.toLocaleString()}
          </p>
        </div>

        {preview && (
          <div className="rounded-lg border border-white/10 bg-slate-950/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{VERDICT_BADGE[preview.verdict].emoji}</span>
              <span className={`text-sm font-bold ${VERDICT_BADGE[preview.verdict].color.split(' ')[1]}`}>
                {VERDICT_BADGE[preview.verdict].label}
              </span>
              <span className="text-xs text-slate-500 ml-auto">
                Progress {preview.pct}%
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs text-slate-400 uppercase tracking-wide">
            FDE Summary (optional)
          </label>
          <textarea
            value={extraSummary}
            onChange={e => setExtraSummary(e.target.value)}
            rows={4}
            placeholder="为什么达成 / 没达成？哪些 Initiative 真正起了作用？哪些假设被推翻？这段会进入历史归档用于学习。"
            className="w-full rounded-lg bg-slate-800 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 resize-none"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || numericCurrent == null}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 px-6 py-2 text-sm font-medium text-white"
          >
            {submitting ? 'Judging…' : 'Submit & Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}
