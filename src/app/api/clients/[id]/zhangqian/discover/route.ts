/**
 * POST /api/clients/[id]/zhangqian/discover
 *
 * Dispatch 张骞 Zhangqian Discovery Agent for a client. Returns 202 immediately
 * with a job_id; the agent runs in the background and writes results to
 * `client_discovery` when done. Poll `/zhangqian/status?job_id=...` for progress.
 *
 * Body: {} (domain comes from the clients table)
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.8
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { createDiscoveryJob, getActiveJob, failJob, closeStaleActiveJobs } from '@/lib/zhangqian/persistor'
import { precheckCharge } from '@/lib/mtc/charge'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { buildDiscoveryRequestedEvent } from '@/lib/zhangqian/discovery-events'
import { ZHANGQIAN_SERVICE_KEY } from '@/lib/zhangqian/run-discovery-job'

// The agent runs in the Inngest function `cloud-zhangqian-discovery`; this handler returns in <1s
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {

    // Resolve domain from clients table
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id, domain, semrush_db')
      .eq('id', clientId)
      .single<{ id: string; domain: string; semrush_db: string | null }>()

    if (clientErr || !client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }
    if (!client.domain) {
      return NextResponse.json(
        { success: false, error: 'Client has no domain configured' },
        { status: 400 },
      )
    }

    // A run is already in flight (e.g. the page was refreshed): hand back that job
    // instead of starting — and charging for — a second one.
    const active = await getActiveJob(supabaseAdmin, clientId)
    if (active) {
      return NextResponse.json(
        { success: true, job_id: active.id, domain: client.domain, already_running: true },
        { status: 202 },
      )
    }

    // Nothing live is left, so any pending/running row is stale; free the slot.
    await closeStaleActiveJobs(supabaseAdmin, clientId)

    // MTC precheck — admin bypasses the deduction (internal QA runs shouldn't
    // burn the client's balance). Real users (paid_client / self_serve) get
    // charged 60 MTC; the signup bonus covers the first run for free signups.
    const isAdminCall = access.tier === 'admin'
    let projectedMtc = 0
    if (!isAdminCall) {
      const precheck = await precheckCharge(clientId, ZHANGQIAN_SERVICE_KEY)
      if (!precheck.ok) {
        return NextResponse.json(precheck.body, { status: precheck.status })
      }
      projectedMtc = precheck.projectedMtc
    }

    // Create job synchronously so we can return its id immediately
    const jobId = await createDiscoveryJob(supabaseAdmin, clientId, client.domain)

    // Hand the run to Inngest (fail-closed: no event = no run). MTC is only
    // committed by the worker on success, so a failed hand-off costs nothing.
    try {
      await sendInngestEvent(
        buildDiscoveryRequestedEvent(
          {
            job_id: jobId,
            client_id: clientId,
            domain: client.domain,
            semrush_db: client.semrush_db,
            projected_mtc: projectedMtc,
          },
          new Date().toISOString(),
        ),
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[zhangqian/discover] could not hand the run to Inngest', message)
      await failJob(supabaseAdmin, jobId, `Could not start the run: ${message}`)
      return NextResponse.json(
        { success: false, error: 'Failed to dispatch Zhangqian' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { success: true, job_id: jobId, domain: client.domain },
      { status: 202 },
    )
  } catch (err: unknown) {
    console.error('[zhangqian/discover] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to dispatch Zhangqian' },
      { status: 500 },
    )
  }
}
