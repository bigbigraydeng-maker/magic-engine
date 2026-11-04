import type { SupabaseClient } from '@supabase/supabase-js'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { TRAFFIC_ACTION_TYPE } from '@/lib/factory/publish/promote/types'
import { readApprovedAt, readPublishOn } from '@/lib/social/week-pack/manifest'
import { weekPackSubject } from '@/lib/social/week-pack/facts'

export type SkipReason =
  | 'not_found'
  | 'client_mismatch'
  | 'already_public'
  | 'promote_record_exists'
  | 'promote_check_failed'
  | 'not_review_passed_draft'
  | 'already_scheduled'
  | 'concurrent_update'
  | 'write_failed'

export interface WriteReelScheduleArgs {
  clientId: string
  weekStart: string
  assignments: Array<{ id: string; publishOn: string }>
  dryRun: boolean
}

export type WriteReelScheduleResult =
  | { ok: false; reason: 'card_open' | 'card_check_failed' }
  | {
      ok: true
      dryRun: boolean
      written: Array<{ id: string; publishOn: string }>
      skipped: Array<{ id: string; reason: SkipReason }>
    }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nonEmptyPlainObject(v: unknown): boolean {
  return isPlainObject(v) && Object.keys(v).length > 0
}

function hasPromoteRecord(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false
  for (const row of rows) {
    if (!isPlainObject(row)) continue
    const payload = row.payload
    if (!isPlainObject(payload)) continue
    if (nonEmptyPlainObject(payload.promote_preview)) return true
    if (nonEmptyPlainObject(payload.promote_authorization)) return true
  }
  return false
}

async function checkCardOpen(
  db: SupabaseClient,
  clientId: string,
  weekStart: string,
): Promise<'open' | 'closed' | 'failed'> {
  const subject = weekPackSubject(clientId, weekStart)
  const { data, error } = await db
    .from('action_runs')
    .select('id, status')
    .eq('client_id', clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .in('status', ['pending_approval', 'authorized'])
    .eq('input->>subject_key', subject)
  if (error) return 'failed'
  if (Array.isArray(data) && data.length > 0) return 'open'
  return 'closed'
}

interface OrderRow {
  id: string
  client_id: string
  status: string
  brief: unknown
  review_ref: unknown
  published_ref: unknown
  updated_at: string
}

async function readOrder(db: SupabaseClient, id: string): Promise<OrderRow | null> {
  const { data, error } = await db
    .from('content_work_orders')
    .select('id, client_id, status, brief, review_ref, published_ref, updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as OrderRow
}

async function checkPromoteRecord(
  db: SupabaseClient,
  clientId: string,
  workOrderId: string,
): Promise<'none' | 'exists' | 'failed'> {
  const { data, error } = await db
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', TRAFFIC_ACTION_TYPE)
    .eq('payload->>work_order_id', workOrderId)
  if (error) return 'failed'
  return hasPromoteRecord(data) ? 'exists' : 'none'
}

function refusalFor(
  row: OrderRow,
  clientId: string,
  promote: 'none' | 'exists' | 'failed',
): SkipReason | null {
  if (row.client_id !== clientId) return 'client_mismatch'
  const published = toPublishedView(row.published_ref)
  if (published?.video_state === 'PUBLISHED') return 'already_public'
  if (promote === 'failed') return 'promote_check_failed'
  if (promote === 'exists') return 'promote_record_exists'
  const passed =
    row.status === 'approved' ||
    (published?.video_state === 'DRAFT' && readApprovedAt(row.review_ref) !== null)
  if (!passed) return 'not_review_passed_draft'
  if (readPublishOn(row.brief) !== null) return 'already_scheduled'
  return null
}

function buildNextBrief(brief: unknown, publishOn: string): Record<string, unknown> {
  const base = isPlainObject(brief) ? brief : {}
  const weekly = isPlainObject(base.weekly_pack) ? base.weekly_pack : {}
  return {
    ...base,
    weekly_pack: {
      ...weekly,
      publish_on: publishOn,
      scheduled_by: 'social-weekly-loop',
      scheduled_at: new Date().toISOString(),
    },
  }
}

async function applyWrite(
  db: SupabaseClient,
  clientId: string,
  row: OrderRow,
  publishOn: string,
): Promise<'written' | 'write_failed' | 'concurrent_update'> {
  const next = buildNextBrief(row.brief, publishOn)
  const { data: updated, error: uErr } = await db
    .from('content_work_orders')
    .update({ brief: next, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('updated_at', row.updated_at)
    .select('id')
  if (uErr) return 'write_failed'
  if (Array.isArray(updated) && updated.length === 1) return 'written'
  return 'concurrent_update'
}

export async function writeReelSchedule(
  db: SupabaseClient,
  args: WriteReelScheduleArgs,
): Promise<WriteReelScheduleResult> {
  const card = await checkCardOpen(db, args.clientId, args.weekStart)
  if (card === 'failed') return { ok: false, reason: 'card_check_failed' }
  if (card === 'open') return { ok: false, reason: 'card_open' }

  const written: Array<{ id: string; publishOn: string }> = []
  const skipped: Array<{ id: string; reason: SkipReason }> = []

  for (const a of args.assignments) {
    const row = await readOrder(db, a.id)
    if (!row) {
      skipped.push({ id: a.id, reason: 'not_found' })
      continue
    }
    const promote = await checkPromoteRecord(db, args.clientId, a.id)
    const refusal = refusalFor(row, args.clientId, promote)
    if (refusal) {
      skipped.push({ id: a.id, reason: refusal })
      continue
    }
    if (args.dryRun) {
      written.push({ id: a.id, publishOn: a.publishOn })
      continue
    }
    const outcome = await applyWrite(db, args.clientId, row, a.publishOn)
    if (outcome === 'written') {
      written.push({ id: a.id, publishOn: a.publishOn })
    } else {
      skipped.push({ id: a.id, reason: outcome })
    }
  }

  return { ok: true, dryRun: args.dryRun, written, skipped }
}
