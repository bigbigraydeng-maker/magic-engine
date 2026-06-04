/**
 * POST /api/clients/[id]/site-audit/crawl
 *
 * Triggers an async site-audit crawl job for a client.
 *
 * Core characteristics:
 * - Fire-and-forget: returns immediately with jobId; crawl runs in background
 * - Concurrency guard: only 1 in_progress job per client (bypassed with force=true)
 * - Multi-tenant isolation: always scoped to the given client_id
 *
 * Reference: ROADMAP.md P8.0.5.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner } from '@/lib/site-audit/job-runner'
import { executeJob } from '@/lib/site-audit/job-executor'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

// Allow up to 60 seconds on Render — the actual crawl runs in background
export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrawlRequestBody {
  /** Max pages to crawl. Must be 1–100. Default: 100 */
  maxPages?: number
  /** Delay between requests (ms). Must be >= 500. Default: 1000 */
  rateLimitMs?: number
  /** If true, cancel any existing in_progress job and start fresh. Default: false */
  force?: boolean
}

export interface CrawlResponse {
  jobId: string
  status: 'pending'
  estimatedDurationSec: number
  message?: string
}

export interface ApiErrorResponse {
  error: string
  jobId?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PAGES = 100
const DEFAULT_RATE_LIMIT_MS = 1000
const MAX_PAGES_LIMIT = 100
const MIN_RATE_LIMIT_MS = 500
const SECONDS_PER_PAGE = 2

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

async function parseBody(request: NextRequest): Promise<CrawlRequestBody | null> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return {}
  }
  try {
    const text = await request.text()
    if (!text.trim()) return {}
    return JSON.parse(text) as CrawlRequestBody
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBody(
  body: CrawlRequestBody
): { valid: true; maxPages: number; rateLimitMs: number; force: boolean } | { valid: false; error: string } {
  const { maxPages, rateLimitMs, force } = body

  if (maxPages !== undefined) {
    if (typeof maxPages !== 'number' || !Number.isInteger(maxPages) || maxPages < 1) {
      return { valid: false, error: 'maxPages must be an integer >= 1' }
    }
    if (maxPages > MAX_PAGES_LIMIT) {
      return { valid: false, error: `maxPages must be <= ${MAX_PAGES_LIMIT}` }
    }
  }

  if (rateLimitMs !== undefined) {
    if (typeof rateLimitMs !== 'number' || rateLimitMs < MIN_RATE_LIMIT_MS) {
      return { valid: false, error: `rateLimitMs must be >= ${MIN_RATE_LIMIT_MS}` }
    }
  }

  if (force !== undefined && typeof force !== 'boolean') {
    return { valid: false, error: 'force must be a boolean' }
  }

  return {
    valid: true,
    maxPages: maxPages ?? DEFAULT_MAX_PAGES,
    rateLimitMs: rateLimitMs ?? DEFAULT_RATE_LIMIT_MS,
    force: force ?? false,
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<CrawlResponse | ApiErrorResponse>> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const clientId = params.id

  try {
    // 1. Parse body (no body → use defaults)
    const rawBody = await parseBody(request)
    if (rawBody === null) {
      return NextResponse.json<ApiErrorResponse>(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    // 2. Validate body parameters
    const validation = validateBody(rawBody)
    if (!validation.valid) {
      return NextResponse.json<ApiErrorResponse>(
        { error: validation.error },
        { status: 400 }
      )
    }

    const { maxPages, rateLimitMs, force } = validation

    // 3. Verify client exists and has a domain
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
        { status: 400 }
      )
    }

    // 4. Concurrency check — enforce one in_progress job per client
    const runner = new JobRunner(supabaseAdmin)
    const existingJob = await runner.getInProgressJob(clientId)

    if (existingJob) {
      if (!force) {
        return NextResponse.json<ApiErrorResponse & { jobId: string }>(
          {
            error: 'A crawl job is already in progress for this client',
            jobId: existingJob.id,
          },
          { status: 409 }
        )
      }

      // force=true: cancel the existing job so a fresh one can start
      await runner.failJob(existingJob.id, 'Forced cancellation by new crawl request')
    }

    // 5. Create the new pending job record
    const job = await runner.createJob(clientId, {
      domain: client.domain,
      maxPages,
      rateLimitMs,
    })

    // 6. Fire-and-forget: start the crawl in the background without blocking
    void executeJob(supabaseAdmin, job.id, { maxPages, rateLimitMs }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[site-audit/crawl] Background executeJob failed for job ${job.id}:`, message)
    })

    // 7. Return immediately with the job metadata
    const estimatedDurationSec = maxPages * SECONDS_PER_PAGE

    return NextResponse.json<CrawlResponse>(
      {
        jobId: job.id,
        status: 'pending',
        estimatedDurationSec,
        message: `Crawl started for ${client.domain}. Check /api/clients/${clientId}/site-audit/jobs/${job.id} for progress.`,
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/crawl] Unexpected error:', message)
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
