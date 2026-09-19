/**
 * SEO Meta-Cycle v1 — per-step receipts (子牙 finding #10).
 *
 * "Every one of the six Inngest steps needs ... a receipt written on
 * failure — a failure at step 3 must not silently vanish, write a
 * cron_run_logs-style receipt per step, not only a final step-6 summary."
 *
 * Inngest's `retries` config is FUNCTION-level, not per-step (confirmed
 * against this repo's own flywheel-seo-weekly.ts / seo-post-publish-monitor.ts
 * — there is no per-step retries option in the SDK). What step.run DOES give
 * per step is memoization: once a step's cron_run_logs receipt below has
 * been written and the step returns, a function-level retry replays that
 * step's cached result instead of re-running it, so a failure at step 3
 * does not re-spend step 1/2's work — that's where the "per-step" guarantee
 * actually comes from in this SDK, not from a per-step retry count. This
 * file's job is just the other half: make sure a step's outcome (including
 * failure) is durably visible, not only memoized in Inngest's internal
 * step cache.
 *
 * Deterministic id uses the same `stableHash` (exported from
 * post-publish-monitor.ts) and the same UUID-shaping as that file's
 * `receiptRunId` — reused rather than reimplemented, so a replay upserts
 * the same row instead of inserting a duplicate under a different scheme.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { stableHash } from '@/lib/seo/post-publish-monitor'

export const STEP1_JOB_NAME = 'seo-meta-cycle-step1-check-due'
export const STEP2_JOB_NAME = 'seo-meta-cycle-step2-candidates-ready'
export const STEP3_JOB_NAME = 'seo-meta-cycle-step3-prescribed'
export const STEP4_JOB_NAME = 'seo-meta-cycle-step4-applied'
export const STEP5_JOB_NAME = 'seo-meta-cycle-step5-logged'
export const STEP6_JOB_NAME = 'seo-meta-cycle-step6-completed'

function receiptId(jobName: string, clientId: string, weekKey: string): string {
  const hex = stableHash([jobName, clientId, weekKey]).padEnd(32, '0').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface StepReceiptInput {
  jobName: string
  clientId: string
  weekKey: string
  status: 'completed' | 'failed'
  processed: number
  completed: number
  failed: number
  summary: Record<string, unknown>
  errorMessage?: string | null
}

/**
 * Writes never throw — logging failure must not break the step it's
 * observing (same discipline as run-logger.ts / post-publish-monitor-store.ts).
 */
export async function writeStepReceipt(supabase: SupabaseClient, input: StepReceiptInput): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase.from('cron_run_logs').upsert(
    {
      id: receiptId(input.jobName, input.clientId, input.weekKey),
      job_name: input.jobName,
      status: input.status,
      started_at: now,
      finished_at: now,
      duration_ms: 0,
      processed: input.processed,
      completed_count: input.completed,
      failed_count: input.failed,
      summary: { week_key: input.weekKey, client_id: input.clientId, ...input.summary },
      error_message: input.errorMessage ?? null,
    },
    { onConflict: 'id' },
  )
  if (error) console.error(`[seo-meta-cycle] receipt write failed (${input.jobName}):`, error.message)
}
