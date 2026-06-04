/**
 * GET /api/clients/[id]/intelligence/insights
 *
 * Returns structured insight cards for a client's flywheel metrics.
 * Combines:
 *   1. Fresh anomaly_signals from 22.D (status = 'fresh')
 *   2. 22.B insight rules: positive-momentum, concerning-decline, data-gap
 *
 * Query params:
 *   flywheel   'seo' | 'geo' | 'ads' | 'social' | 'all'  (default: 'all')
 *   days       Look-back window for trend computation (default: 28, max: 90)
 *   timezone   IANA timezone string (default: 'Pacific/Auckland')
 *
 * Auth: session cookie via requirePaidClientAccess
 *
 * Reference: ROADMAP.md P22.B.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { bucketByGranularity } from '@/lib/flywheel/intelligence/timeseries'
import { generateInsights, type AnomalySignalRow } from '@/lib/flywheel/intelligence/insights'
import { getMetricMeta, SPOTLIGHT_METRIC_KEYS } from '@/lib/flywheel/intelligence/metric-catalog'
import type { FlywheelName } from '@/lib/flywheel/adapters/types'
import type { InsightCard } from '@/lib/flywheel/intelligence/types'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS  = 28
const MAX_DAYS      = 90
const DEFAULT_TZ    = 'Pacific/Auckland'
const VALID_FLYWHEELS = new Set(['seo', 'geo', 'ads', 'social', 'all'])

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

  const flywheelFilter = searchParams.get('flywheel') ?? 'all'
  if (!VALID_FLYWHEELS.has(flywheelFilter)) {
    return NextResponse.json(
      { error: "flywheel must be 'seo', 'geo', 'ads', 'social', or 'all'" },
      { status: 400 },
    )
  }

  const rawDays = parseInt(searchParams.get('days') ?? String(DEFAULT_DAYS), 10)
  const days    = isNaN(rawDays) || rawDays < 1 ? DEFAULT_DAYS : Math.min(rawDays, MAX_DAYS)
  const timezone = searchParams.get('timezone') ?? DEFAULT_TZ
  const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // ── Fetch trend data + anomaly signals in parallel ─────────────────────────
  const metricKeysToFetch = SPOTLIGHT_METRIC_KEYS
  const [metricsResult, anomalyResult] = await Promise.all([
    supabaseAdmin
      .from('flywheel_metrics')
      .select('metric_key, metric_value, measured_at, flywheel')
      .eq('client_id', clientId)
      .in('metric_key', metricKeysToFetch)
      .gte('measured_at', since)
      .order('measured_at', { ascending: true }),

    supabaseAdmin
      .from('anomaly_signals')
      .select('id, client_id, flywheel, metric_key, rule_id, severity, current_value, reference_value, delta_pct, description, created_at')
      .eq('client_id', clientId)
      .eq('status', 'fresh')
      .gte('created_at', since),
  ])

  if (metricsResult.error) {
    return NextResponse.json(
      { error: `Failed to fetch metrics: ${metricsResult.error.message}` },
      { status: 500 },
    )
  }

  // ── Group metric rows by key ───────────────────────────────────────────────
  type MetricRow = { metric_key: string; metric_value: number; measured_at: string; flywheel: string }
  const grouped = new Map<string, MetricRow[]>()
  for (const row of (metricsResult.data ?? []) as MetricRow[]) {
    const existing = grouped.get(row.metric_key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(row.metric_key, [row])
    }
  }

  // ── Build TrendSeries for each spotlight metric ───────────────────────────
  const series = metricKeysToFetch.map(key => {
    const rows     = grouped.get(key) ?? []
    const meta     = getMetricMeta(key)
    const flywheel = (rows[0]?.flywheel ?? inferFlywheel(key)) as FlywheelName
    return bucketByGranularity(
      rows.map(r => ({ measured_at: r.measured_at, metric_value: r.metric_value })),
      'day',
      timezone,
      key,
      flywheel,
      meta.label,
      meta.unit,
      meta.direction,
    )
  })

  // ── Generate insights ──────────────────────────────────────────────────────
  const anomalySignals = (anomalyResult.data ?? []) as AnomalySignalRow[]
  let insights: InsightCard[] = generateInsights(series, anomalySignals, clientId)

  // Apply flywheel filter
  if (flywheelFilter !== 'all') {
    insights = insights.filter(c => c.flywheel === flywheelFilter)
  }

  return NextResponse.json({
    success:  true,
    clientId,
    flywheel: flywheelFilter,
    days,
    insights,
  })
}

function inferFlywheel(metricKey: string): FlywheelName {
  if (metricKey.startsWith('seo.') || metricKey.startsWith('ga4.')) return 'seo'
  if (metricKey.startsWith('geo.')) return 'geo'
  if (metricKey.startsWith('ads.')) return 'ads'
  return 'social'
}
