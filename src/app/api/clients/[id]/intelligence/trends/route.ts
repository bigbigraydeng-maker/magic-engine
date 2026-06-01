/**
 * GET /api/clients/[id]/intelligence/trends
 *
 * Returns time-bucketed trend series for one or more metric_keys.
 *
 * Query params:
 *   metric_keys  Comma-separated metric_key strings (required, max 10)
 *   granularity  'day' | 'week' | 'month'  (default: 'day')
 *   days         Number of calendar days to look back (default: 28, max: 90)
 *   timezone     IANA timezone string (default: 'Pacific/Auckland')
 *
 * Auth: session cookie via requireDashboardClientAccess
 *
 * Reference: ROADMAP.md P22.B.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { bucketByGranularity } from '@/lib/flywheel/intelligence/timeseries'
import { getMetricMeta } from '@/lib/flywheel/intelligence/metric-catalog'
import type { TimeGranularity, TrendSeries } from '@/lib/flywheel/intelligence/types'
import type { FlywheelName } from '@/lib/flywheel/adapters/types'

export const dynamic = 'force-dynamic'

const DEFAULT_GRANULARITY: TimeGranularity = 'day'
const DEFAULT_DAYS = 28
const MAX_DAYS     = 90
const MAX_METRICS  = 10
const DEFAULT_TZ   = 'Pacific/Auckland'

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { searchParams } = new URL(req.url)

  // ── Parse & validate query params ─────────────────────────────────────────
  const rawKeys = searchParams.get('metric_keys')
  if (!rawKeys) {
    return NextResponse.json(
      { error: 'metric_keys is required (comma-separated)' },
      { status: 400 },
    )
  }

  const metricKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean)
  if (metricKeys.length === 0 || metricKeys.length > MAX_METRICS) {
    return NextResponse.json(
      { error: `metric_keys must be 1–${MAX_METRICS} comma-separated values` },
      { status: 400 },
    )
  }

  const rawGranularity = searchParams.get('granularity') ?? DEFAULT_GRANULARITY
  if (!['day', 'week', 'month'].includes(rawGranularity)) {
    return NextResponse.json(
      { error: "granularity must be 'day', 'week', or 'month'" },
      { status: 400 },
    )
  }
  const granularity = rawGranularity as TimeGranularity

  const rawDays = parseInt(searchParams.get('days') ?? String(DEFAULT_DAYS), 10)
  const days    = isNaN(rawDays) || rawDays < 1
    ? DEFAULT_DAYS
    : Math.min(rawDays, MAX_DAYS)

  const timezone = searchParams.get('timezone') ?? DEFAULT_TZ

  // ── Fetch raw data ─────────────────────────────────────────────────────────
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_key, metric_value, measured_at, flywheel')
    .eq('client_id', clientId)
    .in('metric_key', metricKeys)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })

  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch metrics: ${error.message}` },
      { status: 500 },
    )
  }

  // ── Group by metric_key ────────────────────────────────────────────────────
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

  // ── Build TrendSeries per metric ───────────────────────────────────────────
  const rangeStart = since
  const rangeEnd   = new Date().toISOString()

  const series: TrendSeries[] = metricKeys.map(key => {
    const rows    = grouped.get(key) ?? []
    const meta    = getMetricMeta(key)
    const flywheel = (rows[0]?.flywheel ?? inferFlywheel(key)) as FlywheelName

    return bucketByGranularity(
      rows.map(r => ({ measured_at: r.measured_at, metric_value: r.metric_value })),
      granularity,
      timezone,
      key,
      flywheel,
      meta.label,
      meta.unit,
      meta.direction,
    )
  })

  return NextResponse.json({
    success:     true,
    clientId,
    granularity,
    range:       { start: rangeStart, end: rangeEnd },
    daysRequested: days,
    timezone,
    series,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Infer flywheel from metric_key prefix when DB row doesn't have it. */
function inferFlywheel(metricKey: string): FlywheelName {
  if (metricKey.startsWith('seo.') || metricKey.startsWith('ga4.')) return 'seo'
  if (metricKey.startsWith('geo.')) return 'geo'
  if (metricKey.startsWith('ads.')) return 'ads'
  if (metricKey.startsWith('social.')) return 'social'
  return 'seo'
}
