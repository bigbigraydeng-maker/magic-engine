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
import {
  failJob,
  getActiveJob,
  getJob,
  isStaleRunningJob,
  STALE_JOB_TIMEOUT_MS,
} from '@/lib/zhangqian/persistor'

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
    // ?active=1 — a refreshed page asks "is a run already in flight?" without a job id.
    if (url.searchParams.get('active') === '1') {
      const active = await getActiveJob(supabaseAdmin, clientId)
      return NextResponse.json({ success: true, job: active })
    }

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
      // 文案由同一个阈值派生 —— 写死的数字会跟阈值脱钩(Codex 复审 #1186 P2)。
      const error = `Discovery timed out after ${Math.round(STALE_JOB_TIMEOUT_MS / 60_000)} minutes. Please retry.`
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
