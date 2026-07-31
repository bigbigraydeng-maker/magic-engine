/**
 * POST /api/cron/site-audit-jobs
 *
 * Cron endpoint for site-audit job maintenance:
 * 1. Cleanup: Remove jobs completed > 30 days ago
 * 2. Watchdog: Detect and log failed jobs (status=failed with error_message)
 * 3. Recovery: Resume pending jobs stuck > 1 hour
 *
 * Requires: x-cron-secret header matching CRON_SECRET environment variable
 *
 * Response:
 * {
 *   timestamp: ISO timestamp,
 *   cleaned_jobs: number of deleted jobs,
 *   failed_jobs_found: number of failed jobs detected,
 *   resumed_jobs: number of stale pending jobs resumed
 * }
 *
 * Reference: ROADMAP.md P8.0.5.6
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner } from '@/lib/site-audit/job-runner'
import { startCronRun } from '@/lib/cron/run-logger'

// Allow up to 120 seconds for all operations
export const maxDuration = 120

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJobResponse {
  timestamp: string
  cleaned_jobs: number
  failed_jobs_found: number
  resumed_jobs: number
  zombies_failed: number
}

export interface ApiErrorResponse {
  error: string
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest
): Promise<NextResponse<CronJobResponse | ApiErrorResponse>> {
  // 1. Validate CRON_SECRET (outside try so cronRun is accessible in catch)
  const cronSecret = request.headers.get('x-cron-secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!cronSecret || cronSecret !== expectedSecret) {
    return NextResponse.json<ApiErrorResponse>(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const cronRun = await startCronRun('site-audit-cron')

  try {
    const timestamp = new Date().toISOString()
    const jobRunner = new JobRunner(supabaseAdmin)

    // 2. Cleanup old jobs (retention: 30 days)
    let cleanedJobs = 0
    try {
      cleanedJobs = await jobRunner.cleanupOldJobs(30)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Cleanup failed'
      throw new Error(`Cleanup failed: ${message}`)
    }

    // 3. Watchdog: Detect failed jobs (status=failed with error_message set)
    let failedJobsFound = 0
    try {
      const { data: failedJobs, error: failedJobsError } = await supabaseAdmin
        .from('site_audit_jobs')
        .select('id, client_id, status, error_message, failed_urls')
        .eq('status', 'failed')
        .not('error_message', 'is', null)

      if (failedJobsError) {
        throw new Error(`Failed to fetch failed jobs: ${failedJobsError.message}`)
      }

      failedJobsFound = failedJobs?.length ?? 0

      // Log failed jobs for monitoring
      if (failedJobsFound > 0) {
        console.log(
          `[site-audit/cron] Watchdog detected ${failedJobsFound} failed job(s)`,
          failedJobs
        )
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Watchdog check failed'
      throw new Error(`Watchdog check failed: ${message}`)
    }

    // 3b. Watchdog (22.E.S15): fail in_progress jobs stuck > 2 hours.
    // A deploy restart kills the in-process crawl but leaves the row
    // in_progress forever — which then blocks every future weekly crawl
    // for that client (the weekly cron skips when a job is in progress).
    let zombiesFailed = 0
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const { data: zombies, error: zombieErr } = await supabaseAdmin
        .from('site_audit_jobs')
        .select('id')
        .eq('status', 'in_progress')
        .lt('started_at', twoHoursAgo)

      if (zombieErr) throw new Error(zombieErr.message)

      for (const zombie of (zombies ?? []) as Array<{ id: string }>) {
        try {
          await jobRunner.failJob(zombie.id, 'Watchdog: in_progress > 2h (crawl process died)')
          zombiesFailed++
        } catch (failErr: unknown) {
          console.error(
            `[site-audit/cron] Failed to fail zombie job ${zombie.id}:`,
            failErr instanceof Error ? failErr.message : String(failErr),
          )
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Zombie watchdog failed'
      throw new Error(`Zombie watchdog failed: ${message}`)
    }

    // 4. Recovery: Resume pending jobs stuck > 1 hour
    let resumedJobs = 0
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      const { data: staleJobs, error: staleJobsError } = await supabaseAdmin
        .from('site_audit_jobs')
        .select('id, client_id, domain, status, created_at')
        .eq('status', 'pending')
        .lt('created_at', oneHourAgo)

      if (staleJobsError) {
        throw new Error(`Failed to fetch stale pending jobs: ${staleJobsError.message}`)
      }

      // Resume each stale pending job
      const staleJobList = staleJobs ?? []
      for (const staleJob of staleJobList) {
        try {
          await jobRunner.startJob(staleJob.id)
          resumedJobs++
        } catch (resumeErr: unknown) {
          const resumeMessage = resumeErr instanceof Error ? resumeErr.message : 'Unknown error'
          console.error(
            `[site-audit/cron] Failed to resume job ${staleJob.id}: ${resumeMessage}`
          )
        }
      }

      if (resumedJobs > 0) {
        console.log(`[site-audit/cron] Recovery resumed ${resumedJobs} stale job(s)`)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Recovery check failed'
      throw new Error(`Recovery check failed: ${message}`)
    }

    // 5. Return complete status report
    await cronRun.finish({
      processed: cleanedJobs + resumedJobs,
      completed: cleanedJobs + resumedJobs,
      failed: failedJobsFound,
      summary: { cleaned_jobs: cleanedJobs, failed_jobs_found: failedJobsFound, resumed_jobs: resumedJobs, zombies_failed: zombiesFailed },
    })
    return NextResponse.json<CronJobResponse>(
      {
        timestamp,
        cleaned_jobs: cleanedJobs,
        failed_jobs_found: failedJobsFound,
        resumed_jobs: resumedJobs,
        zombies_failed: zombiesFailed,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[site-audit/cron] Unexpected error:', message)
    await cronRun.finish({ failed: 1, error: message })
    return NextResponse.json<ApiErrorResponse>(
      { error: message },
      { status: 500 }
    )
  }
}
