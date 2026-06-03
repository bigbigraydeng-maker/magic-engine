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
 *   - Default (async / 202): create run row, kick off runCollection() in the
 *     background, return { run_id } immediately. The UI polls
 *     /api/baselines/cron-runs to track status. This avoids Render's
 *     60-90s edge timeout for batches > ~10 questions which used to surface
 *     as "Unexpected token '<', '<!DOCTYPE'" HTML in the browser.
 *   - sync=true (200): legacy synchronous mode for tests / small batches.
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { runCollection } from '@/lib/industry-ai-visibility/orchestrator'
import { supabaseAdmin } from '@/lib/supabase'
import type { Platform } from '@/lib/industry-ai-visibility/types'

export const maxDuration = 300  // Vercel hint; Render hosts ignore but still safe

interface RequestBody {
  industries?: string[]
  platforms?:  Platform[]
  limit?:      number
  sync?:       boolean
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
  // Pre-create the run row so the client gets a real run_id immediately.
  // runCollection() also tries to create one — but our pre-created row gives
  // the UI something to poll even if the background promise dies in transit.
  const isoNow = new Date().toISOString()
  const { data: stub, error: stubErr } = await supabaseAdmin
    .from('industry_ai_visibility_runs')
    .insert({
      started_at: isoNow,
      week_of: isoNow.slice(0, 10),
      status: 'running',
      industries_scope: body.industries ?? null,
      platforms_scope:  body.platforms ?? ['chatgpt', 'google_ai_overview', 'google_serp'],
      triggered_by:     'admin_manual',
      triggered_by_user: admin.user.email ?? null,
    })
    .select('id')
    .single()

  if (stubErr || !stub) {
    return NextResponse.json(
      { error: `Failed to create run row: ${stubErr?.message}` },
      { status: 500 },
    )
  }

  const placeholderRunId = stub.id as string

  // Kick off the real work — runCollection creates its OWN row (kept for
  // backward compat; the placeholder row will be marked 'failed' on
  // background error so the UI sees something terminate).
  // NOTE: this promise may be killed mid-flight on serverless hosts. The
  // worst case is the run_id stays `running` until the next cron tick or
  // an admin clears it; that's strictly better than the previous "HTML
  // error in the browser, no DB trail" failure mode.
  void runCollection(runOpts)
    .then(summary => {
      // Mark the placeholder row as completed and link to the real run id
      // (best-effort — the real run row is the canonical record).
      void supabaseAdmin
        .from('industry_ai_visibility_runs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          questions_attempted: summary.questions_attempted,
          questions_ok:        summary.questions_ok,
          questions_failed:    summary.questions_failed,
          snapshots_written:   summary.snapshots_written,
          total_cost_usd:      summary.total_cost_usd,
          duration_seconds:    summary.duration_seconds,
          error_message:       `Linked to real run ${summary.run_id}`,
        })
        .eq('id', placeholderRunId)
        .then(() => undefined)
    })
    .catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[ai-collect] background runCollection failed:', msg)
      void supabaseAdmin
        .from('industry_ai_visibility_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: `Background run failed: ${msg}`,
        })
        .eq('id', placeholderRunId)
        .then(() => undefined)
    })

  // 202 Accepted — the work is queued, poll cron-runs for progress
  return NextResponse.json(
    {
      run_id: placeholderRunId,
      status: 'queued',
      message: 'Collection started in background. Poll /api/baselines/cron-runs for progress.',
    },
    { status: 202 },
  )
}
