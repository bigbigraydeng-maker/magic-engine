/**
 * GET /api/cron/seo-patrol-daily
 *
 * Daily cron — Phase 22.E.S2b
 *
 * Single-pass pipeline (the rule engine is deterministic, so unlike the
 * anomaly-detector there is no separate AI judgement step — findings are
 * already high-confidence rule output):
 *
 *   For each client with a domain:
 *     1. Read keyword_snapshots (current + prior) + gsc_performance_snapshots
 *     2. Run the SEO patrol rule engine → SeoPatrolFinding[]
 *     3. Persist fresh findings to seo_patrol_findings
 *     4. Convert top 3 findings → PriorityAction[] → persistZhugeActions()
 *        → pending execution_items appear on the SEO kanban column
 *
 * Runs after google-data-pullback-daily (3am) + keyword-snapshots-weekly so
 * the data is fresh. FDE (NZST/AEST morning) opens the kanban to find today's
 * recommended SEO actions already queued.
 *
 * Schedule: every day at 4am UTC (~4pm NZST / 2pm AEST)
 *           Render cron name: seo-patrol-daily
 *
 * Auth: Authorization: Bearer $CRON_SECRET
 *
 * Response:
 *   200 { success: true, ...SeoPatrolBatchResult }
 *   401 Unauthorized
 *   500 Server misconfiguration / unhandled error
 *
 * Reference: ROADMAP.md § Phase 22.E · docs/seo-sop-implementation-design.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { runSeoPatrol, type SeoPatrolBatchResult } from '@/lib/seo-patrol/job'
import { expireStaleDrafts } from '@/lib/blog/draft-expiry'
import { supersedeStaleZhugeCards } from '@/lib/zhuge/card-expiry'
import { startCronRun } from '@/lib/cron/run-logger'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
// Sequential per-client DB reads + persister writes. Allow 5 min.
export const maxDuration = 300

interface CronResponse extends SeoPatrolBatchResult {
  success: true
  timestamp: string
}

interface ErrorResponse {
  error: string
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<CronResponse | ErrorResponse>> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json<ErrorResponse>({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('seo-patrol-daily')
  const timestamp = new Date().toISOString()

  try {
    const result = await runSeoPatrol()
    console.log(
      `[seo-patrol/cron] clients=${result.clients_processed} ` +
        `findings=${result.total_findings} actions=${result.total_actions} ` +
        `failed=${result.failed}`,
    )

    // To-do hygiene (22.E.S18 前置): drafts untouched >30d auto-expire,
    // zhuge cards pending >14d auto-supersede. Non-blocking — a hygiene
    // failure must not fail the patrol.
    let hygiene: { drafts_expired: number; cards_superseded: number } | { error: string }
    try {
      const [drafts, cards] = await Promise.all([
        expireStaleDrafts(supabaseAdmin),
        supersedeStaleZhugeCards(supabaseAdmin),
      ])
      hygiene = { drafts_expired: drafts.expired, cards_superseded: cards.superseded }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[seo-patrol/cron] hygiene failed (non-blocking):', message)
      hygiene = { error: message }
    }

    await cronRun.finish({
      processed: result.clients_processed,
      completed: result.clients_processed - result.failed,
      failed: result.failed,
      summary: {
        total_findings: result.total_findings,
        total_actions: result.total_actions,
        hygiene,
      },
    })
    return NextResponse.json<CronResponse>({ success: true, timestamp, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[seo-patrol/cron] unhandled error:', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json<ErrorResponse>({ error: message }, { status: 500 })
  }
}
