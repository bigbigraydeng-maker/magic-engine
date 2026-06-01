/**
 * GET /api/clients/[id]/flywheel/metrics/trend
 *
 * Returns a time-series of metric values for a single metric_key,
 * suitable for rendering a line chart in the FDE dashboard.
 *
 * Query params:
 *   metric_key  string  required — e.g. "seo.gsc.clicks"
 *   days        number  optional — lookback window (7, 14, or 30); default 30, capped at 90
 *
 * Response 200:
 *   { metric_key, days, dataPoints: [{ date: "YYYY-MM-DD", value: number }] }
 *
 * Response 400: missing or invalid metric_key
 * Response 401: not authenticated / not authorised for this client
 * Response 500: database error
 *
 * Security: requireDashboardClientAccess (session-based)
 * Reference: ROADMAP.md Phase 22.B.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

// Maximum days we will ever query (guard against unbounded DB scan)
const MAX_DAYS = 90

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // ── Parse query params ──────────────────────────────────────────────────────

  const metricKey = req.nextUrl.searchParams.get('metric_key')
  if (!metricKey || metricKey.trim() === '') {
    return NextResponse.json(
      { error: 'metric_key is required' },
      { status: 400 },
    )
  }

  const rawDays = req.nextUrl.searchParams.get('days')
  const parsed = parseInt(rawDays ?? '30', 10)
  const days = Math.min(Math.max(isNaN(parsed) || parsed <= 0 ? 30 : parsed, 1), MAX_DAYS)

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // ── Query ───────────────────────────────────────────────────────────────────

  const { data, error } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value, measured_at')
    .eq('client_id', clientId)
    .eq('metric_key', metricKey)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })

  if (error) {
    console.error('[flywheel/metrics/trend] DB error:', error.message)
    return NextResponse.json(
      { error: 'Failed to fetch metric trend data' },
      { status: 500 },
    )
  }

  // ── Aggregate to one value per calendar day (take the last reading per day) ──

  const byDate = new Map<string, number>()
  for (const row of data ?? []) {
    const date = row.measured_at.slice(0, 10) // 'YYYY-MM-DD'
    byDate.set(date, row.metric_value)
  }

  const dataPoints = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))

  return NextResponse.json({
    metric_key: metricKey,
    days,
    dataPoints,
  })
}
