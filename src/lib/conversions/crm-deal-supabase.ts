/**
 * Supabase adapter for {@link recordMilestoneDeal}. Reads stay filtered by
 * client id. Insert errors become a result; they never include database text
 * in the value returned to the payment route.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DncTouch } from '@/lib/crm/dnc'
import { loadDealPriceTexts } from '@/lib/tour-catalog/deal-price-facts'
import {
  CRM_STAGE_MANUAL_SOURCE,
  DEAL_DEDUPE_WINDOW_MS,
  PAYMENT_DEAL_FAIL_MESSAGE,
  recordMilestoneDeal,
  type ApprovedPurchase,
  type DealBooking,
  type DealIo,
  type DealWrite,
} from './crm-deal-record'
import type { DealMilestone } from './capi-client-config'
import { latestMetaLeadId } from './conversion-lead'
import { readStoredPartySize } from './crm-deal-party-read'
import { dispatchCrmDeal } from './crm-deal-send'
import { readSourceDeal, restoreVoidedDeal } from './crm-deal-restore'
import type { IntakeRow } from './intake'

type Row = Record<string, unknown>

export function supabaseDealIo(db: SupabaseClient): DealIo {
  return {
    loadClient: (clientId) => loadClient(db, clientId),
    loadContact: (clientId, contactId) => loadContact(db, clientId, contactId),
    loadPsid: (clientId, contactId) => loadPsid(db, clientId, contactId),
    loadMetaLeadId: (clientId, contactId) => loadMetaLeadId(db, clientId, contactId),
    loadBooking: (clientId, bookingId) => loadBooking(db, clientId, bookingId),
    loadPriceTexts: (clientId, tourId, departureId) => loadDealPriceTexts(db, clientId, tourId, departureId),
    loadApprovedPurchases: (clientId, contactId) => loadApproved(db, clientId, contactId),
    loadDncTouches: (clientId, contactId) => loadTouches(db, clientId, contactId),
    loadStoredPartySize: (clientId, contactId) => readStoredPartySize(db, clientId, contactId),
    insertOutcome: (row, write) => insertOutcome(db, row, write),
    loadExistingSourceDeal: (clientId, sourceKind, sourceRef) => readSourceDeal(db, clientId, sourceKind, sourceRef),
    restoreVoidedDeal: async (id, row, stoppedSendIds, write) => ({ ok: await restoreVoidedDeal(db, id, row, stoppedSendIds, write) }),
    dispatchSend: (outcomeId) => dispatchCrmDeal(db, outcomeId),
  }
}

export async function paymentDealExtra(
  db: SupabaseClient,
  input: {
    clientId: string
    bookingId: string
    kind: DealMilestone
    paidOn: string | null
    actor: string | null
    changed: boolean
    reason: string | null
  },
): Promise<Record<string, unknown> | null> {
  if (input.reason === 'evidence_already_used') return null
  if (!input.changed && input.reason !== 'already_paid') return null
  try {
    const result = await recordMilestoneDeal(supabaseDealIo(db), input, new Date())
    if (!result.attempted) return null
    return {
      recorded: result.recorded,
      alreadyRecorded: result.alreadyRecorded,
      reason: result.reason,
      message: result.reason === 'record_failed' ? PAYMENT_DEAL_FAIL_MESSAGE : result.message,
      outcomeId: result.outcomeId,
    }
  } catch {
    console.info(JSON.stringify({ event: 'crm_deal.skipped', reason: 'record_failed' }))
    return {
      recorded: false,
      alreadyRecorded: false,
      reason: 'record_failed',
      message: PAYMENT_DEAL_FAIL_MESSAGE,
      outcomeId: null,
    }
  }
}

async function loadClient(db: SupabaseClient, clientId: string) {
  const row = await one(db, 'clients', 'conversion_stage, default_phone_country, leads_config', [['id', clientId]])
  if (!row) return null
  return {
    conversionStage: str(row.conversion_stage),
    defaultPhoneCountry: str(row.default_phone_country),
    leadsConfig: row.leads_config,
  }
}

async function loadContact(db: SupabaseClient, clientId: string, contactId: string) {
  const row = await one(db, 'contacts', 'primary_email, primary_phone, do_not_contact', [['id', contactId], ['client_id', clientId]])
  if (!row) return null
  return { email: str(row.primary_email), phone: str(row.primary_phone), doNotContact: row.do_not_contact === true }
}

async function loadBooking(db: SupabaseClient, clientId: string, bookingId: string): Promise<DealBooking | null> {
  const row = await one(db, 'crm_bookings', 'contact_id, party_size, tour_id, departure_id', [['id', bookingId], ['client_id', clientId]])
  if (!row || typeof row.contact_id !== 'string') return null
  return {
    contactId: row.contact_id,
    partySize: typeof row.party_size === 'number' ? row.party_size : null,
    tourId: str(row.tour_id),
    departureId: str(row.departure_id),
    paidOnByKind: await loadPaidDates(db, clientId, bookingId),
  }
}

async function loadPaidDates(
  db: SupabaseClient,
  clientId: string,
  bookingId: string,
): Promise<Partial<Record<DealMilestone, string | null>>> {
  const { data, error } = await db
    .from('crm_booking_milestones')
    .select('kind, paid_on')
    .eq('client_id', clientId)
    .eq('booking_id', bookingId)
  if (error) throw new Error('crm_deal_read_failed')
  const out: Partial<Record<DealMilestone, string | null>> = {}
  for (const item of Array.isArray(data) ? data : []) {
    const row = asRow(item)
    const kind = str(row?.kind)
    if (kind !== 'deposit' && kind !== 'balance') continue
    out[kind] = dayOf(row?.paid_on)
  }
  return out
}

function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const day = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

async function loadPsid(db: SupabaseClient, clientId: string, contactId: string): Promise<string | null> {
  const rows = await many(db, 'conversations', 'participant_psid', [['contact_id', contactId], ['client_id', clientId]], 'last_message_at')
  for (const row of rows) {
    const psid = str(row.participant_psid)
    if (psid) return psid
  }
  return null
}

async function loadMetaLeadId(db: SupabaseClient, clientId: string, contactId: string): Promise<string | null> {
  const rows = await many(
    db,
    'contact_touchpoints',
    'source_ref, occurred_at',
    [['contact_id', contactId], ['client_id', clientId], ['source', 'meta_lead_form']],
    'occurred_at',
  )
  return latestMetaLeadId(rows)
}

async function loadApproved(db: SupabaseClient, clientId: string, contactId: string): Promise<ApprovedPurchase[]> {
  const since = new Date(Date.now() - DEAL_DEDUPE_WINDOW_MS).toISOString()
  const { data, error } = await db
    .from('me_sale_outcomes')
    .select('source_kind, occurred_at, review_status, outcome_kind')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('outcome_kind', 'purchase')
    .eq('review_status', 'approved')
    .neq('source_kind', CRM_STAGE_MANUAL_SOURCE)
    .gte('occurred_at', since)
  if (error) throw new Error('crm_deal_read_failed')
  const rows = Array.isArray(data) ? data.map(asRow).filter((row): row is Row => row != null) : []
  return rows.map((row) => ({
    sourceKind: str(row.source_kind) ?? '',
    occurredAt: str(row.occurred_at) ?? '',
    reviewStatus: str(row.review_status) ?? '',
    outcomeKind: str(row.outcome_kind) ?? undefined,
  }))
}

async function loadTouches(db: SupabaseClient, clientId: string, contactId: string): Promise<DncTouch[] | null> {
  const { data, error } = await db.from('contact_touchpoints').select('occurred_at, metadata').eq('contact_id', contactId).eq('client_id', clientId)
  if (error) return null
  if (!Array.isArray(data)) return []
  return data.map((item) => touchOf(item))
}

async function insertOutcome(
  db: SupabaseClient,
  row: IntakeRow,
  write?: DealWrite,
): Promise<{ ok: true; id: string } | { ok: false; duplicate: boolean }> {
  const payload = write
    ? { ...row, review_status: write.reviewStatus, reviewed_by: write.reviewedBy, reviewed_at: write.reviewedAt }
    : row
  const { data, error } = await db.from('me_sale_outcomes').insert(payload).select('id').single()
  if (error) return { ok: false, duplicate: codeOf(error) === '23505' }
  const id = str(asRow(data)?.id)
  if (!id) return { ok: false, duplicate: false }
  await writeAudit(db, id, row, write?.milestoneKind ?? null)
  return { ok: true, id }
}

async function writeAudit(
  db: SupabaseClient,
  outcomeId: string,
  row: IntakeRow,
  milestone: DealMilestone | null,
): Promise<void> {
  const detail: Record<string, string | null> = { source_kind: row.source_kind, source_ref: row.source_ref }
  if (milestone) detail.milestone = milestone
  const { error } = await db.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action: 'created',
    actor: row.created_by,
    detail,
  })
  if (error) console.info(JSON.stringify({ event: 'crm_deal.audit_failed' }))
}

function touchOf(item: unknown): DncTouch {
  const row = asRow(item)
  const meta = asRow(row?.metadata)
  return {
    outcome: str(meta?.outcome),
    flagged: meta?.do_not_contact === true,
    occurredAt: str(row?.occurred_at) ?? '',
  }
}

async function one(db: SupabaseClient, table: string, columns: string, eqs: Array<[string, string]>): Promise<Row | null> {
  let query = db.from(table).select(columns)
  for (const [col, val] of eqs) query = query.eq(col, val)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error('crm_deal_read_failed')
  return asRow(data)
}

async function many(db: SupabaseClient, table: string, columns: string, eqs: Array<[string, string]>, order?: string): Promise<Row[]> {
  let query = db.from(table).select(columns)
  for (const [col, val] of eqs) query = query.eq(col, val)
  if (order) query = query.order(order, { ascending: false })
  const { data, error } = await query.limit(20)
  if (error) throw new Error('crm_deal_read_failed')
  return Array.isArray(data) ? data.map(asRow).filter((row): row is Row => row != null) : []
}

function asRow(value: unknown): Row | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Row
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function codeOf(error: unknown): string | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}
