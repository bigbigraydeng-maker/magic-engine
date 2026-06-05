/**
 * GET /api/clients/[id]/health-score
 *
 * Computes a 0–100 flywheel health score for a client by:
 *   1. Fetching the last 30 days of flywheel_metrics for tracked metric keys
 *   2. Comparing each metric's latest value vs its 30-day rolling average
 *   3. Scoring each of the 4 flywheels (0–25 pts each)
 *   4. Applying an anomaly penalty (−2 per fresh signal, max −20)
 *
 * Response 200:
 *   { total: number, band: string, breakdown: FlywheelScore[], activeAnomalies, anomalyPenalty }
 *
 * Response 401: not authenticated / not authorised
 * Response 500: database error
 *
 * Security: requirePaidClientAccess (session-based)
 * Reference: ROADMAP.md Phase 22.B.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  HEALTH_METRICS,
  scoreFlywheelMetrics,
  buildHealthScore,
  type FlywheelName,
  type FlywheelMetricStats,
} from '@/lib/flywheel/health/score'

export const dynamic = 'force-dynamic'

const LOOKBACK_DAYS = 30

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // ── 1. Fetch all tracked metric keys for this client in one query ────────────

  const allMetricKeys = Object.values(HEALTH_METRICS).flatMap(ms => ms.map(m => m.key))

  const { data: metricRows, error: metricError } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_key, metric_value, measured_at')
    .eq('client_id', clientId)
    .in('metric_key', allMetricKeys)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })

  if (metricError) {
    console.error('[health-score] metrics query error:', metricError.message)
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 })
  }

  // ── 2. Fetch fresh anomaly signal count ─────────────────────────────────────

  const { count: anomalyCount, error: anomalyError } = await supabaseAdmin
    .from('anomaly_signals')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'fresh')

  if (anomalyError) {
    console.error('[health-score] anomaly query error:', anomalyError.message)
    // Non-fatal: proceed with 0 anomalies
  }

  // ── 3. Group rows by metric_key, compute latest + avg ────────────────────────

  const byKey = new Map<string, number[]>()
  for (const row of metricRows ?? []) {
    const arr = byKey.get(row.metric_key) ?? []
    arr.push(row.metric_value)
    byKey.set(row.metric_key, arr)
  }

  function computeStats(metricKey: string, lowerIsBetter: boolean): FlywheelMetricStats | null {
    const values = byKey.get(metricKey)
    if (!values || values.length === 0) return null
    const latest = values[values.length - 1]
    const avg30d = values.reduce((s, v) => s + v, 0) / values.length
    return { metricKey, latest, avg30d, lowerIsBetter }
  }

  // ── 4. Score each flywheel ────────────────────────────────────────────────────

  const flywheelScores = (Object.entries(HEALTH_METRICS) as [FlywheelName, typeof HEALTH_METRICS[FlywheelName]][])
    .map(([fw, metrics]) => {
      const stats = metrics
        .map(m => computeStats(m.key, m.lowerIsBetter))
        .filter((s): s is FlywheelMetricStats => s !== null)
      return scoreFlywheelMetrics(fw, stats)
    })

  // ── 5. Build final result ─────────────────────────────────────────────────────

  const freshAnomalies = anomalyCount ?? 0
  const result = buildHealthScore(flywheelScores, freshAnomalies)

  return NextResponse.json(result)
}
