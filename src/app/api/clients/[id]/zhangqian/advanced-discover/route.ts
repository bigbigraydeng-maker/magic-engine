/**
 * POST /api/clients/[id]/zhangqian/advanced-discover
 *
 * Dispatch the Advanced Discovery Agent for a client. Returns 202 immediately
 * with a job_id; the agent runs in the background and merges results into
 * client_discovery.payload.advanced when done.
 *
 * Prerequisites: a basic discovery must exist for the client.
 * Poll the same /zhangqian/status?job_id=... endpoint for progress.
 *
 * Body: { triggered_by?: string }  (connector anchor, e.g. 'meta-ads')
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.22
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { runZhangqianAdvanced } from '@/lib/zhangqian/advanced-agent'
import {
  createDiscoveryJob,
  updateJobProgress,
  mergeAdvancedPayload,
  failJob,
  getLatestDiscovery,
} from '@/lib/zhangqian/persistor'

// Render — agent runs fire-and-forget; handler returns in <1s
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId } = params

  let triggeredBy = 'unknown'
  let siteUrl: string | undefined
  try {
    const body = await req.json() as { triggered_by?: string; site_url?: string }
    triggeredBy = body.triggered_by ?? 'unknown'
    siteUrl = body.site_url
  } catch {
    // No body — fine, keep defaults
  }

  // Resolve client domain
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, domain')
    .eq('id', clientId)
    .single<{ id: string; domain: string }>()

  if (clientErr || !client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
  }
  if (!client.domain) {
    return NextResponse.json(
      { success: false, error: 'Client has no domain configured' },
      { status: 400 },
    )
  }

  // Guard: basic discovery must exist before advanced can run
  const basicDiscovery = await getLatestDiscovery(supabaseAdmin, clientId).catch(() => null)
  if (!basicDiscovery) {
    return NextResponse.json(
      { success: false, error: 'No basic discovery found. Run the basic discovery first.' },
      { status: 409 },
    )
  }

  // Create job row (reuses client_discovery_jobs with job_type='advanced')
  const jobId = await createDiscoveryJob(supabaseAdmin, clientId, client.domain, 'advanced')

  // Fire-and-forget background execution
  void executeAdvancedDiscoveryJob(
    jobId,
    clientId,
    client.domain,
    basicDiscovery.payload,
    triggeredBy,
    siteUrl,
  ).catch((err: unknown) => {
    console.error('[zhangqian/advanced-discover] background failure', err)
  })

  return NextResponse.json(
    { success: true, job_id: jobId, domain: client.domain },
    { status: 202 },
  )
}

// ─── Background executor ─────────────────────────────────────────────────────

async function executeAdvancedDiscoveryJob(
  jobId: string,
  clientId: string,
  domain: string,
  basicReport: import('@/lib/zhangqian/types').DiscoveryReport,
  triggeredBy: string,
  siteUrl?: string,
): Promise<void> {
  await updateJobProgress(supabaseAdmin, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    progress_note: '高级发现已启动…',
  })

  try {
    const advancedPayload = await runZhangqianAdvanced(
      domain,
      basicReport,
      triggeredBy,
      async (note) => {
        await updateJobProgress(supabaseAdmin, jobId, { progress_note: note })
      },
      siteUrl,
      clientId,
    )

    await mergeAdvancedPayload(supabaseAdmin, clientId, advancedPayload)

    await supabaseAdmin
      .from('client_discovery_jobs')
      .update({
        status: 'completed',
        progress_note: '高级发现完成。',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await failJob(supabaseAdmin, jobId, `Advanced discovery error: ${message}`)
  }
}
