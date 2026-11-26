/**
 * A Reel that is already live, but whose republish signal can never be built.
 * Send failures stay silent here: reconcile retries those. A schema failure
 * retries forever and used to leave no row.
 *
 * The reason is field names only. Values (page ids, video ids) never land
 * in the to-do or the cron row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ZodError } from 'zod'
import {
  SOCIAL_READBACK_OUTCOME_JOB,
  socialReadbackOutcomeEnabled,
  writeReadbackOutcome,
} from '@/lib/social/readback-outcome-record'

export const REEL_EVENT_CONTRACT_INVALID = 'reel_event_contract_invalid'

const REASON_RE = /^[a-z0-9_.,]{1,80}$/

/** Keep letters, digits under five in a row, dots, commas, underscores. */
export function contractFailureReason(detail: string): string {
  const cleaned = detail
    .toLowerCase()
    .replace(/\d{5,}/g, '')
    .replace(/[^a-z0-9_.,]/g, '')
    .slice(0, 80)
  return REASON_RE.test(cleaned) ? cleaned : 'unreadable_field'
}

export function reasonFromZod(error: ZodError): string {
  const paths = error.issues.map((issue) =>
    issue.path
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .join('.'),
  )
  const joined = [...new Set(paths.filter((path) => path.length > 0))].sort().join(',')
  return contractFailureReason(joined || 'schema')
}

export function missingReelSignalFields(ref: { page_id?: string; video_id?: string }): string {
  const names = [ref.page_id ? '' : 'page_id', ref.video_id ? '' : 'video_id'].filter(Boolean)
  return contractFailureReason(names.join(',') || 'schema')
}

export async function recordReelContractFailure(
  supabase: SupabaseClient,
  input: { clientId: string; workOrderId: string; reason: string },
): Promise<void> {
  if (!socialReadbackOutcomeEnabled()) return
  const reason = contractFailureReason(input.reason)
  try {
    if (await sameFailureExists(supabase, input.workOrderId)) return
    await writeReadbackOutcome(supabase, {
      clientId: input.clientId,
      subjectKind: 'reel',
      subjectRef: input.workOrderId,
      outcome: REEL_EVENT_CONTRACT_INVALID,
      reason,
    })
  } catch (error) {
    console.error(
      `[publish-worker] 发布信号结构失败没记下 ${input.workOrderId}: ${
        error instanceof Error ? error.message : error
      }`,
    )
  }
}

async function sameFailureExists(supabase: SupabaseClient, workOrderId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('id')
    .eq('job_name', SOCIAL_READBACK_OUTCOME_JOB)
    .eq('status', 'failed')
    .eq('summary->>subject_ref', workOrderId)
    .eq('summary->>outcome', REEL_EVENT_CONTRACT_INVALID)
    .limit(1)
  if (error) return false
  return Array.isArray(data) && data.length > 0
}
