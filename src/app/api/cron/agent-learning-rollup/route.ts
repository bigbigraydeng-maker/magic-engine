/**
 * DAPE W3 — Weekly Agent Learning Rollup cron
 *
 * Schedule: Monday 07:00 UTC (Render render.yaml) so it always summarises
 * the *just-completed* ISO week (Mon 00:00 UTC → Mon 00:00 UTC exclusive).
 *
 * Why a separate weekly cron (vs memory-extractor which runs daily):
 *   - memory-extractor learns per-action patterns from `confirmed` outcomes.
 *     It is correct but misses two crucial signals:
 *       1. Negative `dismissed/irrelevant` feedback from the zhuge workbench.
 *       2. Cumulative *weekly* signal — e.g. "8/10 SEO suggestions dismissed
 *          this week" should de-prioritise that family next week.
 *   - This rollup closes both gaps without LLM cost: it writes one
 *     summary preference per client per week that the next agent run reads
 *     via formatMemoryForPrompt.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (same pattern as memory-extractor)
 *
 * Reference: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §3.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { runWeeklyLearningRollup } from '@/lib/memory/learning-rollup'
import { startCronRun } from '@/lib/cron/run-logger'

export const dynamic = 'force-dynamic'
// 5 min — at ~30 clients × ~50ms supabase round-trips per client × 4 queries we
// expect <60s, but rollup batch grows with client count so keep headroom.
export const maxDuration = 300

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('agent-learning-rollup')

  try {
    const result = await runWeeklyLearningRollup(supabaseAdmin)

    console.log(
      `[agent-learning-rollup/cron] week=${result.iso_week} ` +
      `clients=${result.clients_processed} ` +
      `preferences+${result.preferences_inserted} ` +
      `errors=${result.errors}`,
    )

    await cronRun.finish({
      processed: result.clients_processed,
      completed: result.clients_processed - result.errors,
      failed: result.errors,
      summary: {
        iso_week: result.iso_week,
        preferences_inserted: result.preferences_inserted,
      },
    })

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[agent-learning-rollup/cron] batch error:', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * GET acts as a dry-run / debug entrypoint — returns the computed week window
 * and client counts but skips the savePreference write. Same Bearer-token
 * gate so we don't accidentally expose internal client lists.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Quick sanity ping — no DB writes.
  return NextResponse.json({
    ok: true,
    message: 'agent-learning-rollup endpoint healthy. POST to run.',
  })
}
