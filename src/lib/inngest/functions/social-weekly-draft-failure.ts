/**
 * Closes the one cron_run_logs row that belongs to this Inngest run when the
 * weekly-draft function dies before its own finish step (for example a step
 * request that never reaches the server). The fan-out and each client run share
 * the job name `social-weekly-draft`, so closing by job name would mark the
 * wrong row. The row id is derived from the Inngest run id, the same way the
 * run is opened.
 *
 * A write-mode client run is stamped so the existing to-do reader can say the
 * week's pack did not finish. This file does not schedule, publish, or retry.
 */
import { cronRunIdFromInngestRun, finishCronRunIfOpen } from '@/lib/cron/run-logger'
import { WEEKLY_LOOP_JOB, type WeeklyLoopMode } from '@/lib/social/weekly-loop/run'

/** Kept equal to SOCIAL_WEEKLY_DRAFT_DUE_EVENT. Imported from the function file would be a cycle. */
export const SOCIAL_WEEKLY_DRAFT_FAILURE_DUE_EVENT = 'social/week_pack.draft_due'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const text = message.trim() ? message : 'unknown error'
  return text.slice(0, 300)
}

export interface SocialWeeklyDraftFailureInput {
  runId: string | null
  message: string
  failedAt: Date
  /** The event that started the run, nested on the failure payload as data.event. */
  trigger: { name?: unknown; data?: unknown } | null
}

/** Fields the to-do reader needs, taken from the triggering event. No extra reads. */
export function socialWeeklyDraftFailureSummary(
  trigger: { name?: unknown; data?: unknown } | null,
  message: string,
): Record<string, unknown> {
  const data = isRecord(trigger?.data) ? trigger.data : {}
  const clientId = typeof data.clientId === 'string' ? data.clientId.trim() : ''
  if (trigger?.name === SOCIAL_WEEKLY_DRAFT_FAILURE_DUE_EVENT && clientId) {
    const mode: WeeklyLoopMode = data.mode === 'write' ? 'write' : 'dry_run'
    return {
      kind: 'client_run',
      client_id: clientId,
      mode,
      status: 'failed',
      error: message,
      no_publish: true,
    }
  }
  return { kind: 'fan_out', status: 'failed', error: message, no_publish: true }
}

/** Close exactly this run's row. Never throws out of the caller's failure handler. */
export async function handleSocialWeeklyDraftFailure(
  input: SocialWeeklyDraftFailureInput,
  closeRun: typeof finishCronRunIfOpen = finishCronRunIfOpen,
): Promise<'closed' | 'already_terminal' | 'no_run_id'> {
  if (!input.runId) {
    console.error('[social-weekly-draft] onFailure without a run id — nothing closed:', input.message)
    return 'no_run_id'
  }
  return closeRun(
    WEEKLY_LOOP_JOB,
    cronRunIdFromInngestRun(input.runId),
    {
      processed: 0,
      completed: 0,
      failed: 1,
      summary: socialWeeklyDraftFailureSummary(input.trigger, input.message),
      error: input.message,
    },
    input.failedAt,
  )
}

/** Inngest onFailure entry. The run id is the one Inngest puts on the failure event. */
export async function socialWeeklyDraftOnFailure(input: {
  event: { data?: unknown; ts?: unknown }
  error?: unknown
}): Promise<void> {
  const data = isRecord(input.event.data) ? input.event.data : {}
  const nested = data.event
  const trigger = isRecord(nested) ? nested : null
  const failedAt = typeof input.event.ts === 'number' ? new Date(input.event.ts) : new Date()
  await handleSocialWeeklyDraftFailure({
    runId: typeof data.run_id === 'string' ? data.run_id : null,
    message: failureMessage(input.error),
    failedAt,
    trigger,
  })
}
