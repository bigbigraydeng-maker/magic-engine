/**
 * GET /api/cron/prospecting-sweep
 *
 * Hands-off outbound conveyor (Phase 35). Each fire advances the pipeline by
 * ONE bounded step so a single run never over-spends or outlives the timeout:
 *
 *   audit (5)  →  analyze (2)  →  draft (5)  →  discover 1 seed (~25)
 *
 * Priority drains existing work before pulling more businesses in. Over a day
 * of ~5-min fires it discovers every industry × NZ-city seed, audits, analyses
 * the qualified, and leaves ready-to-review email drafts in the queue. Sending
 * stays 100% human — a person approves every outreach email.
 *
 * Safety:
 *   - Auth: Authorization: Bearer ${CRON_SECRET}
 *   - Master switch: no-ops unless PROSPECTING_SWEEP_ENABLED === 'true', so the
 *     cron can ship dark and the PM turns spend on when ready.
 *   - Cost is bounded per fire (≤2 AI analyses ≈ $0.30) + by the cron schedule.
 *   - cron_run_logs breadcrumb via startCronRun.
 */

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  queueCounts, coverageByCombo,
  auditBatch, analyzeBatch, draftBatch, discoverAndInsert,
} from '@/lib/prospecting/pipeline'
import { pickStage, buildCombos, leastCoveredCombo } from '@/lib/prospecting/sweep'

// Analyze is the slow step (~2 min each); 2 per fire keeps us under the limit.
export const maxDuration = 300

const AUDIT_BATCH = 5
const ANALYZE_BATCH = 2
const DRAFT_BATCH = 5
const DISCOVER_LIMIT = 25

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (process.env.PROSPECTING_SWEEP_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'disabled', hint: 'set PROSPECTING_SWEEP_ENABLED=true to run' })
  }

  const cronRun = await startCronRun('prospecting-sweep')
  try {
    const counts = await queueCounts()
    const stage = pickStage(counts)
    let result: Record<string, unknown>

    if (stage === 'audit') {
      result = await auditBatch(AUDIT_BATCH)
    } else if (stage === 'analyze') {
      result = await analyzeBatch(ANALYZE_BATCH)
    } else if (stage === 'draft') {
      result = await draftBatch(DRAFT_BATCH)
    } else {
      const combo = leastCoveredCombo(buildCombos(), await coverageByCombo())
      result = combo
        ? { combo, ...(await discoverAndInsert({ ...combo, limit: DISCOVER_LIMIT })) }
        : { discovered: 0, inserted: 0 }
    }

    await cronRun.finish({ processed: 1, completed: 1, failed: 0, summary: { stage, ...result } })
    return NextResponse.json({ stage, counts, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
