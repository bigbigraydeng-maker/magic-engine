/**
 * POST /api/clients/[id]/onboarding/complete
 *
 * Self-serve onboarding Step 5: the client submits "I'm done". This is the
 * server-side completion action, NOT a client call to diagnostic/run — that
 * route stays paid-only, and the diagnostic (6 external collectors) is
 * expensive, so a naive guard flip would re-open a cost-DoS surface. Instead
 * the completion is triggered here under requireOnboardingClientAccess and runs
 * the baseline diagnostic via service role, deduped both against any
 * pending/running run AND against `clients.onboarding_completed_at` already
 * being set — so re-submitting (even sequentially, after the first run
 * finished) cannot spam full-price runs.
 *
 * Actions:
 *   1. Trigger the FIRST baseline diagnostic (before-report) — deduped against
 *      any pending/running run for this client, and skipped entirely once
 *      onboarding has already been completed once.
 *   2. Stamp clients.onboarding_completed_at.
 *   3. Best-effort FDE notification (which steps the client couldn't do), so the
 *      in-person kickoff (B2) goes straight to the unfinished steps.
 *
 * Body: { helpRequests?: string[] }  — labels of steps the client asked us to
 *        do on the visit ("我搞不定→上门帮我连"). Best-effort, never blocks.
 * Reference: Phase B $990 self-serve onboarding wizard spec (Step 5).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { createDiagnosticRun, executeDiagnosticRun } from '@/lib/diagnostic/runner'

/** Returns an existing pending/running diagnostic run id for this client, or null. */
async function findInFlightDiagnostic(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id')
    .eq('client_id', clientId)
    .in('status', ['pending', 'running'])
    .limit(1)
    .maybeSingle<{ id: string }>()
  if (error) {
    console.error('[onboarding/complete] in-flight diagnostic lookup failed', error)
    return null
  }
  return data?.id ?? null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const body = (await req.json().catch(() => ({}))) as { helpRequests?: unknown }
  const helpRequests = Array.isArray(body.helpRequests)
    ? body.helpRequests.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 20)
    : []

  // 0. Has this client already completed onboarding once? If so, a repeat
  //    submit must NOT enqueue another full-price diagnostic — only the
  //    in-flight check below (pending/running) is not enough, because a
  //    finished run flips to 'completed'/'failed' and drops out of that
  //    filter, making it deterministically replayable.
  const { data: clientRow, error: clientLookupErr } = await supabaseAdmin
    .from('clients')
    .select('onboarding_completed_at')
    .eq('id', clientId)
    .maybeSingle<{ onboarding_completed_at: string | null }>()
  if (clientLookupErr) {
    return NextResponse.json({ error: clientLookupErr.message }, { status: 500 })
  }
  const alreadyCompleted = Boolean(clientRow?.onboarding_completed_at)

  // 1. Trigger the baseline diagnostic — server-side, deduped so a repeat
  //    submit (in-flight or already-completed) reuses/skips instead of
  //    enqueuing another.
  let diagnosticRunId = await findInFlightDiagnostic(clientId)
  if (!diagnosticRunId && !alreadyCompleted) {
    try {
      diagnosticRunId = await createDiagnosticRun(supabaseAdmin, clientId, 'full')
      // Fire-and-forget: the run is long; the wizard polls diagnostic status.
      void executeDiagnosticRun(supabaseAdmin, diagnosticRunId, clientId, 'full').catch(err => {
        console.error('[onboarding/complete] baseline diagnostic failed', err)
      })
    } catch (err) {
      console.error('[onboarding/complete] could not start baseline diagnostic', err)
      // Non-fatal: completion still records; FDE can re-run the diagnostic.
    }
  }

  // 2. Stamp completion.
  const { error: stampErr } = await supabaseAdmin
    .from('clients')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', clientId)
  if (stampErr) {
    return NextResponse.json({ error: stampErr.message }, { status: 500 })
  }

  // 3. Best-effort FDE notification. Never blocks completion.
  if (helpRequests.length > 0) {
    const summary = `【自助 onboarding 完成】客户提交，需上门/远程帮忙的步骤：${helpRequests.join('、')}`
    await supabaseAdmin
      .from('fde_work_logs')
      .insert({
        client_id: clientId,
        log_date: new Date().toISOString().slice(0, 10),
        summary,
        author_email: (access.user.email ?? 'self-serve@magicengine.cloud').toLowerCase(),
      })
      .then(({ error }) => { if (error) console.error('[onboarding/complete] fde log failed', error) })
  }

  return NextResponse.json({ ok: true, diagnostic_run_id: diagnosticRunId, help_requests: helpRequests })
}
