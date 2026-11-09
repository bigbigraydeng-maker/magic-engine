/**
 * GET /api/cron/goals-expiry-check
 *
 * Runs daily. Two steps in order:
 *   1. flagExpiredGoals — active goals whose period_end is in the past → 'expired'
 *      (so FDE sees "该填 verdict 了" in the UI).
 *   2. rolloverMonthlyGoals — for every recurrence='monthly' goal whose period
 *      has ended, create the next natural month's goal (status='active', values
 *      reset) so consumers like the ads autonomy engine never lose their target
 *      reference. Idempotent — running twice a day never double-creates.
 *
 * Auth: Bearer ${CRON_SECRET}
 * Query params:
 *   dry_run=1  compute what would happen, write nothing (used for trial run)
 *
 * 调度：GitHub Actions（.github/workflows/goals-expiry-check.yml），声明 03:30 UTC
 * 触发（`30 3 * * *`）——实测触发时刻会飘，见该 workflow 文件和 src/lib/cron/registry.ts
 * 里的登记，不要拿 03:30 UTC 当"没跑就是坏了"的判据。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { flagExpiredGoals } from '@/lib/strategy/verdict'
import { rolloverMonthlyGoals } from '@/lib/strategy/goal-rollover'
import { startCronRun } from '@/lib/cron/run-logger'

export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryParam = req.nextUrl.searchParams.get('dry_run')
  const dryRun = dryParam === '1' || dryParam === 'true'

  // dry_run writes nothing at all — including the cron_run_logs row.
  const realRun = await (dryRun ? Promise.resolve(null) : startCronRun('goals-expiry-check'))
  const cronRun = {
    finish: async (arg: Parameters<NonNullable<typeof realRun>['finish']>[0]) => { if (realRun) await realRun.finish(arg) },
  }

  // Step 1 — flag expired. Skip in dry-run so we don't mutate.
  const flagResult = dryRun
    ? { flagged_count: 0 }
    : await flagExpiredGoals(supabaseAdmin)

  if ('error' in flagResult && flagResult.error) {
    await cronRun.finish({ failed: 1, error: flagResult.error })
    return NextResponse.json({ error: flagResult.error, step: 'flag_expired' }, { status: 500 })
  }

  // Step 2 — rollover monthly recurring goals.
  const rolloverResult = await rolloverMonthlyGoals(supabaseAdmin, { dryRun })

  if (rolloverResult.error) {
    await cronRun.finish({
      processed: flagResult.flagged_count + rolloverResult.rolled.length,
      failed: 1,
      error: rolloverResult.error,
      // Partial success still leaves rows behind — keep them visible in the receipt.
      summary: {
        flagged_expired: flagResult.flagged_count,
        rollover_rolled: rolloverResult.rolled.map(r => ({ client_id: r.client_id, metric: r.primary_metric_key, period_start: r.next_period_start, target_value: r.target_value })),
        rollover_skipped_existing: rolloverResult.skipped_existing.length,
      },
    })
    return NextResponse.json({
      error: rolloverResult.error,
      step: 'rollover_monthly',
      flag_result: flagResult,
      rollover_partial: {
        rolled: rolloverResult.rolled.length,
        skipped_existing: rolloverResult.skipped_existing.length,
      },
    }, { status: 500 })
  }

  const processed = flagResult.flagged_count + rolloverResult.rolled.length
  await cronRun.finish({
    processed,
    completed: processed,
    failed: 0,
    // Rollover detail so a successful run's audit trail lives in cron_run_logs,
    // not only in this response body (which nothing else persists).
    summary: {
      flagged_expired: flagResult.flagged_count,
      rollover_rolled: rolloverResult.rolled.map(r => ({ client_id: r.client_id, metric: r.primary_metric_key, period_start: r.next_period_start, target_value: r.target_value, skipped_past_months: r.skipped_past_months })),
      rollover_skipped_existing: rolloverResult.skipped_existing.length,
    },
  })

  return NextResponse.json({
    success: true,
    dry_run: dryRun,
    flagged_count: flagResult.flagged_count,
    rollover: {
      planned: rolloverResult.planned.length,
      rolled: rolloverResult.rolled.length,
      skipped_existing: rolloverResult.skipped_existing.length,
      // Include the plans so PM / on-call can see who moves to what next month.
      details: dryRun ? rolloverResult.planned : rolloverResult.rolled,
    },
    note: buildNote(flagResult.flagged_count, rolloverResult, dryRun),
  })
}

function buildNote(
  flaggedCount: number,
  rollover: { rolled: unknown[]; skipped_existing: unknown[]; planned: unknown[] },
  dryRun: boolean,
): string {
  const parts: string[] = []
  if (dryRun) parts.push('[dry_run — no writes]')
  parts.push(flaggedCount > 0
    ? `${flaggedCount} goal(s) moved active → expired`
    : 'No goals expired today')
  if (dryRun) {
    parts.push(rollover.planned.length > 0
      ? `would roll over ${rollover.planned.length} monthly goal(s); ${rollover.skipped_existing.length} already have successors`
      : 'no monthly rollover needed')
  } else {
    parts.push(rollover.rolled.length > 0
      ? `rolled over ${rollover.rolled.length} monthly goal(s) to next natural month`
      : 'no monthly rollover needed')
    if (rollover.skipped_existing.length > 0) {
      parts.push(`skipped ${rollover.skipped_existing.length} monthly goal(s) — successor already exists`)
    }
  }
  return parts.join('; ')
}
