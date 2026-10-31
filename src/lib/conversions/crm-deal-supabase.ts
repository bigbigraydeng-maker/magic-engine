/**
 * Supabase adapter for {@link recordMilestoneDeal}. Reads stay filtered by
 * client id. Insert errors become a result; they never include database text
 * in the value returned to the payment route.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DncTouch } from '@/lib/crm/dnc'
import { loadDealPriceTexts } from '@/lib/tour-catalog/deal-price-facts'
import {
  PAYMENT_DEAL_FAIL_MESSAGE,
  recordMilestoneDeal,
  type ApprovedPurchase,
  type DealBooking,
  type DealIo,
} from './crm-deal-record'
import type { DealMilestone } from './capi-client-config'
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
    insertOutcome: (row) => insertOutcome(db, row),
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
  }
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
  const rows = await many(db, 'contact_touchpoints', 'source_ref', [['contact_id', contactId], ['client_id', clientId], ['source', 'meta_lead_form']])
  for (const row of rows) {
    const ref = str(row.source_ref)
    if (ref && /^\d{15,17}$/.test(ref)) return ref
  }
  return null
}

async function loadApproved(db: SupabaseClient, clientId: string, contactId: string): Promise<ApprovedPurchase[]> {
  const rows = await many(db, 'me_sale_outcomes', 'source_kind, occurred_at, review_status, outcome_kind', [
    ['client_id', clientId],
    ['contact_id', contactId],
    ['outcome_kind', 'purchase'],
    ['review_status', 'approved'],
  ])
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

async function insertOutcome(db: SupabaseClient, row: IntakeRow): Promise<{ ok: true; id: string } | { ok: false; duplicate: boolean }> {
  const { data, error } = await db.from('me_sale_outcomes').insert(row).select('id').single()
  if (error) return { ok: false, duplicate: codeOf(error) === '23505' }
  const id = str(asRow(data)?.id)
  if (!id) return { ok: false, duplicate: false }
  await writeAudit(db, id, row)
  return { ok: true, id }
}

async function writeAudit(db: SupabaseClient, outcomeId: string, row: IntakeRow): Promise<void> {
  const { error } = await db.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action: 'created',
    actor: row.created_by,
    detail: { source_kind: row.source_kind, source_ref: row.source_ref },
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
