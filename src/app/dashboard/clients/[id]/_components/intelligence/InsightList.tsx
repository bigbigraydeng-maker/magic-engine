/**
 * InsightList — renders a list of InsightCards.
 *
 * Severity badge colours mirror the execution kanban anomaly style.
 * Phase 22.B.7
 */

'use client'

import type { InsightCard, InsightSeverity } from '@/lib/flywheel/intelligence/types'

interface InsightListProps {
  insights: InsightCard[]
  /** Limit the number of cards shown (undefined = show all) */
  limit?:   number
}

export function InsightList({ insights, limit }: InsightListProps) {
  const visible = limit !== undefined ? insights.slice(0, limit) : insights

  if (visible.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        No insights yet — data is being collected.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {visible.map(card => (
        <InsightListItem key={card.id} card={card} />
      ))}
    </ul>
  )
}

function InsightListItem({ card }: { card: InsightCard }) {
  const badge = SEVERITY_BADGE[card.severity] ?? SEVERITY_BADGE.low

  return (
    <li className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white border border-gray-100">
      {/* Severity dot */}
      <span className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${badge.dotColor}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.pillClass}`}>
            {badge.label}
          </span>
          <span className="text-[11px] font-semibold text-gray-800 leading-tight">
            {card.headline}
          </span>
        </div>

        <p className="mt-0.5 text-[10px] text-gray-500 leading-snug line-clamp-2">
          {card.body}
        </p>

        {card.ctaHref && (
          <a
            href={card.ctaHref}
            className="mt-1 inline-block text-[10px] font-medium text-indigo-600 hover:underline"
          >
            View details →
          </a>
        )}
      </div>

      {/* Delta badge */}
      {card.deltaPct !== null && (
        <span className={`shrink-0 text-[10px] font-bold tabular-nums ${getDeltaColor(card.deltaPct, card.severity)}`}>
          {card.deltaPct >= 0 ? '+' : ''}{card.deltaPct.toFixed(1)}%
        </span>
      )}
    </li>
  )
}

// ─── Style maps ───────────────────────────────────────────────────────────────

interface SeverityStyle {
  label:     string
  dotColor:  string
  pillClass: string
}

const SEVERITY_BADGE: Record<InsightSeverity, SeverityStyle> = {
  high: {
    label:     'HIGH',
    dotColor:  'bg-red-500',
    pillClass: 'text-red-700 bg-red-50 border border-red-200',
  },
  medium: {
    label:     'MEDIUM',
    dotColor:  'bg-amber-400',
    pillClass: 'text-amber-700 bg-amber-50 border border-amber-200',
  },
  low: {
    label:     'LOW',
    dotColor:  'bg-gray-400',
    pillClass: 'text-gray-600 bg-gray-100',
  },
  positive: {
    label:     '↑ POSITIVE',
    dotColor:  'bg-emerald-500',
    pillClass: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
  },
}

function getDeltaColor(deltaPct: number, severity: InsightSeverity): string {
  if (severity === 'positive') return 'text-emerald-600'
  if (severity === 'high' || (severity === 'medium' && deltaPct < 0)) return 'text-red-600'
  return 'text-gray-500'
}
