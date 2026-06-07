/**
 * POST /api/clients/[id]/diagnostic/runs/[runId]/synthesize
 *
 * Manually re-runs the Synthesis Orchestrator for a specific diagnostic run.
 * BYPASSES the 24h per-client rate limit (force: true) — intended as the FDE
 * "regenerate narratives" button on the report page, plus a backfill path for
 * historical runs that were created before the orchestrator existed.
 *
 * Returns the per-module status (ok / skipped / failed) so the UI can tell
 * FDE what actually got written. Total cost is also returned for ops review.
 *
 * Security: Bearer token (INTERNAL_API_KEY) via requirePaidClientAccess —
 * synthesis is an LLM spend, must not be exposed to unauthenticated callers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { rerunSynthesisForRun } from '@/lib/diagnostic/synthesis-orchestrator'

/**
 * 狄仁杰 review HIGH — request-level throttle.
 *
 * The auto-synthesis 24h gate inside the orchestrator does NOT apply here
 * (this endpoint passes force=true). Without an independent throttle, a
 * stolen Bearer token could POST in a tight loop and rack up LLM cost at
 * ~$1.50/call. 3 manual calls/hour is comfortable for legitimate FDE
 * "regenerate narratives" usage (one click after a fix, maybe two retries)
 * and caps abuse at ~$4.50/hour/client even if a token leaks.
 */
const MANUAL_THROTTLE_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MANUAL_THROTTLE_MAX_CALLS = 3

async function checkManualThrottle(clientId: string): Promise<{
  ok: boolean
  retryAfterSeconds?: number
}> {
  const cutoffIso = new Date(Date.now() - MANUAL_THROTTLE_WINDOW_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('diagnostic_narratives')
    .select('generated_at')
    .eq('client_id', clientId)
    .gte('generated_at', cutoffIso)
    .order('generated_at', { ascending: true })

  if (error) {
    // Fail-closed (狄仁杰 HIGH#2 pattern) — refuse manual rerun if we can't
    // verify the rate. FDE can wait or contact ops; better than uncapped spend.
    console.warn(
      `[synthesize] throttle check failed for client ${clientId}, fail-closed:`,
      error.message,
    )
    return { ok: false, retryAfterSeconds: 60 }
  }

  const recent = data ?? []
  if (recent.length < MANUAL_THROTTLE_MAX_CALLS) return { ok: true }

  // Tell the caller when the oldest slot frees up.
  const oldestIso = (recent[0] as { generated_at: string }).generated_at
  const oldestMs = new Date(oldestIso).getTime()
  const freesAtMs = oldestMs + MANUAL_THROTTLE_WINDOW_MS
  const retryAfterSeconds = Math.max(1, Math.ceil((freesAtMs - Date.now()) / 1000))
  return { ok: false, retryAfterSeconds }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; runId: string } },
): Promise<NextResponse> {
  const { id: clientId, runId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Throttle BEFORE doing any expensive work (DB lookups / LLM calls).
  const throttle = await checkManualThrottle(clientId)
  if (!throttle.ok) {
    return NextResponse.json(
      {
        success: false,
        error: `Too many manual regenerate calls. Try again in ${throttle.retryAfterSeconds}s.`,
        retry_after_seconds: throttle.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(throttle.retryAfterSeconds ?? 60) },
      },
    )
  }

  // Confirm the run actually belongs to this client before we spend LLM tokens.
  const { data: run, error: runErr } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id, status')
    .eq('id', runId)
    .eq('client_id', clientId)
    .single()

  if (runErr || !run) {
    return NextResponse.json(
      { success: false, error: 'Run not found' },
      { status: 404 },
    )
  }

  if ((run as { status: string }).status !== 'completed') {
    return NextResponse.json(
      { success: false, error: `Run is not completed (status=${(run as { status: string }).status})` },
      { status: 409 },
    )
  }

  try {
    const result = await rerunSynthesisForRun(supabaseAdmin, runId, clientId)
    return NextResponse.json({
      success: true,
      ran: result.ran,
      skipped_reason: result.skipped_reason ?? null,
      modules: result.modules,
      total_cost_usd: result.total_cost_usd,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[diagnostic/runs/synthesize] orchestrator threw:', message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
