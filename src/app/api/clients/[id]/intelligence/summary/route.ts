/**
 * GET /api/clients/[id]/intelligence/summary
 *
 * Returns a summary tile for each of the 7 spotlight metrics.
 * Designed for the IntelligenceSummarySection dashboard widget.
 *
 * Each tile includes:
 *   - currentValue, value7dAgo, value28dAgo
 *   - deltaPct7d, deltaPct28d
 *   - sparkline: 28 daily values (null for missing days)
 *
 * Single DB query fetches all spotlight metrics in one round-trip.
 *
 * Query params:
 *   timezone  IANA timezone string (default: 'Pacific/Auckland')
 *
 * Auth: session cookie via requirePaidClientAccess
 *
 * Reference: ROADMAP.md P22.B.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { computeDeltaPct, buildSparkline, bucketByGranularity } from '@/lib/flywheel/intelligence/timeseries'
import { getMetricMeta, SPOTLIGHT_METRIC_KEYS } from '@/lib/flywheel/intelligence/metric-catalog'
import type { MetricSummaryTile } from '@/lib/flywheel/intelligence/types'
import type { FlywheelName } from '@/lib/flywheel/adapters/types'

export const dynamic = 'force-dynamic'

const LOOKBACK_DAYS = 30   // fetch 30 days so we can compute 28d delta + sparkline
const DEFAULT_TZ    = 'Pacific/Auckland'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(req.url)
  const timezone = searchParams.get('timezone') ?? DEFAULT_TZ

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // ── Single batch query for all spotlight metrics ───────────────────────────
  const { data, error } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_key, metric_value, measured_at, flywheel')
    .eq('client_id', clientId)
    .in('metric_key', SPOTLIGHT_METRIC_KEYS)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch metrics: ${error.message}` },
      { status: 500 },
    )
  }

  // ── Group rows by metric_key ───────────────────────────────────────────────
  type MetricRow = { metric_key: string; metric_value: number; measured_at: string; flywheel: string }
  const grouped = new Map<string, MetricRow[]>()
  for (const row of (data ?? []) as MetricRow[]) {
    const existing = grouped.get(row.metric_key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(row.metric_key, [row])
    }
  }

  // ── Build summary tiles ────────────────────────────────────────────────────
  const now = new Date()
  const tiles: MetricSummaryTile[] = SPOTLIGHT_METRIC_KEYS.map(key => {
    const rows     = grouped.get(key) ?? []
    const meta     = getMetricMeta(key)
    const flywheel = (rows[0]?.flywheel ?? inferFlywheel(key)) as FlywheelName

    // Build daily-bucketed series for accurate delta/sparkline computation
    const series = bucketByGranularity(
      rows.map(r => ({ measured_at: r.measured_at, metric_value: r.metric_value })),
      'day',
      timezone,
      key,
      flywheel,
      meta.label,
      meta.unit,
      meta.direction,
    )

    const { points }  = series
    const lastPoint   = points[points.length - 1]
    const currentValue = lastPoint?.value ?? null

    // Reference values: nearest point ≈ 7 / 28 days before latest
    const value7dAgo  = getReferenceValue(points, 7)
    const value28dAgo = getReferenceValue(points, 28)

    const deltaPct7d  = computeDeltaPctFromValues(currentValue, value7dAgo)
    const deltaPct28d = computeDeltaPctFromValues(currentValue, value28dAgo)

    const sparkline = buildSparkline(points, 28, now)

    return {
      metricKey:    key,
      flywheel,
      label:        meta.label,
      unit:         meta.unit,
      direction:    meta.direction,
      currentValue,
      value7dAgo,
      value28dAgo,
      deltaPct7d,
      deltaPct28d,
      sparkline,
    }
  })

  return NextResponse.json({
    success:       true,
    clientId,
    asOf:          now.toISOString(),
    spotlightKeys: SPOTLIGHT_METRIC_KEYS,
    tiles,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the value of the point nearest to `daysAgo` before the latest point.
 * Returns null if no point found within 1.5 day tolerance.
 */
function getReferenceValue(
  points: Array<{ ts: string; value: number }>,
  daysAgo: number,
): number | null {
  if (points.length < 2) return null
  const latest    = points[points.length - 1]
  const latestMs  = new Date(latest.ts).getTime()
  const targetMs  = latestMs - daysAgo * 24 * 60 * 60 * 1000
  const tolerance = 1.5 * 24 * 60 * 60 * 1000

  let best: { ts: string; value: number } | null = null
  let bestDiff = Infinity

  for (const pt of points) {
    if (pt === latest) continue
    const diff = Math.abs(new Date(pt.ts).getTime() - targetMs)
    if (diff < tolerance && diff < bestDiff) {
      best     = pt
      bestDiff = diff
    }
  }

  return best?.value ?? null
}

function computeDeltaPctFromValues(
  current:   number | null,
  reference: number | null,
): number | null {
  if (current === null || reference === null || reference === 0) return null
  return ((current - reference) / reference) * 100
}

function inferFlywheel(metricKey: string): FlywheelName {
  if (metricKey.startsWith('seo.') || metricKey.startsWith('ga4.')) return 'seo'
  if (metricKey.startsWith('geo.')) return 'geo'
  if (metricKey.startsWith('ads.')) return 'ads'
  return 'social'
}
