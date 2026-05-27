/**
 * GET /api/clients/[id]/zhangqian/status?job_id=<uuid>
 *
 * Poll the status of a Zhangqian discovery job. Returns current status +
 * progress_note for the UI to render a live progress bar.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.9
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { failJob, getJob } from '@/lib/zhangqian/persistor'

// First-time discovery should never make a user wait beyond this. GLOBAL_TIMEOUT_MS
// in agent.ts caps the tool-use loop at 5 min, but the final synthesis call adds up
// to CLAUDE_FINAL_TIMEOUT_MS (90 s) on top. 6 min covers both with headroom.
// Deeper analysis lives behind connector authorisation (Phase 8.10.S5).
const STALE_JOB_TIMEOUT_MS = 6 * 60 * 1000

function isStaleRunningJob(job: { status: string; started_at: string | null; created_at: string }): boolean {
  if (job.status !== 'pending' && job.status !== 'running') return false
  const started = job.started_at ? Date.parse(job.started_at) : Date.parse(job.created_at)
  return Number.isFinite(started) && Date.now() - started > STALE_JOB_TIMEOUT_MS
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const url = new URL(req.url)
    const jobId = url.searchParams.get('job_id')
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'job_id query parameter is required' },
        { status: 400 },
      )
    }

    const job = await getJob(supabaseAdmin, jobId)
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 })
    }

    if (isStaleRunningJob(job)) {
      const error = 'Discovery timed out after 6 minutes. Please retry.'
      await failJob(supabaseAdmin, job.id, error)
      return NextResponse.json({
        success: true,
        job: {
          ...job,
          status: 'failed',
          error_message: error,
          completed_at: new Date().toISOString(),
        },
      })
    }

    return NextResponse.json({ success: true, job })
  } catch (err: unknown) {
    console.error('[zhangqian/status] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to read job status' },
      { status: 500 },
    )
  }
}
