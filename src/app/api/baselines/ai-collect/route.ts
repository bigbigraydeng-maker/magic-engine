/**
 * POST /api/baselines/ai-collect — manually trigger a collection run (admin only).
 *
 * Body (optional):
 *   industries: string[]       — restrict to these industries (default: all active)
 *   platforms:  string[]       — restrict to these platforms (default: chatgpt + google_*)
 *   limit:      number         — cap N questions (testing)
 *   sync:       boolean        — wait for completion (legacy; default false → fire-and-forget)
 *
 * Behaviour:
 *   - Default (async / 202): create ONE run row, return { run_id } immediately,
 *     then fire-and-forget runCollection({ existingRunId }) in the background.
 *     UI polls /api/baselines/cron-runs to track status. This avoids Render's
 *     60-90s edge timeout for batches > ~10 questions which used to surface
 *     as "Unexpected token '<', '<!DOCTYPE'" HTML in the browser.
 *   - sync=true (200): legacy synchronous mode for tests / small batches.
 *
 * Concurrency guard (魏征 P1 fix): if a run created in the last 5 minutes is
 * still 'running', return 409 instead of starting a duplicate (prevents PM
 * double-click from burning DataForSEO + Haiku cost twice).
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runCollection, createRunRow } from '@/lib/industry-ai-visibility/orchestrator'
import { supabaseAdmin } from '@/lib/supabase'
import type { Platform } from '@/lib/industry-ai-visibility/types'

export const maxDuration = 300  // Vercel hint; Render hosts ignore but still safe

interface RequestBody {
  industries?: string[]
  platforms?:  Platform[]
  limit?:      number
  sync?:       boolean
}

const CONCURRENCY_WINDOW_MS = 5 * 60 * 1000  // 5 minutes
const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes — 魏征 Hotfix-2 sweeper

/**
 * 魏征 Hotfix-2: clear runs stuck in 'running' for > 10 minutes. These come
 * from serverless workers being killed mid-collection. Without this, the
 * partial unique index would block all future runs forever.
 *
 * Runs synchronously on each ai-collect entry (cheap — one indexed UPDATE)
 * so we don't need to register a separate sweeper cron.
 */
async function sweepStaleRuns(): Promise<number> {
  const cutoffIso = new Date(Date.now() - STALE_RUN_THRESHOLD_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: `Stuck in running > 10 min — auto-cleared by ai-collect sweeper`,
    })
    .eq('status', 'running')
    .lt('started_at', cutoffIso)
    .select('id')
  if (error) {
    console.error('[ai-collect/sweeper] failed:', error)
    return 0
  }
  const n = (data ?? []).length
  if (n > 0) console.log(`[ai-collect/sweeper] cleared ${n} stale run(s)`)
  return n
}

export async function POST(req: Request) {
  const admin = await requireAdmin()
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: RequestBody = {}
  try {
    body = await req.json() as RequestBody
  } catch {
    // empty body is fine — defaults will apply
  }

  // 魏征 Hotfix-2: clear any stale 'running' rows first (else the partial
  // unique index would block all new runs after one worker death).
  await sweepStaleRuns()

  // 魏征 P1: concurrency guard — refuse if a run is already in flight
  const sinceIso = new Date(Date.now() - CONCURRENCY_WINDOW_MS).toISOString()
  const { data: inFlight } = await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .select('id, started_at')
    .eq('status', 'running')
    .gte('started_at', sinceIso)
    .limit(1)
    .maybeSingle()

  if (inFlight) {
    return NextResponse.json(
      {
        error: 'A collection run is already in flight',
        existing_run_id: inFlight.id,
        started_at: inFlight.started_at,
        hint: 'Wait for it to finish (~1-3 min) or check /api/baselines/cron-runs',
      },
      { status: 409 },
    )
  }

  const runOpts = {
    industries: body.industries,
    platforms:  body.platforms,
    limit:      body.limit,
    triggeredBy: 'admin_manual' as const,
    triggeredByUser: admin.user.email ?? undefined,
  }

  // ─── Sync path (legacy / tests / very small batches) ───────────────────────
  if (body.sync === true) {
    try {
      const summary = await runCollection(runOpts)
      return NextResponse.json(summary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ─── Async path (default) ──────────────────────────────────────────────────
  // 魏征 P0: create exactly ONE run row up-front and pass it to runCollection
  // via `existingRunId`. The previous design (pre-create placeholder +
  // orchestrator creates its own) produced TWO rows per logical collection
  // and polluted the cron-runs panel with phantom rows.
  let runId: string
  try {
    runId = await createRunRow(runOpts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to start run: ${msg}` }, { status: 500 })
  }

  // Kick off the real work reusing the run_id we just created.
  // NOTE: this promise may be killed mid-flight on serverless hosts. The
  // stale-run sweeper (Hotfix-2 cron) resets rows stuck > 10 min.
  void runCollection({ ...runOpts, existingRunId: runId })
    .catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ai-collect] background runCollection failed:', msg)
      // Best-effort: ensure the run row terminates instead of staying 'running'.
      void supabaseAdmin
        .from('industry_ai_visibility_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Background run failed: ${msg}`,
        })
        .eq('id', runId)
        .then(() => undefined)
    })

  // 202 Accepted — the work is queued, poll cron-runs for progress
  return NextResponse.json(
    {
      run_id: runId,
      status: 'queued',
      message: 'Collection started in background. Poll /api/baselines/cron-runs for progress.',
    },
    { status: 202 },
  )
}
