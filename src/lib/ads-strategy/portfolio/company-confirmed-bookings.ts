/**
 * CRM booking outcomes for the internal Ads Health result card.
 *
 * This is a read-only bridge over existing CRM audit, first-touch, account
 * registry and ad snapshot facts. It deliberately does not feed the budget
 * diagnostics: `crm_first_touch` is not budget-attributable in outcome-ladder.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { todayIso } from '@/lib/tour-catalog/dates'
import type { BookingStatus } from '@/lib/crm/booking-types'
import { isAttributed, normalisePlatform } from '@/lib/crm/attribution'
import type { OriginKind } from '@/lib/crm/sales-progress/types'
import { findSharedAdAccounts } from '@/lib/meta/client-ad-accounts'
import { supabaseAdmin } from '@/lib/supabase'
import { ownershipOfAds } from './diagnostics/ownership'
import type { AttributionMethod, OutcomeCount } from './outcome-ladder'

const PAGE_CAP = 20_000
const ID_CHUNK = 100

export interface CompanyConfirmedBookingOutcome extends OutcomeCount {
  /** Inclusive booked_on window, anchored to the latest Ads Health report date. */
  window_start: string
  window_end: string
  /** Null means a source read or ownership check was incomplete. */
  source_ad_count: number | null
}

interface BookingFact {
  client_id: string
  id: string
  contact_id: string
  booked_on: string
  status: BookingStatus
  origin_kind: OriginKind | 'unrecognized' | null
  evidence_ref: string | null
}

interface BookingEventFact {
  client_id: string
  booking_id: string
  action: string
  source: string
  detail: unknown
}

interface ContactFact {
  client_id: string
  id: string
  attr_platform: string | null
  attr_ad_id: string | null
  first_attributed_at: string | null
}

interface TouchpointFact {
  client_id: string
  id: string
  contact_id: string
  occurred_at: string
  attr_platform: string | null
  attr_ad_id: string | null
  attr_adset_id: string | null
  attr_campaign_id: string | null
  attr_ad_name: string | null
  attr_creative_ref: string | null
}

interface AdFact {
  client_id: string
  ad_account_id: string
  entity_id: string
  creative_page_id: string | null
}

export interface ResolveCompanyConfirmedBookingsInput {
  clientId: string
  windowStart: string
  windowEnd: string
  bookings: readonly BookingFact[]
  events: readonly BookingEventFact[]
  contacts: readonly ContactFact[]
  touchpoints: readonly TouchpointFact[]
  accountIds: readonly string[]
  sharedAccountIds: ReadonlySet<string>
  adFacts: readonly AdFact[]
  clientPageId: string | null
}

export type CompanyConfirmedBookingUnknownReason =
  | '统计窗口无效'
  | '订单客户归属无法核实'
  | '订单记录无法完整核实'
  | '公司确认依据未通过创建审计核验'
  | '联系人首次归因缺失或无法确认早于预订日期'
  | '广告来源无法唯一核实'
  | '客户广告账户归属无法核实'
  | '广告账户存在共享或冲突'
  | '广告不属于已登记的客户主页'
  | 'CRM 预订读取权限或配置不可用'
  | '读取 CRM 或广告事实失败'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const EVIDENCE_REF = /^[A-Z0-9]{3,40}$/

function unknownOutcome(windowStart: string, windowEnd: string, note: CompanyConfirmedBookingUnknownReason): CompanyConfirmedBookingOutcome {
  return {
    step: 'deal',
    value: null,
    attribution: 'none',
    note,
    window_start: windowStart,
    window_end: windowEnd,
    source_ad_count: null,
  }
}

export function unknownCompanyConfirmedBookingOutcome(
  windowStart: string,
  windowEnd: string,
  note: CompanyConfirmedBookingUnknownReason,
): CompanyConfirmedBookingOutcome {
  return unknownOutcome(windowStart, windowEnd, note)
}

function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function mapBooking(value: unknown): BookingFact | null {
  const row = record(value)
  if (!row || typeof row.client_id !== 'string' || typeof row.id !== 'string' || typeof row.contact_id !== 'string' ||
    typeof row.booked_on !== 'string' || (row.status !== 'active' && row.status !== 'cancelled')) return null
  if (row.origin_kind !== null && row.origin_kind !== undefined && typeof row.origin_kind !== 'string') return null
  if (row.evidence_ref !== null && row.evidence_ref !== undefined && typeof row.evidence_ref !== 'string') return null
  return {
    client_id: row.client_id,
    id: row.id,
    contact_id: row.contact_id,
    booked_on: row.booked_on,
    status: row.status,
    origin_kind: row.origin_kind === null || row.origin_kind === undefined
      ? null
      : (['company_confirmed', 'customer_stated', 'staff_entered'] as const).includes(row.origin_kind as OriginKind)
        ? row.origin_kind as OriginKind
        : 'unrecognized',
    evidence_ref: stringOrNull(row.evidence_ref),
  }
}

function mapEvent(value: unknown): BookingEventFact | null {
  const row = record(value)
  if (!row || typeof row.client_id !== 'string' || typeof row.booking_id !== 'string' ||
    typeof row.action !== 'string' || typeof row.source !== 'string') return null
  return { client_id: row.client_id, booking_id: row.booking_id, action: row.action, source: row.source, detail: row.detail }
}

function mapContact(value: unknown): ContactFact | null {
  const row = record(value)
  if (!row || typeof row.client_id !== 'string' || typeof row.id !== 'string') return null
  if (row.attr_platform !== null && row.attr_platform !== undefined && typeof row.attr_platform !== 'string') return null
  if (row.attr_ad_id !== null && row.attr_ad_id !== undefined && typeof row.attr_ad_id !== 'string') return null
  if (row.first_attributed_at !== null && row.first_attributed_at !== undefined && typeof row.first_attributed_at !== 'string') return null
  return {
    client_id: row.client_id,
    id: row.id,
    attr_platform: stringOrNull(row.attr_platform),
    attr_ad_id: stringOrNull(row.attr_ad_id),
    first_attributed_at: stringOrNull(row.first_attributed_at),
  }
}

function mapTouchpoint(value: unknown): TouchpointFact | null {
  const row = record(value)
  if (!row || typeof row.client_id !== 'string' || typeof row.id !== 'string' || typeof row.contact_id !== 'string' ||
    typeof row.occurred_at !== 'string') return null
  const nullableFields = ['attr_platform', 'attr_ad_id', 'attr_adset_id', 'attr_campaign_id', 'attr_ad_name', 'attr_creative_ref']
  if (nullableFields.some(key => row[key] !== null && row[key] !== undefined && typeof row[key] !== 'string')) return null
  return {
    client_id: row.client_id,
    id: row.id,
    contact_id: row.contact_id,
    occurred_at: row.occurred_at,
    attr_platform: stringOrNull(row.attr_platform),
    attr_ad_id: stringOrNull(row.attr_ad_id),
    attr_adset_id: stringOrNull(row.attr_adset_id),
    attr_campaign_id: stringOrNull(row.attr_campaign_id),
    attr_ad_name: stringOrNull(row.attr_ad_name),
    attr_creative_ref: stringOrNull(row.attr_creative_ref),
  }
}

function mapAdFact(value: unknown): AdFact | null {
  const row = record(value)
  if (!row || typeof row.client_id !== 'string' || typeof row.ad_account_id !== 'string' || typeof row.entity_id !== 'string') return null
  if (row.creative_page_id !== null && row.creative_page_id !== undefined && typeof row.creative_page_id !== 'string') return null
  return {
    client_id: row.client_id,
    ad_account_id: row.ad_account_id,
    entity_id: row.entity_id,
    creative_page_id: stringOrNull(row.creative_page_id),
  }
}

function dedupeBookings(rows: readonly BookingFact[]): BookingFact[] | null {
  const byId = new Map<string, BookingFact>()
  for (const row of rows) {
    const previous = byId.get(row.id)
    if (previous && (previous.client_id !== row.client_id || previous.contact_id !== row.contact_id ||
      previous.booked_on !== row.booked_on || previous.status !== row.status || previous.origin_kind !== row.origin_kind ||
      previous.evidence_ref !== row.evidence_ref)) return null
    byId.set(row.id, row)
  }
  return Array.from(byId.values())
}

function normaliseAccountId(value: string): string {
  return value.replace(/^act_/, '')
}

/** Pure, fail-closed resolver used by both the loader and offline fixtures. */
export function resolveCompanyConfirmedBookings(input: ResolveCompanyConfirmedBookingsInput): CompanyConfirmedBookingOutcome {
  const { clientId, windowStart, windowEnd } = input
  if (!isValidDate(windowStart) || !isValidDate(windowEnd) || windowStart > windowEnd) {
    return unknownOutcome(windowStart, windowEnd, '统计窗口无效')
  }

  const bookings = dedupeBookings(input.bookings)
  if (!bookings) return unknownOutcome(windowStart, windowEnd, '订单记录无法完整核实')
  const inWindow: BookingFact[] = []
  for (const booking of bookings) {
    if (booking.client_id !== clientId) return unknownOutcome(windowStart, windowEnd, '订单客户归属无法核实')
    if (!isValidDate(booking.booked_on)) {
      return unknownOutcome(windowStart, windowEnd, '订单记录无法完整核实')
    }
    if (booking.status === 'active' && booking.booked_on >= windowStart && booking.booked_on <= windowEnd) inWindow.push(booking)
  }

  const eventByBooking = new Map<string, BookingEventFact[]>()
  for (const event of input.events) {
    if (event.client_id !== clientId) return unknownOutcome(windowStart, windowEnd, '订单客户归属无法核实')
    const list = eventByBooking.get(event.booking_id) ?? []
    list.push(event)
    eventByBooking.set(event.booking_id, list)
  }

  const contactsById = new Map<string, ContactFact[]>()
  for (const contact of input.contacts) {
    if (contact.client_id !== clientId) return unknownOutcome(windowStart, windowEnd, '订单客户归属无法核实')
    const list = contactsById.get(contact.id) ?? []
    list.push(contact)
    contactsById.set(contact.id, list)
  }

  const touchpointsByContact = new Map<string, TouchpointFact[]>()
  for (const touchpoint of input.touchpoints) {
    if (touchpoint.client_id !== clientId) return unknownOutcome(windowStart, windowEnd, '订单客户归属无法核实')
    const list = touchpointsByContact.get(touchpoint.contact_id) ?? []
    list.push(touchpoint)
    touchpointsByContact.set(touchpoint.contact_id, list)
  }
  if (input.adFacts.some(fact => fact.client_id !== clientId)) {
    return unknownOutcome(windowStart, windowEnd, '广告来源无法唯一核实')
  }

  const accountIds = new Set(input.accountIds)
  const countableAdIds = new Set<string>()
  let count = 0

  for (const booking of inWindow) {
    // Customer-stated is a known, distinct category and never contributes to this metric.
    if (booking.origin_kind === 'customer_stated') continue
    if (booking.origin_kind !== 'company_confirmed' || !booking.evidence_ref || !EVIDENCE_REF.test(booking.evidence_ref)) {
      return unknownOutcome(windowStart, windowEnd, '公司确认依据未通过创建审计核验')
    }

    const created = (eventByBooking.get(booking.id) ?? []).filter(event => event.action === 'created')
    const detail = created.length === 1 ? record(created[0].detail) : null
    if (created.length !== 1 || created[0].source !== 'staff' || detail?.origin_kind !== 'company_confirmed' || detail.has_evidence_ref !== true) {
      return unknownOutcome(windowStart, windowEnd, '公司确认依据未通过创建审计核验')
    }

    const contactRows = contactsById.get(booking.contact_id) ?? []
    if (contactRows.length !== 1) return unknownOutcome(windowStart, windowEnd, '联系人首次归因缺失或无法确认早于预订日期')
    const contact = contactRows[0]
    const platform = normalisePlatform(contact.attr_platform)
    if (!platform || !contact.first_attributed_at) {
      return unknownOutcome(windowStart, windowEnd, '联系人首次归因缺失或无法确认早于预订日期')
    }
    const firstTouchMs = Date.parse(contact.first_attributed_at)
    if (!Number.isFinite(firstTouchMs) || todayIso(new Date(firstTouchMs)) >= booking.booked_on) {
      return unknownOutcome(windowStart, windowEnd, '联系人首次归因缺失或无法确认早于预订日期')
    }

    // contacts carries a first-touch summary; corroborate it against the
    // original touchpoint trail so a populated contact column alone is not proof.
    const attributedTouchpoints = (touchpointsByContact.get(contact.id) ?? []).filter(touchpoint => isAttributed({
      platform: normalisePlatform(touchpoint.attr_platform),
      adId: touchpoint.attr_ad_id,
      adsetId: touchpoint.attr_adset_id,
      campaignId: touchpoint.attr_campaign_id,
      adName: touchpoint.attr_ad_name,
      creativeRef: touchpoint.attr_creative_ref,
    }))
    const timedTouchpoints = attributedTouchpoints.map(touchpoint => ({ touchpoint, at: Date.parse(touchpoint.occurred_at) }))
    if (timedTouchpoints.some(point => !Number.isFinite(point.at))) {
      return unknownOutcome(windowStart, windowEnd, '联系人首次归因缺失或无法确认早于预订日期')
    }
    const earliestAt = timedTouchpoints.reduce((min, point) => Math.min(min, point.at), Number.POSITIVE_INFINITY)
    const firstTouchpoints = timedTouchpoints.filter(point => point.at === earliestAt)
    if (firstTouchpoints.length !== 1 || earliestAt !== firstTouchMs ||
      normalisePlatform(firstTouchpoints[0].touchpoint.attr_platform) !== platform ||
      firstTouchpoints[0].touchpoint.attr_ad_id !== contact.attr_ad_id) {
      return unknownOutcome(windowStart, windowEnd, '联系人首次归因缺失或无法确认早于预订日期')
    }
    if (platform !== 'meta') continue
    if (!contact.attr_ad_id) {
      return unknownOutcome(windowStart, windowEnd, '联系人首次归因缺失或无法确认早于预订日期')
    }

    const matchingFacts = input.adFacts.filter(fact => fact.entity_id === contact.attr_ad_id && accountIds.has(fact.ad_account_id))
    const matchingAccounts = new Set(matchingFacts.map(fact => fact.ad_account_id))
    if (matchingAccounts.size !== 1) return unknownOutcome(windowStart, windowEnd, '广告来源无法唯一核实')
    const adAccountId = Array.from(matchingAccounts)[0]
    if (input.sharedAccountIds.has(normaliseAccountId(adAccountId))) {
      return unknownOutcome(windowStart, windowEnd, '广告账户存在共享或冲突')
    }
    if (!input.clientPageId || ownershipOfAds(matchingFacts.map(fact => ({ creative_page_id: fact.creative_page_id })), input.clientPageId) !== 'own') {
      return unknownOutcome(windowStart, windowEnd, '广告不属于已登记的客户主页')
    }
    countableAdIds.add(contact.attr_ad_id)
    count += 1
  }

  const attribution: AttributionMethod = 'crm_first_touch'
  return {
    step: 'deal', // Existing business-outcome rung; the UI must retain the precise “company-confirmed booking” label.
    value: count,
    attribution,
    window_start: windowStart,
    window_end: windowEnd,
    source_ad_count: countableAdIds.size,
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function readAll(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<unknown[]> {
  return fetchAll<unknown>(page, PAGE_CAP)
}

async function readBookings(db: SupabaseClient, clientId: string, start: string, end: string): Promise<unknown[]> {
  return readAll((from, to) => db.from('crm_bookings')
    .select('client_id, id, contact_id, booked_on, status, origin_kind, evidence_ref')
    .eq('client_id', clientId).gte('booked_on', start).lte('booked_on', end)
    .order('id', { ascending: true }).range(from, to))
}

async function readEvents(db: SupabaseClient, clientId: string, bookingIds: string[]): Promise<unknown[]> {
  const out: unknown[] = []
  for (const ids of chunks(bookingIds, ID_CHUNK)) {
    out.push(...await readAll((from, to) => db.from('crm_booking_events')
      .select('client_id, booking_id, action, source, detail')
      .eq('client_id', clientId).eq('action', 'created').in('booking_id', ids)
      .order('booking_id', { ascending: true }).range(from, to)))
  }
  return out
}

async function readContacts(db: SupabaseClient, clientId: string, contactIds: string[]): Promise<unknown[]> {
  const out: unknown[] = []
  for (const ids of chunks(contactIds, ID_CHUNK)) {
    out.push(...await readAll((from, to) => db.from('contacts')
      .select('client_id, id, attr_platform, attr_ad_id, first_attributed_at')
      .eq('client_id', clientId).in('id', ids)
      .order('id', { ascending: true }).range(from, to)))
  }
  return out
}

async function readTouchpoints(db: SupabaseClient, clientId: string, contactIds: string[]): Promise<unknown[]> {
  const out: unknown[] = []
  for (const ids of chunks(contactIds, ID_CHUNK)) {
    out.push(...await readAll((from, to) => db.from('contact_touchpoints')
      .select('client_id, id, contact_id, occurred_at, attr_platform, attr_ad_id, attr_adset_id, attr_campaign_id, attr_ad_name, attr_creative_ref')
      .eq('client_id', clientId).in('contact_id', ids)
      .order('occurred_at', { ascending: true }).order('id', { ascending: true }).range(from, to)))
  }
  return out
}

/** Load a complete, tenant-scoped and audit-backed booking result for one report window. */
export async function loadCompanyConfirmedBookingOutcome(
  clientId: string,
  windowStart: string,
  windowEnd: string,
  db: SupabaseClient = supabaseAdmin,
): Promise<CompanyConfirmedBookingOutcome> {
  try {
    const rawBookings = await readBookings(db, clientId, windowStart, windowEnd)
    const bookings = rawBookings.map(mapBooking)
    if (bookings.some(row => row === null)) return unknownOutcome(windowStart, windowEnd, '订单记录无法完整核实')
    const bookingFacts = bookings as BookingFact[]
    const active = bookingFacts.filter(row => row.status === 'active' && row.booked_on >= windowStart && row.booked_on <= windowEnd)
    const companyConfirmed = active.filter(row => row.origin_kind === 'company_confirmed')
    const [rawEvents, rawContacts] = await Promise.all([
      companyConfirmed.length > 0 ? readEvents(db, clientId, companyConfirmed.map(row => row.id)) : Promise.resolve([]),
      companyConfirmed.length > 0 ? readContacts(db, clientId, Array.from(new Set(companyConfirmed.map(row => row.contact_id)))) : Promise.resolve([]),
    ])
    const events = rawEvents.map(mapEvent)
    const contacts = rawContacts.map(mapContact)
    if (events.some(row => row === null) || contacts.some(row => row === null)) {
      return unknownOutcome(windowStart, windowEnd, '读取 CRM 或广告事实失败')
    }
    const contactFacts = contacts as ContactFact[]
    const needsMetaAdFacts = companyConfirmed.some(booking => {
      const contact = contactFacts.find(row => row.id === booking.contact_id)
      return normalisePlatform(contact?.attr_platform) === 'meta' && Boolean(contact?.attr_ad_id)
    })
    const touchpointContactIds = Array.from(new Set(companyConfirmed.map(booking => booking.contact_id)))
    const rawTouchpoints = touchpointContactIds.length > 0 ? await readTouchpoints(db, clientId, touchpointContactIds) : []
    const touchpoints = rawTouchpoints.map(mapTouchpoint)
    if (touchpoints.some(row => row === null)) return unknownOutcome(windowStart, windowEnd, '读取 CRM 或广告事实失败')

    let accountIds: string[] = []
    let sharedAccountIds = new Set<string>()
    let adFacts: AdFact[] = []
    let clientPageId: string | null = null
    if (needsMetaAdFacts) {
      const accountRes = await db.from('client_meta_ad_accounts').select('client_id, ad_account_id').eq('client_id', clientId)
      if (accountRes.error) return unknownOutcome(windowStart, windowEnd, '客户广告账户归属无法核实')
      const accountRows = (accountRes.data ?? []) as unknown[]
      if (!Array.isArray(accountRows) || accountRows.some(row => {
        const value = record(row)
        return !value || typeof value.client_id !== 'string' || typeof value.ad_account_id !== 'string'
      })) return unknownOutcome(windowStart, windowEnd, '客户广告账户归属无法核实')
      const mappedAccounts = accountRows.map(row => row as { client_id: string; ad_account_id: string })
      if (mappedAccounts.some(row => row.client_id !== clientId)) return unknownOutcome(windowStart, windowEnd, '客户广告账户归属无法核实')
      accountIds = Array.from(new Set(mappedAccounts.map(row => row.ad_account_id)))
      if (accountIds.length === 0) return unknownOutcome(windowStart, windowEnd, '客户广告账户归属无法核实')

      const shared = await findSharedAdAccounts(clientId, accountIds)
      if (shared.error) return unknownOutcome(windowStart, windowEnd, '广告账户存在共享或冲突')
      sharedAccountIds = shared.shared

      const pageRes = await db.from('clients').select('facebook_page_id').eq('id', clientId).maybeSingle()
      if (pageRes.error || typeof pageRes.data?.facebook_page_id !== 'string') {
        return unknownOutcome(windowStart, windowEnd, '广告不属于已登记的客户主页')
      }
      clientPageId = pageRes.data.facebook_page_id

      const adIds = Array.from(new Set(contactFacts.flatMap(row => row.attr_platform === 'meta' && row.attr_ad_id ? [row.attr_ad_id] : [])))
      const rawFacts: unknown[] = []
      for (const ids of chunks(adIds, ID_CHUNK)) {
        rawFacts.push(...await readAll((from, to) => db.from('ad_entity_snapshots')
          .select('client_id, ad_account_id, entity_id, creative_page_id')
          .eq('client_id', clientId).eq('level', 'ad').in('ad_account_id', accountIds).in('entity_id', ids)
          .order('entity_id', { ascending: true }).order('captured_at', { ascending: true }).range(from, to)))
      }
      const mappedFacts = rawFacts.map(mapAdFact)
      if (mappedFacts.some(row => row === null)) return unknownOutcome(windowStart, windowEnd, '广告来源无法唯一核实')
      adFacts = mappedFacts as AdFact[]
    }

    return resolveCompanyConfirmedBookings({
      clientId,
      windowStart,
      windowEnd,
      bookings: bookingFacts,
      events: events as BookingEventFact[],
      contacts: contactFacts,
      touchpoints: touchpoints as TouchpointFact[],
      accountIds,
      sharedAccountIds,
      adFacts,
      clientPageId,
    })
  } catch {
    // Do not leak DB error text or mistake a failed/partial read for a zero.
    return unknownOutcome(windowStart, windowEnd, '读取 CRM 或广告事实失败')
  }
}
