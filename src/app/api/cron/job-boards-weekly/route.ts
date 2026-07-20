/**
 * GET /api/cron/job-boards-weekly
 *
 * Phase 35 · job-signal discovery. Once a week, harvest NZ marketing-role job
 * postings (Seek), drop agencies/recruiters, resolve each hiring company to a
 * real business via Google Places (high-confidence only), and insert new ones
 * as `discovered` (discovery_source='job_board'). The existing prospecting-
 * sweep then audits / analyses / drafts them — this cron only feeds the top.
 *
 * Safety:
 *   - Auth: Authorization: Bearer ${CRON_SECRET}
 *   - Master switch: no-ops unless JOB_SIGNAL_INGEST_ENABLED === 'true', so it
 *     ships dark and never touches real companies until the PM turns it on.
 *   - Sending stays 100% human downstream — this only fills the discovered queue.
 *   - cron_run_logs breadcrumb via startCronRun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import { ingestJobSignals } from '@/lib/prospecting/job-boards/ingest'

export const maxDuration = 300

// Cap postings pulled per run so one fire stays bounded in time and Places cost.
const MAX_PER_BOARD = 150

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.JOB_SIGNAL_INGEST_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'disabled', hint: 'set JOB_SIGNAL_INGEST_ENABLED=true to run' })
  }

  const cronRun = await startCronRun('job-boards-weekly')
  try {
    const result = await ingestJobSignals({ boards: ['seek'], maxPerBoard: MAX_PER_BOARD })
    await cronRun.finish({
      processed: result.companies,
      completed: result.inserted,
      failed: result.skipped.unresolved,
      summary: {
        scraped: result.scraped, after_noise_filter: result.after_noise_filter,
        companies: result.companies, resolved: result.resolved, inserted: result.inserted,
        skipped: result.skipped,
      },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
