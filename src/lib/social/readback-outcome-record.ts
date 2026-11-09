/**
 * Generic read-back outcome row.
 *
 * Not `writeMeasurementRecord`: that helper hard-codes the daily-plan story
 * job and requires campaign / plan ids. Reel and Story refusals must not invent
 * those ids, and must not land in that job's to-do reader.
 *
 * Storage is an existing `cron_run_logs` row (no new table). The daily to-do
 * list reads `job_name = social-readback-outcome` and `status = failed`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { startCronRunId } from '@/lib/cron/run-logger'

export const SOCIAL_READBACK_OUTCOME_JOB = 'social-readback-outcome'
export const SOCIAL_READBACK_OUTCOME_ENV = 'SOCIAL_READBACK_OUTCOME_ENABLED'

export const SOCIAL_READBACK_SUBJECT_KINDS = ['reel', 'story', 'post'] as const
export type SocialReadbackSubjectKind = (typeof SOCIAL_READBACK_SUBJECT_KINDS)[number]

export interface ReadbackOutcomeInput {
  clientId: string
  subjectKind: SocialReadbackSubjectKind
  subjectRef: string
  outcome: string
  reason: string
}

/** Strict opt-in. Missing, `1`, `TRUE`, and `yes` all stay off. */
export function socialReadbackOutcomeEnabled(
  env: { SOCIAL_READBACK_OUTCOME_ENABLED?: string } = process.env,
): boolean {
  return env.SOCIAL_READBACK_OUTCOME_ENABLED === 'true'
}

/**
 * Claims this job name for cron-registry reconciliation.
 *
 * The scanner only sees `startCronRun` / `startCronRunId` / `startCronRunWithId`.
 * The real receipt is the single failed insert in `writeReadbackOutcome`.
 * Calling this opens a separate `running` row on the admin client — the write
 * path must not call it. The job stays on `UNSCHEDULED_CRON_ROUTES` because it
 * is event-driven; a placeholder timetable would alarm "never ran".
 */
export function claimSocialReadbackOutcomeJobForRegistry(): Promise<string> {
  return startCronRunId(SOCIAL_READBACK_OUTCOME_JOB)
}

/** Insert one failed outcome. Throws on write failure — callers do not swallow it. */
export async function writeReadbackOutcome(
  supabase: SupabaseClient,
  input: ReadbackOutcomeInput,
): Promise<void> {
  if (!input.clientId || !input.subjectRef) {
    throw new Error('writeReadbackOutcome: clientId and subjectRef are required')
  }
  const now = new Date().toISOString()
  const summary = {
    client_id: input.clientId,
    subject_kind: input.subjectKind,
    subject_ref: input.subjectRef,
    outcome: input.outcome,
    reason: input.reason,
  }
  const { error } = await supabase.from('cron_run_logs').insert({
    job_name: SOCIAL_READBACK_OUTCOME_JOB,
    status: 'failed',
    started_at: now,
    finished_at: now,
    processed: 1,
    completed_count: 0,
    failed_count: 1,
    summary,
    error_message: `${input.outcome}: ${input.reason}`,
  })
  if (error) throw new Error(`writeReadbackOutcome: ${error.message}`)
}
