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
 * Security: session-cookie via requireDashboardClientAccess (Phase 19 pattern)
 * Reference: ROADMAP.md P8.10.S0.22
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  StartAdvancedDiscoveryError,
  startAdvancedDiscovery,
} from '@/lib/zhangqian/start-advanced-discovery'

// Render agent runs fire-and-forget; handler returns in <1s
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let triggeredBy = 'unknown'
  let siteUrl: string | undefined
  try {
    const body = await req.json() as { triggered_by?: string; site_url?: string }
    triggeredBy = body.triggered_by ?? 'unknown'
    siteUrl = body.site_url
  } catch {
    // No body; keep defaults.
  }

  try {
    const result = await startAdvancedDiscovery(supabaseAdmin, clientId, {
      triggeredBy,
      siteUrl,
    })
    return NextResponse.json(
      { success: true, job_id: result.jobId, domain: result.domain },
      { status: 202 },
    )
  } catch (err: unknown) {
    if (err instanceof StartAdvancedDiscoveryError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.status },
      )
    }

    console.error('[zhangqian/advanced-discover] failed to start advanced discovery', err)
    return NextResponse.json(
      { success: false, error: 'Failed to start advanced discovery' },
      { status: 500 },
    )
  }
}
