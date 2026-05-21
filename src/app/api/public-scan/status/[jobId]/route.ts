/**
 * GET /api/public-scan/status/[jobId]
 *
 * Polling endpoint for public scan progress and results.
 * No auth required — job IDs are hard-to-guess UUIDs.
 *
 * Returns progress_log always; result only when status = 'completed'.
 */

// Must never be cached — this is a live-polling endpoint
export const dynamic = 'force-dynamic'

import { unstable_noStore as noStore } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

interface JobRow {
  id: string
  status: string
  progress_log: unknown[]
  result: unknown
  error: string | null
  domain: string
  created_at: string
  completed_at: string | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } },
): Promise<NextResponse> {
  // Explicitly opt out of Next.js Data Cache for this handler — force a
  // live Supabase read on every poll request.
  noStore()

  const { jobId } = params

  const { data, error } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, status, progress_log, result, error, domain, created_at, completed_at')
    .eq('id', jobId)
    .single<JobRow>()

  if (error || !data) {
    return NextResponse.json({ error: 'Scan job not found.' }, { status: 404 })
  }

  return NextResponse.json({
    job_id: data.id,
    status: data.status,
    progress_log: data.progress_log ?? [],
    domain: data.domain,
    error: data.error,
    created_at: data.created_at,
    completed_at: data.completed_at,
    // Only send full result payload when done (keep polling responses small)
    result: data.status === 'completed' ? data.result : null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
