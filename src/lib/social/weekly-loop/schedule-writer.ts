import type { SupabaseClient } from '@supabase/supabase-js'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { toPublishedView } from '@/lib/factory/publish/publish-display'
import { TRAFFIC_ACTION_TYPE } from '@/lib/factory/publish/promote/types'
import { readApprovedAt, readPublishOn } from '@/lib/social/week-pack/manifest'
import { weekPackSubject } from '@/lib/social/week-pack/facts'
import { isExcludedByCard } from '@/lib/factory/publish/promote/scheduled-authorize-list'

export type SkipReason =
  | 'not_found'
  | 'client_mismatch'
  | 'already_public'
  | 'promote_record_exists'
  | 'promote_check_failed'
  | 'not_review_passed_draft'
  | 'already_scheduled'
  | 'excluded_by_card'
  | 'concurrent_update'
  | 'write_failed'

export interface WriteReelScheduleArgs {
  clientId: string
  weekStart: string
  assignments: Array<{ id: string; publishOn: string }>
  dryRun: boolean
  /** Daily cadence: only a card still under review blocks; an approved card does not (new items need their own grant). */
  blockOnlyPending?: boolean
  /** Recorded on brief.weekly_pack.scheduled_by. */
  scheduledBy?: string
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

/** A go-public grant that is live or may already have published. missed / stale / failed / revoked do not count. */
const ACTIVE_GRANT = new Set(['armed', 'claimed', 'consumed', 'consumed_manual', 'unknown'])
function activeGrant(g: unknown): boolean {
  return isPlainObject(g) && typeof g.status === 'string' && ACTIVE_GRANT.has(g.status)
}

function hasPromoteRecord(rows: unknown): boolean {
  if (!Array.isArray(rows)) return false
  for (const row of rows) {
    if (!isPlainObject(row)) continue
    const payload = row.payload
    if (!isPlainObject(payload)) continue
    if (nonEmptyPlainObject(payload.promote_preview)) return true
    if (nonEmptyPlainObject(payload.promote_authorization)) return true
    if (activeGrant(payload.scheduled_go_public)) return true
  }
  return false
}

async function checkCardOpen(
  db: SupabaseClient,
  clientId: string,
  weekStart: string,
  blockOnlyPending: boolean,
): Promise<'open' | 'closed' | 'failed'> {
  const subject = weekPackSubject(clientId, weekStart)
  const { data, error } = await db
    .from('action_runs')
    .select('id, status')
    .eq('client_id', clientId)
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .in('status', blockOnlyPending ? ['pending_approval'] : ['pending_approval', 'authorized'])
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
  if (isExcludedByCard(row.brief)) return 'excluded_by_card'
  return null
}

function buildNextBrief(brief: unknown, publishOn: string, scheduledBy: string): Record<string, unknown> {
  const base = isPlainObject(brief) ? brief : {}
  const weekly = isPlainObject(base.weekly_pack) ? base.weekly_pack : {}
  return {
    ...base,
    weekly_pack: {
      ...weekly,
      publish_on: publishOn,
      scheduled_by: scheduledBy,
      scheduled_at: new Date().toISOString(),
    },
  }
}

async function applyWrite(
  db: SupabaseClient,
  clientId: string,
  row: OrderRow,
  publishOn: string,
  scheduledBy: string,
): Promise<'written' | 'write_failed' | 'concurrent_update'> {
  const next = buildNextBrief(row.brief, publishOn, scheduledBy)
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
  const card = await checkCardOpen(db, args.clientId, args.weekStart, args.blockOnlyPending === true)
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
    const outcome = await applyWrite(db, args.clientId, row, a.publishOn, args.scheduledBy ?? 'social-weekly-loop')
    if (outcome === 'written') {
      written.push({ id: a.id, publishOn: a.publishOn })
    } else {
      skipped.push({ id: a.id, reason: outcome })
    }
  }

  return { ok: true, dryRun: args.dryRun, written, skipped }
}

export type ExpireOutcome = 'expired' | 'kept_has_grant' | 'kept_not_past' | 'not_found' | 'check_failed' | 'concurrent_update' | 'write_failed'

/**
 * Daily cadence: a reel whose day has passed without any approval goes back to the pool (its day is removed and
 * the old day recorded). Kept when any grant or promote record exists, so nothing approved or possibly public moves.
 */
export async function expireUnapproved(
  db: SupabaseClient,
  args: { clientId: string; ids: string[]; today: string; dryRun: boolean },
): Promise<Array<{ id: string; outcome: ExpireOutcome }>> {
  const out: Array<{ id: string; outcome: ExpireOutcome }> = []
  for (const id of args.ids) {
    const row = await readOrder(db, id)
    if (!row || row.client_id !== args.clientId) { out.push({ id, outcome: 'not_found' }); continue }
    const day = readPublishOn(row.brief)
    if (typeof day !== 'string' || day === 'invalid' || day >= args.today) { out.push({ id, outcome: 'kept_not_past' }); continue }
    const promote = await checkPromoteRecord(db, args.clientId, id)
    if (promote === 'failed') { out.push({ id, outcome: 'check_failed' }); continue }
    if (promote === 'exists') { out.push({ id, outcome: 'kept_has_grant' }); continue }
    if (args.dryRun) { out.push({ id, outcome: 'expired' }); continue }
    const base = isPlainObject(row.brief) ? row.brief : {}
    const pack = isPlainObject(base.weekly_pack) ? { ...base.weekly_pack } : {}
    delete pack.publish_on
    const next = { ...base, weekly_pack: { ...pack, expired_unapproved: { at: new Date().toISOString(), publish_on: day } } }
    const { data: updated, error } = await db
      .from('content_work_orders')
      .update({ brief: next, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('client_id', args.clientId)
      .eq('updated_at', row.updated_at)
      .select('id')
    if (error) out.push({ id, outcome: 'write_failed' })
    else out.push({ id, outcome: Array.isArray(updated) && updated.length === 1 ? 'expired' : 'concurrent_update' })
  }
  return out
}
