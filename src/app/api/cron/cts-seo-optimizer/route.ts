import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * POST /api/cron/cts-seo-optimizer — RETIRED, inert.
 *
 * Retired 2026-09-20 (replaced by the Inngest meta-cycle), but on
 * 2026-09-28 05:31 UTC it still ran and auto-merged chinatravel#213 with
 * three wrong titles and no information-completeness gate. Cause: removing
 * a cron block from render.yaml does not delete the Render cron service,
 * and that service still carried the one-off schedule "30 5 28 9 *".
 *
 * "Kept for rollback" is how it got back in, so this route no longer runs
 * anything. Any call is recorded as a failed cron run (so the daily check
 * surfaces it) and answered 410. Rollback means restoring the old handler
 * from git history in a reviewed PR, not calling this URL.
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const error = 'cts-seo-optimizer is retired (2026-09-20); refusing to run. Delete the Render cron service that still calls it.'
  const cronRun = await startCronRun('cts-seo-optimizer')
  await cronRun.finish({ failed: 1, error })
  return NextResponse.json({ success: false, error }, { status: 410 })
}
