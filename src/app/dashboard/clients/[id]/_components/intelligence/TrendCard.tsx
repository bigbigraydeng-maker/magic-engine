/**
 * TrendCard — shows a single metric's current value, 7d delta badge, and sparkline.
 *
 * Phase 22.B.6
 */

'use client'

import { MetricSparkline } from './MetricSparkline'
import type { MetricSummaryTile } from '@/lib/flywheel/intelligence/types'

interface TrendCardProps {
  tile: MetricSummaryTile
}

export function TrendCard({ tile }: TrendCardProps) {
  const { label, unit, direction, currentValue, deltaPct7d, sparkline } = tile

  const formatted = formatValue(currentValue, unit)
  const deltaInfo = getDeltaInfo(deltaPct7d, direction)

  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg bg-white border border-gray-100 shadow-sm min-w-0">
      {/* Metric label */}
      <span className="text-[11px] font-medium text-gray-500 truncate">{label}</span>

      {/* Value row */}
      <div className="flex items-end justify-between gap-2">
        <span className="text-base font-semibold text-gray-900 tabular-nums leading-none">
          {formatted}
        </span>

        {deltaInfo && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-tight shrink-0 ${deltaInfo.className}`}
          >
            {deltaInfo.label}
          </span>
        )}
      </div>

      {/* Sparkline */}
      <div className="mt-1">
        <MetricSparkline
          data={sparkline}
          color={deltaInfo?.color ?? '#94a3b8'}
          filled
        />
      </div>
    </div>
  )
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatValue(value: number | null, unit: MetricSummaryTile['unit']): string {
  if (value === null) return '—'

  switch (unit) {
    case 'count':
      return value >= 1000
        ? `${(value / 1000).toFixed(1)}k`
        : String(Math.round(value))

    case 'percent':
      return `${(value * 100).toFixed(1)}%`

    case 'percent100':
      return `${Math.round(value)}`

    case 'currency':
      return value >= 1000
        ? `$${(value / 1000).toFixed(1)}k`
        : `$${value.toFixed(2)}`

    case 'ratio':
      return `${value.toFixed(2)}×`

    case 'seconds': {
      const m = Math.floor(value / 60)
      const s = Math.round(value % 60)
      return m > 0 ? `${m}m ${s}s` : `${s}s`
    }

    case 'rank':
      return value.toFixed(1)

    default:
      return String(Math.round(value))
  }
}

interface DeltaInfo {
  label:     string
  className: string
  color:     string
}

function getDeltaInfo(
  deltaPct:  number | null,
  direction: MetricSummaryTile['direction'],
): DeltaInfo | null {
  if (deltaPct === null) return null

  const abs    = Math.abs(deltaPct)
  const sign   = deltaPct >= 0 ? '+' : '-'
  const label  = `${sign}${abs.toFixed(1)}%`

  // Determine if this change is positive or negative for the metric
  const isImprovement =
    (direction === 'higher_is_better' && deltaPct > 0) ||
    (direction === 'lower_is_better'  && deltaPct < 0)

  if (abs < 3) {
    // Neutral — minor change
    return {
      label,
      className: 'text-gray-500 bg-gray-100',
      color:     '#94a3b8',
    }
  }

  if (isImprovement) {
    return {
      label,
      className: 'text-emerald-700 bg-emerald-50',
      color:     '#10b981',
    }
  }

  return {
    label,
    className: 'text-red-700 bg-red-50',
    color:     '#ef4444',
  }
}
