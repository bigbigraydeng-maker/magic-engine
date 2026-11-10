/**
 * 把「定金已确认且金额等于所订团的每人标价」的成交，走现有发送路径告诉广告平台。
 *
 * 开关是 `clients.conversion_payment_match_enabled`，默认关。跟 AI 自动审核那个开关
 * 不是同一件事：那个开关是让模型判断该不该发；这个开关只放行下面这一条确定规则。
 * 关着、或库里还没有这一列时，什么都不发，待核对仍留给人。
 *
 * 发送走 `sendApprovedOutcome`，不另写一套。7 天窗口、拒联、同一条不发两次，都在那边。
 * 这里额外挡住「同一条预订已经按这条规则发过」和「人已经批准过同样金额的那一笔」。
 * 判断用调用方传入的时间；真正发送不传这个时间（发送状态机要用真实时间）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { approvalCutoffIso } from './event-window'
import {
  PAYMENT_MATCH_ACTOR,
  PAYMENT_MATCH_AUDIT,
  PAYMENT_MATCH_RULE,
  decidePaymentMatch,
  resolveBookedTourPrice,
  type CatalogPrice,
  type HoldReason,
  type MatchBooking,
} from './payment-match'
import { sendApprovedOutcome, type SendDeps } from './writeback-service'

const SWITCH = 'conversion_payment_match_enabled'
const SCAN_CAP = 50
const APPROVED_CAP = 200
export const MAX_PAYMENT_MATCH_SENDS = 20

const PENDING_COLUMNS =
  'id, client_id, contact_id, outcome_kind, customer_email, customer_phone, amount_minor, currency, occurred_at'

export interface PaymentMatchRunSummary {
  enabledClientIds: string[]
  scanned: number
  sent: number
  held: number
  heldByReason: Record<string, number>
  sendStatuses: Record<string, number>
}

interface PendingRow {
  id: string
  client_id: string
  contact_id: string | null
  outcome_kind: string
  customer_email: string | null
  customer_phone: string | null
  amount_minor: number | null
  currency: string | null
  occurred_at: string
}

interface ApprovedRow {
  id: string
  contact_id: string | null
  amount_minor: number | null
  currency: string | null
}

interface BookingRow {
  id: string
  contact_id: string
  tour_id: string
  departure_id: string | null
}

interface ClientFacts {
  phoneCountry: string | null
  identities: Map<string, { emails: string[]; phones: string[] }>
  bookingsByContact: Map<string, MatchBooking[]>
  approved: ApprovedRow[]
  usedBookingIds: Set<string>
}

type DbError = { message: string; details?: string } | null

function columnMissing(error: { message: string; details?: string }): boolean {
  return `${error.message} ${error.details ?? ''}`.includes(SWITCH)
}

function fail(error: DbError, what: string): void {
  if (error) throw new Error(`${what}：${error.message}`)
}

function emptySummary(enabledClientIds: string[]): PaymentMatchRunSummary {
  return { enabledClientIds, scanned: 0, sent: 0, held: 0, heldByReason: {}, sendStatuses: {} }
}

function bump(bag: Record<string, number>, key: string, count = 1): void {
  bag[key] = (bag[key] ?? 0) + count
}

export async function listPaymentMatchClientIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from('clients').select('id').eq(SWITCH, true)
  if (error) {
    if (columnMissing(error)) return []
    throw new Error(`读取成交自动回传开关失败：${error.message}`)
  }
  return ((data ?? []) as { id: string }[]).map((row) => row.id)
}

/** AI 审核用来避开成交行。列还不在时当作关，免得早上那一轮整段失败。 */
export async function readPaymentMatchEnabled(supabase: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await supabase.from('clients').select(SWITCH).eq('id', clientId).maybeSingle()
  if (error) {
    if (columnMissing(error)) {
      console.warn('[payment-match] 开关列还不在，成交仍走原来的审核')
      return false
    }
    throw new Error(`读取成交自动回传开关失败：${error.message}`)
  }
  return (data as { conversion_payment_match_enabled?: boolean } | null)?.conversion_payment_match_enabled === true
}

async function loadPending(supabase: SupabaseClient, clientId: string, now: Date): Promise<PendingRow[]> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select(PENDING_COLUMNS)
    .eq('client_id', clientId)
    .eq('review_status', 'pending_review')
    .eq('outcome_kind', 'purchase')
    .is('redacted_at', null)
    .gte('occurred_at', approvalCutoffIso(now))
    .order('occurred_at', { ascending: true })
    .limit(SCAN_CAP)
  fail(error, '读取待核对成交失败')
  return (data ?? []) as PendingRow[]
}

async function loadApproved(supabase: SupabaseClient, clientId: string): Promise<ApprovedRow[] | 'unproven'> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, contact_id, amount_minor, currency')
    .eq('client_id', clientId)
    .eq('outcome_kind', 'purchase')
    .eq('review_status', 'approved')
    .is('redacted_at', null)
    .limit(APPROVED_CAP)
  fail(error, '读取已批准成交失败')
  const rows = (data ?? []) as ApprovedRow[]
  return rows.length >= APPROVED_CAP ? 'unproven' : rows
}

async function loadUsedBookingIds(supabase: SupabaseClient, outcomeIds: string[]): Promise<Set<string>> {
  const used = new Set<string>()
  if (outcomeIds.length === 0) return used
  const { data, error } = await supabase
    .from('me_conversion_audit')
    .select('detail')
    .eq('action', PAYMENT_MATCH_AUDIT)
    .in('outcome_id', outcomeIds)
  fail(error, '读取已回传记录失败')
  for (const row of (data ?? []) as { detail: unknown }[]) {
    if (!row.detail || typeof row.detail !== 'object' || Array.isArray(row.detail)) continue
    const bookingId = (row.detail as { booking_id?: unknown }).booking_id
    if (typeof bookingId === 'string') used.add(bookingId)
  }
  return used
}

async function loadPhoneCountry(supabase: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await supabase.from('clients').select('default_phone_country').eq('id', clientId).maybeSingle()
  fail(error, '读取客户电话区号失败')
  return (data as { default_phone_country: string | null } | null)?.default_phone_country ?? null
}

async function loadIdentities(
  supabase: SupabaseClient,
  clientId: string,
  contactIds: string[],
): Promise<Map<string, { emails: string[]; phones: string[] }>> {
  const map = new Map<string, { emails: string[]; phones: string[] }>()
  if (contactIds.length === 0) return map
  const { data, error } = await supabase
    .from('contact_identities')
    .select('contact_id, kind, value')
    .eq('client_id', clientId)
    .in('contact_id', contactIds)
  fail(error, '读取联系人身份失败')
  for (const row of (data ?? []) as { contact_id: string; kind: string; value: string }[]) {
    const cur = map.get(row.contact_id) ?? { emails: [], phones: [] }
    if (row.kind === 'email') cur.emails.push(row.value)
    if (row.kind === 'phone') cur.phones.push(row.value)
    map.set(row.contact_id, cur)
  }
  return map
}

async function loadBookingRows(supabase: SupabaseClient, clientId: string, contactIds: string[]): Promise<BookingRow[]> {
  if (contactIds.length === 0) return []
  const { data, error } = await supabase
    .from('crm_bookings')
    .select('id, contact_id, tour_id, departure_id')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .in('contact_id', contactIds)
  fail(error, '读取预订失败')
  return (data ?? []) as BookingRow[]
}

async function loadPaidDepositIds(supabase: SupabaseClient, clientId: string, bookingIds: string[]): Promise<Set<string>> {
  const paid = new Set<string>()
  if (bookingIds.length === 0) return paid
  const { data, error } = await supabase
    .from('crm_booking_milestones')
    .select('booking_id')
    .eq('client_id', clientId)
    .eq('kind', 'deposit')
    .eq('state', 'paid')
    .in('booking_id', bookingIds)
  fail(error, '读取定金状态失败')
  for (const row of (data ?? []) as { booking_id: string }[]) paid.add(row.booking_id)
  return paid
}

async function loadTextMap(
  supabase: SupabaseClient,
  table: 'tour_catalog_tours' | 'tour_catalog_departures',
  column: 'display_price_text' | 'price_text_override',
  clientId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (ids.length === 0) return map
  const { data, error } = await supabase.from(table).select(`id, ${column}`).eq('client_id', clientId).in('id', ids)
  fail(error, '读取团价失败')
  for (const row of (data ?? []) as Record<string, string | null>[]) {
    const id = row.id
    if (typeof id === 'string') map.set(id, row[column] ?? null)
  }
  return map
}

function priceOf(
  booking: BookingRow,
  tours: Map<string, string | null>,
  departures: Map<string, string | null>,
): CatalogPrice | null {
  const display = tours.get(booking.tour_id) ?? null
  if (booking.departure_id) {
    if (!departures.has(booking.departure_id)) return null
    return resolveBookedTourPrice(departures.get(booking.departure_id), display)
  }
  if (!tours.has(booking.tour_id)) return null
  return resolveBookedTourPrice(null, display)
}

async function loadFacts(
  supabase: SupabaseClient,
  clientId: string,
  pending: PendingRow[],
  approved: ApprovedRow[],
): Promise<ClientFacts> {
  const contactIds = [...new Set(pending.map((row) => row.contact_id).filter((id): id is string => !!id))]
  const [phoneCountry, identities, bookingRows, usedBookingIds] = await Promise.all([
    loadPhoneCountry(supabase, clientId),
    loadIdentities(supabase, clientId, contactIds),
    loadBookingRows(supabase, clientId, contactIds),
    loadUsedBookingIds(supabase, approved.map((row) => row.id)),
  ])
  const paid = await loadPaidDepositIds(supabase, clientId, bookingRows.map((row) => row.id))
  const tours = await loadTextMap(supabase, 'tour_catalog_tours', 'display_price_text', clientId, [
    ...new Set(bookingRows.map((row) => row.tour_id)),
  ])
  const departures = await loadTextMap(
    supabase,
    'tour_catalog_departures',
    'price_text_override',
    clientId,
    [...new Set(bookingRows.map((row) => row.departure_id).filter((id): id is string => !!id))],
  )
  const bookingsByContact = new Map<string, MatchBooking[]>()
  for (const booking of bookingRows) {
    const list = bookingsByContact.get(booking.contact_id) ?? []
    list.push({
      id: booking.id,
      tourId: booking.tour_id,
      departureId: booking.departure_id,
      depositPaid: paid.has(booking.id),
      price: priceOf(booking, tours, departures),
    })
    bookingsByContact.set(booking.contact_id, list)
  }
  return { phoneCountry, identities, bookingsByContact, approved, usedBookingIds }
}

function sameAmountApproved(approved: ApprovedRow[], row: PendingRow): boolean {
  const currency = row.currency?.trim().toUpperCase() ?? ''
  return approved.some(
    (other) =>
      other.contact_id === row.contact_id &&
      other.amount_minor === row.amount_minor &&
      (other.currency?.trim().toUpperCase() ?? '') === currency,
  )
}

async function approvePending(supabase: SupabaseClient, outcomeId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'approved',
      reviewed_by: PAYMENT_MATCH_ACTOR,
      reviewed_at: now.toISOString(),
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: crypto.randomUUID(),
      updated_at: now.toISOString(),
    })
    .eq('id', outcomeId)
    .eq('review_status', 'pending_review')
    .select('id')
  fail(error, '自动批准失败')
  return ((data ?? []) as { id: string }[]).length > 0
}

async function ledger(
  supabase: SupabaseClient,
  outcomeId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action,
    actor: PAYMENT_MATCH_ACTOR,
    detail,
  })
  if (error) console.error('[payment-match] audit failed', outcomeId, action, error.message)
}

function matchDetail(row: PendingRow, bookingId: string, tourId: string, departureId: string | null, price: CatalogPrice) {
  return {
    rule: PAYMENT_MATCH_RULE,
    booking_id: bookingId,
    tour_id: tourId,
    departure_id: departureId,
    outcome_amount_minor: row.amount_minor,
    outcome_currency: row.currency,
    tour_price_minor: price.amountMinor,
    tour_price_currency: price.currency,
    tour_price_text: price.priceText,
    price_source: price.source,
  }
}

async function sendOne(
  supabase: SupabaseClient,
  sendDeps: Omit<SendDeps, 'supabase'>,
  row: PendingRow,
  detail: Record<string, unknown>,
  now: Date,
): Promise<string | null> {
  if (!(await approvePending(supabase, row.id, now))) return null
  await ledger(supabase, row.id, PAYMENT_MATCH_AUDIT, detail)
  try {
    const sent = await sendApprovedOutcome(row.id, { supabase, ...sendDeps })
    await ledger(supabase, row.id, 'sent', { ...detail, status: sent.status })
    return sent.status
  } catch (e) {
    console.error('[payment-match] send failed', row.id, e instanceof Error ? e.name : 'unknown')
    return 'error'
  }
}

function decideRow(row: PendingRow, facts: ClientFacts, now: Date) {
  const contactId = row.contact_id
  return decidePaymentMatch({
    outcomeKind: row.outcome_kind,
    contactId,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    amountMinor: row.amount_minor,
    currency: row.currency,
    occurredAt: row.occurred_at,
    contact: contactId ? (facts.identities.get(contactId) ?? { emails: [], phones: [] }) : null,
    defaultPhoneCountry: facts.phoneCountry,
    bookings: contactId ? (facts.bookingsByContact.get(contactId) ?? []) : [],
    now,
    usedBookingIds: facts.usedBookingIds,
    approvedSameAmount: contactId ? sameAmountApproved(facts.approved, row) : false,
  })
}

async function runClient(
  supabase: SupabaseClient,
  sendDeps: Omit<SendDeps, 'supabase'>,
  clientId: string,
  now: Date,
): Promise<Omit<PaymentMatchRunSummary, 'enabledClientIds'>> {
  const summary = emptySummary([])
  const pending = await loadPending(supabase, clientId, now)
  summary.scanned = pending.length
  if (pending.length === 0) return summary
  const approved = await loadApproved(supabase, clientId)
  if (approved === 'unproven') {
    summary.held = pending.length
    summary.heldByReason.dedupe_unproven = pending.length
    return summary
  }
  const facts = await loadFacts(supabase, clientId, pending, approved)
  let sends = 0
  for (const row of pending) {
    if (sends >= MAX_PAYMENT_MATCH_SENDS) break
    const decision = decideRow(row, facts, now)
    if (decision.action === 'hold') {
      summary.held++
      bump(summary.heldByReason, decision.reason)
      continue
    }
    facts.usedBookingIds.add(decision.bookingId)
    const detail = matchDetail(row, decision.bookingId, decision.tourId, decision.departureId, decision.price)
    const status = await sendOne(supabase, sendDeps, row, detail, now)
    if (status == null) continue
    sends++
    summary.sent++
    bump(summary.sendStatuses, status)
  }
  return summary
}

export async function runPaymentMatchAutoSend(deps: {
  supabase: SupabaseClient
  sendDeps: Omit<SendDeps, 'supabase'>
  now?: Date
}): Promise<PaymentMatchRunSummary> {
  const now = deps.now ?? new Date()
  const enabledClientIds = await listPaymentMatchClientIds(deps.supabase)
  const summary = emptySummary(enabledClientIds)
  for (const clientId of enabledClientIds) {
    const one = await runClient(deps.supabase, deps.sendDeps, clientId, now)
    summary.scanned += one.scanned
    summary.sent += one.sent
    summary.held += one.held
    for (const [reason, count] of Object.entries(one.heldByReason)) bump(summary.heldByReason, reason, count)
    for (const [status, count] of Object.entries(one.sendStatuses)) bump(summary.sendStatuses, status, count)
  }
  return summary
}

export type { HoldReason }
