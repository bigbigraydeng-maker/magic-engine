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
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  queueCounts, lastDiscoverAttemptByCombo,
  auditBatch, analyzeBatch, draftBatch, discoverAndInsert,
} from '@/lib/prospecting/pipeline'
import { pickStage, buildCombos, pickDiscoverCombo } from '@/lib/prospecting/sweep'

// Analyze is the slow step (~2 min each); 2 per fire keeps us under the limit.
export const maxDuration = 300

const AUDIT_BATCH = 5
const ANALYZE_BATCH = 2
const DRAFT_BATCH = 5
const DISCOVER_LIMIT = 25
// Hard daily ceiling on paid AI analyses (~$0.15 each → ≤ ~$15/day). Once hit,
// the sweep skips the analyze step (still audits / drafts / discovers) until
// the rolling 24h window clears. Raised 40→100 on 2026-07-10 (PM go) to lift
// how many prospects reach "ready to send" per day.
const DAILY_ANALYZE_CAP = 100
// Re-discover each industry×city seed at most once per this window. Rotates the
// sweep across all seeds and idles once the universe is covered, instead of
// re-hammering one saturated seed every fire (2026-07-10 stuck-loop cost fix).
const DISCOVER_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** AI analyses run by this cron in the last 24h, summed from cron_run_logs. */
async function analyzedLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabaseAdmin
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', 'prospecting-sweep')
    .gte('finished_at', since)
  return (data ?? []).reduce(
    (n, r) => n + (Number((r.summary as { analyzed?: number } | null)?.analyzed) || 0),
    0,
  )
}

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
    const analyzeAllowed = (await analyzedLast24h()) < DAILY_ANALYZE_CAP
    const stage = pickStage(counts, analyzeAllowed)
    let result: Record<string, unknown>

    if (stage === 'audit') {
      result = await auditBatch(AUDIT_BATCH)
    } else if (stage === 'analyze') {
      result = await analyzeBatch(ANALYZE_BATCH)
    } else if (stage === 'draft') {
      result = await draftBatch(DRAFT_BATCH)
    } else {
      const combo = pickDiscoverCombo(
        buildCombos(), await lastDiscoverAttemptByCombo(), Date.now(), DISCOVER_COOLDOWN_MS,
      )
      result = combo
        ? { combo, ...(await discoverAndInsert({ ...combo, limit: DISCOVER_LIMIT })) }
        : { discovered: 0, inserted: 0, skipped: 'all seeds discovered within cooldown' }
    }

    await cronRun.finish({ processed: 1, completed: 1, failed: 0, summary: { stage, ...result } })
    return NextResponse.json({ stage, counts, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
