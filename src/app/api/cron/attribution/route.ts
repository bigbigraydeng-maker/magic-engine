import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runAttributionJob } from '@/lib/flywheel/attribution/job'
import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'

/**
 * POST /api/cron/attribution
 *
 * Runs the flywheel attribution job in two passes:
 *
 *   Pass 1 (original) — flywheel_metrics-based attribution:
 *     For every flywheel_action with an expected_metric, computes baseline /
 *     after / verdict and upserts into flywheel_outcomes.
 *
 *   Pass 2 (P17.A.4) — GSC-based attribution:
 *     For every client with a connected GSC connector, runs GSC attribution
 *     for all SEO flywheel actions (clicks / impressions / avg_position).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: every 6 hours (Render Cron)
 *
 * Query params (optional):
 *   window_days — override the default 14-day attribution window (pass 1)
 *   client_id   — restrict both passes to a single client
 *
 * Reference: ROADMAP.md P12.A.9 (pass 1), P17.A.4 (pass 2)
 */

// Attribution job may process many clients; allow up to 5 min.
export const maxDuration = 300

export interface AttributionCronResponse {
  timestamp: string
  processed: number
  written: number
  skipped: number
  gsc?: {
    clients_processed: number
    outcomes_written: number
    skipped: number
    errors: string[]
  }
}

export interface ApiErrorResponse {
  error: string
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<AttributionCronResponse | ApiErrorResponse>> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 }
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)
  const windowDaysParam = searchParams.get('window_days')
  const clientId = searchParams.get('client_id') ?? undefined

  const windowDays =
    windowDaysParam !== null ? parseInt(windowDaysParam, 10) : undefined

  // ── Pass 1: flywheel_metrics-based attribution (existing) ──────────────────
  let pass1Result = { processed: 0, written: 0, skipped: 0 }
  try {
    pass1Result = await runAttributionJob({ windowDays, clientId })
    console.log(
      `[attribution/cron] pass1 processed=${pass1Result.processed} written=${pass1Result.written} skipped=${pass1Result.skipped}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[attribution/cron] Pass 1 error:', message)
    return NextResponse.json<ApiErrorResponse>({ error: message }, { status: 500 })
  }

  // ── Pass 2: GSC snapshot-based attribution (P17.A.4) ──────────────────────
  const gscResult = {
    clients_processed: 0,
    outcomes_written:  0,
    skipped:           0,
    errors:            [] as string[],
  }

  try {
    const clientIds = await loadGscClientIds(clientId)

    for (const cid of clientIds) {
      const r = await runGscAttributionForClient(cid)
      gscResult.clients_processed++
      gscResult.outcomes_written += r.outcomes_written
      gscResult.skipped           += r.skipped
      if (r.errors.length) gscResult.errors.push(...r.errors)
    }

    console.log(
      `[attribution/cron] pass2(gsc) clients=${gscResult.clients_processed} outcomes=${gscResult.outcomes_written} skipped=${gscResult.skipped}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error in GSC attribution pass'
    console.error('[attribution/cron] Pass 2 error:', message)
    gscResult.errors.push(message)
  }

  return NextResponse.json<AttributionCronResponse>(
    {
      timestamp: new Date().toISOString(),
      ...pass1Result,
      gsc: gscResult,
    },
    { status: 200 }
  )
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function loadGscClientIds(singleClientId?: string): Promise<string[]> {
  if (singleClientId) return [singleClientId]

  const { data, error } = await supabaseAdmin
    .from('client_connectors')
    .select('client_id')
    .eq('anchor', 'gsc')
    .eq('status', 'connected')

  if (error) {
    console.error('[attribution/cron] loadGscClientIds error:', error.message)
    return []
  }

  return (data ?? []).map((r: { client_id: string }) => r.client_id)
}
