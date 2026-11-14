/**
 * One durable row for a publish rehearsal, a refused registration, or a real registration.
 * Stored on cron_run_logs. Does not call a platform write API.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { startCronRunId } from '@/lib/cron/run-logger'
import type { PublishLiveKind } from './switches'

export const SOCIAL_PUBLISH_DISPATCH_JOB = 'social-publish-dispatch'

export interface PublishDispatchReceipt {
  clientId: string
  kind: PublishLiveKind
  subjectRef: string
  mode: 'dry_run' | 'failed' | 'registered'
  postId: string | null
  publishedAt: string | null
  /** A rehearsal must pass false. A registered row must pass true. */
  calledPublishApi: boolean
  reason: string
}

/**
 * Claims this job name for cron-registry reconciliation.
 * The write path must not call it: that would open a second running row.
 */
export function claimSocialPublishDispatchJobForRegistry(): Promise<string> {
  return startCronRunId(SOCIAL_PUBLISH_DISPATCH_JOB)
}

/** Insert one receipt. Throws on a bad shape or a write error — callers do not swallow it. */
export async function writePublishDispatchReceipt(
  supabase: SupabaseClient,
  input: PublishDispatchReceipt,
): Promise<void> {
  assertReceipt(input)
  const now = new Date().toISOString()
  const failed = input.mode === 'failed'
  const summary = {
    client_id: input.clientId,
    kind: input.kind,
    subject_ref: input.subjectRef,
    mode: input.mode,
    post_id: input.postId,
    published_at: input.publishedAt,
    called_publish_api: input.calledPublishApi,
    reason: input.reason,
  }
  const { error } = await supabase.from('cron_run_logs').insert({
    job_name: SOCIAL_PUBLISH_DISPATCH_JOB,
    status: failed ? 'failed' : 'completed',
    started_at: now,
    finished_at: now,
    processed: 1,
    completed_count: failed ? 0 : 1,
    failed_count: failed ? 1 : 0,
    summary,
    error_message: failed ? input.reason : null,
  })
  if (error) throw new Error(`writePublishDispatchReceipt: ${error.message}`)
}

function assertReceipt(input: PublishDispatchReceipt): void {
  if (!input.clientId || !input.subjectRef) {
    throw new Error('writePublishDispatchReceipt: clientId and subjectRef are required')
  }
  if (input.mode === 'dry_run' && input.calledPublishApi) {
    throw new Error('writePublishDispatchReceipt: a dry run must not call the publish api')
  }
  if (input.mode === 'registered' && (!input.postId || !input.publishedAt || !input.calledPublishApi)) {
    throw new Error('writePublishDispatchReceipt: a registration needs post id, time, and a real publish')
  }
}
