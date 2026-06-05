/**
 * GET /api/clients/[id]/site-audit/status
 *
 * Returns the status and progress of a site-audit job for a client,
 * plus the real GEO-detected page count from client_site_pages.
 *
 * Query Parameters:
 * - jobId (optional): If provided, return status of that specific job.
 *                     If omitted, return the latest job for this client.
 *
 * Response:
 * {
 *   job: SiteAuditJob | null,           // The job record, or null if no history
 *   progressPercent: number | null,     // 0-100, or null if no job
 *   etaSec: number | null,              // Estimated seconds remaining, or null if not in_progress
 *   geoDetectedCount: number            // Pages with has_geo_block=true in client_site_pages
 * }
 *
 * Reference: ROADMAP.md P8.0.5.3, P8.0.7
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner, type SiteAuditJob } from '@/lib/site-audit/job-runner'
import { countGeoDetectedPages } from '@/lib/db/site-pages'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

// Allow up to 60 seconds
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusResponse {
  job: SiteAuditJob | null
  progressPercent: number | null
  etaSec: number | null
  geoDetectedCount: number
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECONDS_PER_PAGE = 2

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate progress percentage for a job.
 * Returns null if job is null.
 * Clamps to 0-100.
 */
function calculateProgressPercent(job: SiteAuditJob | null): number | null {
  if (!job) return null

  const percent = (job.total_pages_classified / job.max_pages) * 100
  return Math.min(Math.max(percent, 0), 100)
}

/**
 * Estimate time remaining for a job.
 * Returns null if:
 * - job is null
 * - job hasn't started (started_at is null)
 * - job is completed or failed (status is 'completed' or 'failed')
 */
function calculateEtaSec(job: SiteAuditJob | null): number | null {
  if (!job) return null
  if (!job.started_at) return null
  if (job.status === 'completed' || job.status === 'failed') return null

  const remaining = job.max_pages - job.total_pages_classified
  if (remaining <= 0) return null

  return remaining * SECONDS_PER_PAGE
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<StatusResponse | ApiErrorResponse>> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')

  try {
    // 1. Verify client exists and has a domain
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    if (!client.domain) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Client has no domain configured' },
        { status: 404 }
      )
    }

    // 2. Fetch the job and GEO count in parallel
    const runner = new JobRunner(supabaseAdmin)
    let job: SiteAuditJob | null = null

    const [resolvedJob, geoDetectedCount] = await Promise.all([
      jobId
        ? runner.getJob(jobId)
        : runner.getLatestJobByClientId(clientId),
      countGeoDetectedPages(clientId).catch(() => 0),
    ])
    job = resolvedJob

    // 3. Calculate progress and ETA
    const progressPercent = calculateProgressPercent(job)
    const etaSec = calculateEtaSec(job)

    // 4. Return status
    return NextResponse.json<StatusResponse>(
      {
        job,
        progressPercent,
        etaSec,
        geoDetectedCount,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/status] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
