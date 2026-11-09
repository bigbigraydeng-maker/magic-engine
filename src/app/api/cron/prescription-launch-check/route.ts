/**
 * GET /api/cron/prescription-launch-check
 *
 * Every two hours, write the plain-language 24h / 48h / day-7 / day-14
 * check for prescriptions that already have a live ad. Reads our own
 * tables only. Does not call Meta, pause, change a budget, or spend.
 *
 * Not an Inngest function: one synchronous read then a local write, same
 * shape as kpi-backfill. There is no second step and no external side effect.
 *
 * A two-hour row in ad_entity_snapshots is not written here. That table's
 * capture_reason check does not allow the label, and adding it would be a migration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { runPrescriptionLaunchCheck } from '@/lib/ads/prescription-launch-check-store'

export const maxDuration = 120

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('prescription-launch-check')
  try {
    const receipt = await runPrescriptionLaunchCheck(new Date())
    const summary: Record<string, unknown> = { ...receipt }
    await cronRun.finish({
      processed: receipt.prescriptions_checked,
      completed: receipt.prescriptions_checked,
      failed: receipt.failed,
      summary,
    })
    return NextResponse.json({ success: true, ...receipt })
  } catch {
    await cronRun.finish({ failed: 1, error: 'launch check failed' })
    return NextResponse.json({ error: 'launch check failed' }, { status: 500 })
  }
}
