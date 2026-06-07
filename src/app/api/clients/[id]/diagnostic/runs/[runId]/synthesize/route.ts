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

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; runId: string } },
): Promise<NextResponse> {
  const { id: clientId, runId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
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
