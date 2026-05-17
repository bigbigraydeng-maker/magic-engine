import { NextRequest, NextResponse } from 'next/server'
import { runAttributionJob } from '@/lib/flywheel/attribution/job'

/**
 * POST /api/cron/attribution
 *
 * Runs the flywheel attribution job: for every flywheel_action with an
 * expected_metric, computes baseline / after / verdict and upserts a row
 * in flywheel_outcomes.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: every 6 hours (Render Cron)
 *
 * Query params (optional):
 *   window_days — override the default 14-day attribution window
 *   client_id   — restrict to a single client (useful for manual reruns)
 *
 * Reference: ROADMAP.md P12.A.9
 */

// Attribution job may process many clients; allow up to 5 min.
export const maxDuration = 300

export interface AttributionCronResponse {
  timestamp: string
  processed: number
  written: number
  skipped: number
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

  try {
    const result = await runAttributionJob({ windowDays, clientId })

    console.log(
      `[attribution/cron] processed=${result.processed} written=${result.written} skipped=${result.skipped}`
    )

    return NextResponse.json<AttributionCronResponse>(
      {
        timestamp: new Date().toISOString(),
        ...result,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[attribution/cron] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
