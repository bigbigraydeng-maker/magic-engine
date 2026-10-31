/**
 * When staff unmark a payment, stop the deal that payment created.
 *
 * A deal that has not reached the ad platform is rejected, and any queued or
 * failed send row is closed, so a later approval or retry cannot send it.
 * A deal that already went out, or might have, is left as-is and marked so
 * the screen can say so in plain language. Nothing here calls the platform.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readCapiClientConfig, type DealMilestone } from './capi-client-config'
import { CRM_STAGE_MANUAL_SOURCE, crmDealSourceRef } from './crm-deal-record'

const LEFT_ALONE = new Set(['confirmed', 'in_doubt', 'sending'])
const STOPPABLE = new Set(['queued', 'failed'])

/** Written on the deal when a payment reversal voids it. Restore matches this exact note. */
export const PAYMENT_VOID_REJECT_NOTE = '收款已撤销，这笔成交还没发给广告平台，已作废。'
/** Written on the unsent send row the reversal stopped. Reopen matches this exact error. */
export const PAYMENT_VOID_STOP_ERROR = '收款已撤销，这条还没发出去，已停住。'

const VOIDED = '这笔款已撤销。还没发给广告平台的成交记录已作废，不会再发出去。'
const ALREADY_SENT = '这笔款已撤销。已经发给广告平台的成交留着，撤不回来，请到广告后台核对。'
const MAYBE_SENT = '这笔款已撤销。有一笔成交可能已经发给广告平台，记录留着没改，请到广告后台核对。'
const VOID_FAILED = '这笔款已撤销，但成交记录没能作废。请到成交审核里看一眼，别当成已经停住。'

export const PAYMENT_REVOKED_NOTE = '收款已撤销。这笔可能已经发给广告平台，不要再发。'

export type DealVoidWriteback = { id: string; status: string; payloadPreview: unknown }

export type DealVoidRow = {
  id: string
  reviewStatus: string
  writebacks: DealVoidWriteback[]
}

export type DealVoidPlan = {
  voidIds: string[]
  stopIds: string[]
  flagIds: string[]
  confirmed: boolean
  maybeSent: boolean
}

export type DealVoidNotice = {
  recorded: false
  alreadyRecorded: false
  reason: 'voided' | 'already_sent' | 'void_failed'
  message: string
}

export function planDealVoid(rows: DealVoidRow[]): DealVoidPlan {
  const plan: DealVoidPlan = { voidIds: [], stopIds: [], flagIds: [], confirmed: false, maybeSent: false }
  for (const row of rows) {
    if (row.reviewStatus === 'rejected') continue
    const left = row.writebacks.filter((item) => LEFT_ALONE.has(item.status))
    if (left.length > 0) {
      plan.flagIds.push(...left.map((item) => item.id))
      if (left.some((item) => item.status === 'confirmed')) plan.confirmed = true
      else plan.maybeSent = true
      continue
    }
    plan.voidIds.push(row.id)
    for (const item of row.writebacks) {
      if (STOPPABLE.has(item.status)) plan.stopIds.push(item.id)
    }
  }
  return plan
}

export function voidDealMessage(plan: DealVoidPlan): string | null {
  const parts: string[] = []
  if (plan.voidIds.length > 0) parts.push(VOIDED)
  if (plan.confirmed) parts.push(ALREADY_SENT)
  else if (plan.maybeSent) parts.push(MAYBE_SENT)
  return parts.length > 0 ? parts.join('') : null
}

export function paymentRevokedPreview(preview: unknown): boolean {
  return typeof preview === 'object' && preview !== null && (preview as { paymentRevoked?: unknown }).paymentRevoked === true
}

export type UnmarkChoice = 'void' | 'skip' | 'void_failed'

/**
 * A stamp written when the deal was created wins over today's setting.
 * No stamp falls back to today's setting. A broken setting with no stamp
 * refuses instead of guessing which payment the deal belonged to.
 */
export function dealBelongsToUnmarkedKind(
  stamp: string | null,
  unmarked: DealMilestone,
  current: DealMilestone | null | 'malformed',
): UnmarkChoice {
  if (stamp === 'deposit' || stamp === 'balance') return stamp === unmarked ? 'void' : 'skip'
  if (current === 'malformed') return 'void_failed'
  if (current !== unmarked) return 'skip'
  return 'void'
}

export function selectDealsForUnmark(
  deals: Array<{ id: string; stamp: string | null }>,
  unmarked: DealMilestone,
  current: DealMilestone | null | 'malformed',
): { ids: string[]; failed: boolean } {
  const ids: string[] = []
  let failed = false
  for (const deal of deals) {
    const choice = dealBelongsToUnmarkedKind(deal.stamp, unmarked, current)
    if (choice === 'void') ids.push(deal.id)
    else if (choice === 'void_failed') failed = true
  }
  return { ids, failed }
}

export async function voidDealAfterUnpaid(
  db: SupabaseClient,
  input: { clientId: string; bookingId: string; kind: DealMilestone; actor: string | null },
): Promise<DealVoidNotice | null> {
  try {
    return await voidMatchingDeal(db, input)
  } catch {
    console.info(JSON.stringify({ event: 'crm_deal.void_failed' }))
    return notice('void_failed', VOID_FAILED)
  }
}

async function voidMatchingDeal(
  db: SupabaseClient,
  input: { clientId: string; bookingId: string; kind: DealMilestone; actor: string | null },
): Promise<DealVoidNotice | null> {
  const contactId = await bookingContact(db, input.clientId, input.bookingId)
  if (!contactId) return null
  const rows = await loadDeals(db, input.clientId, crmDealSourceRef(contactId, input.bookingId, null))
  if (rows.length === 0) return null
  const current = await configuredMilestone(db, input.clientId)
  const stamps = await loadStamps(db, rows.map((row) => row.id))
  const picked = selectDealsForUnmark(rows.map((row) => ({ id: row.id, stamp: stamps.get(row.id) ?? null })), input.kind, current)
  if (picked.ids.length === 0) return picked.failed ? notice('void_failed', VOID_FAILED) : null
  const chosen = rows.filter((row) => picked.ids.includes(row.id))
  const plan = planDealVoid(chosen)
  const message = voidDealMessage(plan)
  if (!message) return picked.failed ? notice('void_failed', VOID_FAILED) : null
  await applyPlan(db, chosen, plan, input.actor)
  const text = picked.failed ? `${message}${VOID_FAILED}` : message
  if (plan.voidIds.length > 0) return notice('voided', text)
  return notice('already_sent', text)
}

async function applyPlan(db: SupabaseClient, rows: DealVoidRow[], plan: DealVoidPlan, actor: string | null): Promise<void> {
  const note = plan.confirmed ? ALREADY_SENT : MAYBE_SENT
  await flagLeftAlone(db, rows, plan.flagIds, note)
  await stopOpenSends(db, plan.stopIds)
  await rejectDeals(db, plan.voidIds, actor)
}

async function flagLeftAlone(db: SupabaseClient, rows: DealVoidRow[], ids: string[], note: string): Promise<void> {
  const byId = new Map(rows.flatMap((row) => row.writebacks.map((item) => [item.id, item])))
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) continue
    const { error } = await db.from('me_conversion_writebacks').update({
      payload_preview: revokedPreview(item.payloadPreview, note),
      updated_at: new Date().toISOString(),
    }).eq('id', id).in('status', ['confirmed', 'in_doubt', 'sending'])
    if (error) throw new Error('crm_deal_void_failed')
  }
}

async function stopOpenSends(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await db.from('me_conversion_writebacks').update({
    status: 'failed_permanent',
    last_error: PAYMENT_VOID_STOP_ERROR,
    last_error_code: null,
    updated_at: new Date().toISOString(),
  }).in('id', ids).in('status', ['queued', 'failed'])
  if (error) throw new Error('crm_deal_void_failed')
}

async function rejectDeals(db: SupabaseClient, ids: string[], actor: string | null): Promise<void> {
  if (ids.length === 0) return
  const now = new Date().toISOString()
  const { error } = await db.from('me_sale_outcomes').update({
    review_status: 'rejected',
    reject_reason: 'not_real_sale',
    reject_note: PAYMENT_VOID_REJECT_NOTE,
    reviewed_by: actor,
    reviewed_at: now,
    updated_at: now,
  }).in('id', ids).in('review_status', ['pending_review', 'approved'])
  if (error) throw new Error('crm_deal_void_failed')
}

function revokedPreview(preview: unknown, note: string): Record<string, unknown> {
  const base = typeof preview === 'object' && preview !== null && !Array.isArray(preview)
    ? { ...(preview as Record<string, unknown>) }
    : {}
  return { ...base, paymentRevoked: true, paymentRevokedNote: note }
}

function notice(reason: DealVoidNotice['reason'], message: string): DealVoidNotice {
  return { recorded: false, alreadyRecorded: false, reason, message }
}

async function configuredMilestone(db: SupabaseClient, clientId: string): Promise<DealMilestone | null | 'malformed'> {
  const { data, error } = await db.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error) throw new Error('crm_deal_void_failed')
  const cfg = readCapiClientConfig((data as { leads_config?: unknown } | null)?.leads_config)
  if (cfg.dealMilestoneMalformed) return 'malformed'
  return cfg.dealMilestone
}

async function loadStamps(db: SupabaseClient, outcomeIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (outcomeIds.length === 0) return out
  const { data, error } = await db.from('me_conversion_audit').select('outcome_id, detail').in('outcome_id', outcomeIds).eq('action', 'created')
  if (error) throw new Error('crm_deal_void_failed')
  for (const item of Array.isArray(data) ? data as Array<Record<string, unknown>> : []) {
    const id = typeof item.outcome_id === 'string' ? item.outcome_id : null
    if (!id || out.has(id)) continue
    out.set(id, stampOf(item.detail))
  }
  return out
}

function stampOf(detail: unknown): string | null {
  if (detail == null || typeof detail !== 'object' || Array.isArray(detail)) return null
  const milestone = (detail as { milestone?: unknown }).milestone
  return milestone === 'deposit' || milestone === 'balance' ? milestone : null
}

async function bookingContact(db: SupabaseClient, clientId: string, bookingId: string): Promise<string | null> {
  const { data, error } = await db.from('crm_bookings').select('contact_id').eq('id', bookingId).eq('client_id', clientId).maybeSingle()
  if (error) throw new Error('crm_deal_void_failed')
  const contactId = (data as { contact_id?: unknown } | null)?.contact_id
  return typeof contactId === 'string' ? contactId : null
}

async function loadDeals(db: SupabaseClient, clientId: string, sourceRef: string): Promise<DealVoidRow[]> {
  const { data, error } = await db.from('me_sale_outcomes').select('id, review_status').eq('client_id', clientId)
    .eq('source_kind', CRM_STAGE_MANUAL_SOURCE).eq('source_ref', sourceRef)
    .in('review_status', ['pending_review', 'approved'])
  if (error) throw new Error('crm_deal_void_failed')
  const outcomes = Array.isArray(data) ? data as Array<{ id?: unknown; review_status?: unknown }> : []
  const ids = outcomes.filter((row) => typeof row.id === 'string').map((row) => row.id as string)
  const writebacks = await loadWritebacks(db, ids)
  return outcomes.filter((row) => typeof row.id === 'string').map((row) => ({
    id: row.id as string,
    reviewStatus: typeof row.review_status === 'string' ? row.review_status : '',
    writebacks: writebacks.filter((item) => item.outcomeId === row.id),
  }))
}

async function loadWritebacks(db: SupabaseClient, outcomeIds: string[]): Promise<Array<DealVoidWriteback & { outcomeId: string }>> {
  if (outcomeIds.length === 0) return []
  const { data, error } = await db.from('me_conversion_writebacks').select('id, outcome_id, status, payload_preview').in('outcome_id', outcomeIds)
  if (error) throw new Error('crm_deal_void_failed')
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
  return rows.filter((row) => typeof row.id === 'string').map((row) => ({
    id: row.id as string,
    outcomeId: typeof row.outcome_id === 'string' ? row.outcome_id : '',
    status: typeof row.status === 'string' ? row.status : '',
    payloadPreview: row.payload_preview,
  }))
}
