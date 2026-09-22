/**
 * Daily Plan measurement handoff — outcome records in `cron_run_logs`.
 *
 * Written by both the publish route (the measurement event could not be sent)
 * and the story-resolve workflow (the story id could not be resolved). Read by
 * the daily to-do list (`pm-todo/daily-plan-measurement-items.ts`), so a Post
 * that is live on Facebook but will never be measured reaches a human instead
 * of dying in a log line. No new table: the record is the product of that run.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { STORY_RESOLVE_JOB_NAME } from './daily-plan-publish'

/** Fixed outcome codes. Never raw provider or schema error text. */
export type MeasurementRecordOutcome =
  | 'photo_gone'
  | 'photo_gone_not_recalled'
  | 'unresolved'
  | 'event_contract_invalid'
  | 'event_send_failed'
  | 'isolation_refused'
  | 'workflow_failed'

export interface MeasurementRecordPost {
  client_id: string
  campaign_id: string
  plan_id: string
  date: string
  idempotency_key: string
  page_id: string
  /** Scheduled photo (story id not yet known). */
  photo_id?: string
  /** Immediate publish (feed post id known). */
  post_id?: string
  scheduled_publish_time?: string
}

export interface MeasurementRecord {
  status: 'completed' | 'failed'
  outcome: MeasurementRecordOutcome
  reason: string
  attempts: number
  post: MeasurementRecordPost
}

/** Insert one outcome row. Throws on write failure — callers decide whether that is fatal. */
export async function writeMeasurementRecord(supabase: SupabaseClient, record: MeasurementRecord): Promise<void> {
  const now = new Date().toISOString()
  const failed = record.status === 'failed'
  const { error } = await supabase.from('cron_run_logs').insert({
    job_name: STORY_RESOLVE_JOB_NAME,
    status: record.status,
    started_at: now,
    finished_at: now,
    processed: 1,
    completed_count: failed ? 0 : 1,
    failed_count: failed ? 1 : 0,
    summary: { outcome: record.outcome, reason: record.reason, attempts: record.attempts, ...record.post },
    error_message: failed ? `${record.outcome}: ${record.reason}` : null,
  })
  if (error) throw new Error(`writeMeasurementRecord: ${error.message}`)
}
