/**
 * GET /api/cron/ai-visibility-weekly
 *
 * Daily Industry AI Visibility collection cron.
 * Triggered by Render scheduled task every day at 02:30 UTC (≈14:30 NZST).
 *
 * Note on route name: the path still says "weekly" for backward compatibility
 * with PR #311. The actual cadence was changed to daily on 2026-06-04 (PM
 * decision — only daily granularity captures within-week brand churn).
 * Render cron entry: `industry-ai-visibility-daily` in render.yaml.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Runs all active questions across all platforms (chatgpt + google_ai_overview + google_serp).
 * One row written per (question, platform, collected_date) into industry_ai_visibility_snapshots.
 * UNIQUE constraint on (question_id, platform, collected_date) — re-runs within
 * the same UTC day refresh the row; first run on a new day appends.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runCollection } from '@/lib/industry-ai-visibility/orchestrator'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000 // 魏征 Hotfix-7 (was 10 min — too lenient)

/**
 * 魏征 Hotfix-2 + Hotfix-7: clear stale 'running' rows (>5 min) before kicking
 * off a fresh cron. Without this the partial unique index `iav_runs_single_in_flight`
 * would refuse the new run forever after one serverless worker death.
 */
async function sweepStaleRuns(): Promise<void> {
  const cutoffIso = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: 'Stuck in running > 10 min — auto-cleared by cron sweeper',
    })
    .eq('status', 'running')
    .lt('started_at', cutoffIso)
    .select('id')
  if (error) console.error('[cron/ai-visibility/sweeper] failed:', error)
  else if ((data ?? []).length > 0) console.log(`[cron/ai-visibility/sweeper] cleared ${data!.length} stale run(s)`)
}

// 500 questions × ~3-4s each = ~30min worst case. Render allows long jobs.
// Vercel maxDuration caps at 300s on Pro plan — but ME runs on Render
// for cron workloads so this is fine.
export const maxDuration = 600

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('industry-ai-visibility-daily')
  try {
    await sweepStaleRuns()
    const summary = await runCollection({ triggeredBy: 'cron' })
    const s = summary as unknown as Record<string, unknown>
    await cronRun.finish({
      processed: typeof s.total === 'number' ? s.total : undefined,
      completed: typeof s.succeeded === 'number' ? s.succeeded : undefined,
      failed:    typeof s.failed === 'number' ? s.failed : 0,
      summary:   s,
    })
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST for admin retry from UI (e.g., "rerun this week's batch")
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('industry-ai-visibility-daily')
  try {
    await sweepStaleRuns()
    const summary = await runCollection({ triggeredBy: 'admin_manual' })
    const s = summary as unknown as Record<string, unknown>
    await cronRun.finish({
      processed: typeof s.total === 'number' ? s.total : undefined,
      completed: typeof s.succeeded === 'number' ? s.succeeded : undefined,
      failed:    typeof s.failed === 'number' ? s.failed : 0,
      summary:   s,
    })
    return NextResponse.json(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
