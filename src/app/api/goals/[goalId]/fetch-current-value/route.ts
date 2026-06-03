/**
 * GET /api/goals/[goalId]/fetch-current-value
 *
 * P31.X.2 / A2.1+ — Auto-fetch the current value for a Goal's primary metric.
 *
 * Works for measurement='auto' AND 'hybrid' (the auto half — FDE tops up the
 * non-automated portion via Submit Verdict).
 * Reads from already-cached ME data + DataForSEO live for brand_search_volume.
 *
 * Response (success):
 *   { ok: true, value: number, source: string, snapshot_date: string, label: string }
 *
 * Response (no data / unsupported):
 *   { ok: false, reason: string }
 *
 * Auth: session-cookie via requireGoalAccess
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGoalAccess } from '@/lib/strategy/auth-helpers'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import { PRIMARY_METRIC_CATALOG } from '@/types/strategy'

export async function GET(
  _req: Request,
  { params }: { params: { goalId: string } },
) {
  const access = await requireGoalAccess(params.goalId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const goal = access.row
  const clientId = goal.client_id

  if (!goal.primary_metric_key) {
    return NextResponse.json({ ok: false, reason: 'Goal has no primary_metric_key set' })
  }

  // Verify the metric supports auto-fetch
  const metricDef = PRIMARY_METRIC_CATALOG.find(m => m.key === goal.primary_metric_key)
  if (!metricDef) {
    return NextResponse.json({ ok: false, reason: `Unknown metric: ${goal.primary_metric_key}` })
  }
  if (metricDef.measurement === 'self_report') {
    return NextResponse.json({
      ok: false,
      reason: `"${metricDef.label_en}" is self-reported — enter the value manually`,
    })
  }

  const result = await autoFetchMetricValue(supabaseAdmin, clientId, goal.primary_metric_key)
  return NextResponse.json(result)
}
