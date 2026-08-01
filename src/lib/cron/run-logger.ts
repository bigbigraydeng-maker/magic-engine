import { supabaseAdmin } from '@/lib/supabase'

/**
 * Declares whether a healthy run of a job must touch at least one object.
 *
 * Background (2026-07-28): three separate cron jobs sat "completed" for weeks
 * while doing literally nothing — anomaly-detector-daily (scannedClients:0),
 * social-engagement-pullback (postsProcessed:0) and vision-analyzer
 * (6,830 runs, sum(processed)=0). The shared design fault was that
 * "processed 0 objects" was accepted as a legitimate success, so the system
 * could not tell "there was genuinely nothing to do" apart from "I am blind".
 *
 * The fix is deliberately not a blanket rule — sweeper/backfill jobs idle at
 * zero legitimately. Instead each job declares its own expectation.
 */
export interface CronRunOptions {
  /**
   * true  → a healthy run MUST process >= 1 object, so processed === 0 is
   *         recorded as `failed`: it means the job could not see its input.
   * false → processed === 0 is legitimate (sweepers, backfills, catch-up jobs).
   *
   * Omit to keep legacy behaviour (status driven by `error` alone).
   * New jobs should always declare this explicitly.
   */
  expectsWork?: boolean
}

export interface CronRunHandle {
  finish(opts: {
    processed?: number
    completed?: number
    failed?: number
    summary?: Record<string, unknown>
    error?: string
  }): Promise<void>
}

/**
 * Decide the final status of a cron run.
 *
 * Exported for testing — the single place that answers
 * "did this run actually accomplish anything?".
 */
export function resolveCronStatus(input: {
  processed: number
  failed: number
  error?: string
  expectsWork?: boolean
}): { status: 'completed' | 'failed'; errorMessage?: string } {
  // 1. An explicit error always fails.
  if (input.error) {
    return { status: 'failed', errorMessage: input.error }
  }

  // 2. A job that declared it must do work, but did none, is blind — not idle.
  if (input.expectsWork === true && input.processed === 0) {
    return {
      status: 'failed',
      errorMessage:
        'Zero objects processed, but this job declares expectsWork=true. ' +
        'Treating as failure: the job could not reach its input rather than ' +
        'having nothing to do.',
    }
  }

  // 3. A run that completed no work yet recorded failures is a failure,
  //    regardless of declaration. This is the exact shape that let
  //    "column clients.status does not exist" hide inside summary for 30 days:
  //    failed_count=1, processed=0, status=completed.
  if (input.failed > 0 && input.processed === 0) {
    return {
      status: 'failed',
      errorMessage:
        `Zero objects processed and ${input.failed} failure(s) recorded. ` +
        'Errors were captured but no work completed.',
    }
  }

  return { status: 'completed' }
}

export async function startCronRun(
  jobName: string,
  options: CronRunOptions = {}
): Promise<CronRunHandle> {
  const startedAt = Date.now()

  const { data } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()

  const runId: string | null = data?.id ?? null

  return {
    async finish({ processed = 0, completed = 0, failed = 0, summary, error }) {
      if (!runId) return
      const durationMs = Date.now() - startedAt

      const { status, errorMessage } = resolveCronStatus({
        processed,
        failed,
        error,
        expectsWork: options.expectsWork,
      })

      await supabaseAdmin
        .from('cron_run_logs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          processed,
          completed_count: completed,
          failed_count: failed,
          summary: summary ?? null,
          error_message: errorMessage ?? null,
        })
        .eq('id', runId)
    },
  }
}
