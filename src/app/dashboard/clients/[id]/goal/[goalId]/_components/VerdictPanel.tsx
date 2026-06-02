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

const VERDICT_BADGE: Record<GoalVerdict, { label: string; color: string; emoji: string; textClass: string }> = {
  confirmed:    { label: 'Confirmed',    color: 'bg-status-track/10 text-status-track border-status-track/30', emoji: '✅', textClass: 'text-status-track' },
  partial:      { label: 'Partial',      color: 'bg-status-exec/10 text-status-exec border-status-exec/30',     emoji: '🟡', textClass: 'text-status-exec' },
  reversed:     { label: 'Reversed',     color: 'bg-status-rej/10 text-status-rej border-status-rej/30',       emoji: '❌', textClass: 'text-status-rej' },
  inconclusive: { label: 'Inconclusive', color: 'bg-me-stone text-me-taupe border-me-taupe/30',                emoji: '➖', textClass: 'text-me-taupe' },
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
    <div className={`rounded-xl border p-6 shadow-sm ${
      goal.status === 'expired'
        ? 'border-status-exec/40 bg-status-exec/10'
        : 'border-me-ochre/30 bg-me-ochre/10'
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-display text-base font-bold text-me-charcoal">
            {goal.status === 'expired'
              ? `⚠️ Goal Expired ${daysOverdue} day(s) ago`
              : '📊 Goal in progress'}
          </h3>
          <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
            {goal.status === 'expired'
              ? 'Supply current value of primary metric to compute verdict and archive this goal.'
              : 'Goal still active. You can submit an early verdict if needed (or wait until period ends).'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black text-white transition-colors ${
            goal.status === 'expired'
              ? 'bg-status-exec hover:bg-status-exec/90'
              : 'bg-me-ochre hover:bg-me-ochre/90'
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
    <div className={`rounded-xl border p-6 shadow-sm ${badge.color}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{badge.emoji}</span>
            <div>
              <div className="text-xs font-black uppercase tracking-wide opacity-80">90-Day Verdict</div>
              <div className="font-display text-2xl font-bold">{badge.label}</div>
            </div>
          </div>
          {goal.verdict_summary && (
            <p className="mt-4 max-w-2xl whitespace-pre-wrap text-sm font-semibold opacity-90">
              {goal.verdict_summary}
            </p>
          )}
          {goal.verdict_at && (
            <p className="mt-3 text-[11px] font-semibold opacity-60">
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

  // Live preview of verdict (Phase 32: direction-aware)
  const numericCurrent = currentValue ? parseFloat(currentValue) : null
  const isDecrease = goal.target_direction === 'decrease'
  const preview = numericCurrent != null
    ? (() => {
        // Direction-aware progress: for decrease, (baseline - current) / (baseline - target)
        const progress = isDecrease
          ? (goal.baseline_value - numericCurrent) / (goal.baseline_value - goal.target_value)
          : (numericCurrent - goal.baseline_value) / (goal.target_value - goal.baseline_value)
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg space-y-4 rounded-xl border border-black/10 bg-white p-6 shadow-card"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-display text-base font-bold text-me-charcoal">Submit Goal Verdict</h3>
        <p className="text-xs font-semibold text-me-charcoal/55">
          {goal.title}
        </p>

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
            Current value of {goal.primary_metric_label}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={currentValue}
              onChange={e => setCurrentValue(e.target.value)}
              placeholder={`Was ${goal.baseline_value}, target ${goal.target_value}`}
              className="w-48 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
              autoFocus
            />
            <span className="text-xs font-semibold text-me-charcoal/55">{goal.primary_metric_unit}</span>
          </div>
          <p className="text-[11px] font-semibold text-me-charcoal/55">
            Baseline {goal.baseline_value.toLocaleString()} {isDecrease ? '↓' : '→'} Target {goal.target_value.toLocaleString()}
            {isDecrease && (
              <span className="ml-2 rounded-full bg-status-sched/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-status-sched">
                Decrease
              </span>
            )}
          </p>
        </div>

        {preview && (
          <div className="rounded-lg border border-black/10 bg-me-ivory px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{VERDICT_BADGE[preview.verdict].emoji}</span>
              <span className={`text-sm font-black ${VERDICT_BADGE[preview.verdict].textClass}`}>
                {VERDICT_BADGE[preview.verdict].label}
              </span>
              <span className="ml-auto text-xs font-semibold text-me-charcoal/55">
                Progress {preview.pct}%
              </span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
            FDE Summary (optional)
          </label>
          <textarea
            value={extraSummary}
            onChange={e => setExtraSummary(e.target.value)}
            rows={4}
            placeholder="为什么达成 / 没达成？哪些 Initiative 真正起了作用？哪些假设被推翻？这段会进入历史归档用于学习。"
            className="w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
          />
        </div>

        {error && (
          <div className="rounded-xl border border-status-rej/30 bg-status-rej/10 px-3 py-2 text-xs font-semibold text-status-rej">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-black/10 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-black text-me-charcoal/55 hover:text-me-charcoal disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || numericCurrent == null}
            className="rounded-lg bg-status-track px-6 py-2 text-sm font-black text-white transition-colors hover:bg-status-track/90 disabled:opacity-30"
          >
            {submitting ? 'Judging…' : 'Submit & Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}
