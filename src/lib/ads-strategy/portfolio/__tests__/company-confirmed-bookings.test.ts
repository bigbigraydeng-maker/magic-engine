import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  sharedAccounts: new Set<string>(),
  creativeLinks: null as null | Array<{ clientId: string; platform: 'meta'; adId: string; creativeRef: string | null; creativeSource: string | null }>,
}))
vi.mock('@/lib/meta/client-ad-accounts', () => ({
  findSharedAdAccounts: async (_clientId: string, accountIds: string[]) => ({
    shared: new Set(accountIds.map(id => id.replace(/^act_/, '')).filter(id => mocks.sharedAccounts.has(id))),
  }),
}))
vi.mock('@/lib/ads/creative-link', () => ({ lookupCreativeLinksByAdIds: async () => mocks.creativeLinks }))

import { loadCompanyConfirmedBookingCreativeReference, loadCompanyConfirmedBookingOutcome, resolveCompanyConfirmedBookings, type ResolveCompanyConfirmedBookingsInput } from '../company-confirmed-bookings'

const CLIENT = 'client-a'
const OTHER = 'client-b'
const START = '2026-10-16'
const END = '2026-10-22'

const booking = {
  client_id: CLIENT, id: 'booking-1', contact_id: 'contact-1', booked_on: '2026-10-20', status: 'active',
  origin_kind: 'company_confirmed', evidence_ref: 'INV123',
} as const
const event = {
  client_id: CLIENT, booking_id: 'booking-1', action: 'created', source: 'staff',
  detail: { origin_kind: 'company_confirmed', has_evidence_ref: true },
}
const contact = {
  client_id: CLIENT, id: 'contact-1', attr_platform: 'meta', attr_ad_id: 'ad-1',
  first_attributed_at: '2026-10-18T12:00:00Z',
}
const touchpoint = {
  client_id: CLIENT, id: 'touch-1', contact_id: 'contact-1', occurred_at: '2026-10-18T12:00:00Z',
  attr_platform: 'meta', attr_ad_id: 'ad-1', attr_adset_id: null, attr_campaign_id: null, attr_ad_name: 'Travel lead', attr_creative_ref: null,
}
const input = (overrides: Partial<ResolveCompanyConfirmedBookingsInput> = {}): ResolveCompanyConfirmedBookingsInput => ({
  clientId: CLIENT,
  windowStart: START,
  windowEnd: END,
  bookings: [booking],
  events: [event],
  contacts: [contact],
  touchpoints: [touchpoint],
  accountIds: ['act-1'],
  sharedAccountIds: new Set(),
  adFacts: [{ client_id: CLIENT, ad_account_id: 'act-1', entity_id: 'ad-1', creative_page_id: 'page-1' }],
  clientPageId: 'page-1',
  ...overrides,
})

type QueryFilter = { kind: 'eq' | 'in' | 'gte' | 'lte'; column: string; value: unknown }
function fakeDb(tables: Record<string, unknown[]>, failures: Set<string> = new Set()): SupabaseClient {
  return {
    from(table: string) {
      const filters: QueryFilter[] = []
      let range: [number, number] | null = null
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push({ kind: 'eq', column, value }); return query },
        in: (column: string, value: unknown[]) => { filters.push({ kind: 'in', column, value }); return query },
        gte: (column: string, value: unknown) => { filters.push({ kind: 'gte', column, value }); return query },
        lte: (column: string, value: unknown) => { filters.push({ kind: 'lte', column, value }); return query },
        order: () => query,
        range: (from: number, to: number) => { range = [from, to]; return query },
        maybeSingle: async () => {
          if (failures.has(table)) return { data: null, error: { message: 'offline read failed' } }
          const rows = filteredRows()
          return { data: rows[0] ?? null, error: null }
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(
          failures.has(table)
            ? { data: null, error: { message: 'offline read failed' } }
            : { data: filteredRows(), error: null },
        ).then(resolve),
      }
      function filteredRows(): unknown[] {
        let rows = [...(tables[table] ?? [])] as Array<Record<string, unknown>>
        for (const filter of filters) {
          if (filter.kind === 'eq') rows = rows.filter(row => row[filter.column] === filter.value)
          if (filter.kind === 'in') rows = rows.filter(row => (filter.value as unknown[]).includes(row[filter.column]))
          if (filter.kind === 'gte') rows = rows.filter(row => String(row[filter.column]) >= String(filter.value))
          if (filter.kind === 'lte') rows = rows.filter(row => String(row[filter.column]) <= String(filter.value))
        }
        return range ? rows.slice(range[0], range[1] + 1) : rows
      }
      return query
    },
  } as unknown as SupabaseClient
}

function loaderTables() {
  return {
    crm_bookings: [booking],
    crm_booking_events: [event],
    contacts: [contact],
    contact_touchpoints: [touchpoint],
    client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: 'act-1' }],
    clients: [{ id: CLIENT, facebook_page_id: 'page-1' }],
    ad_entity_snapshots: [{ client_id: CLIENT, ad_account_id: 'act-1', level: 'ad', entity_id: 'ad-1', creative_page_id: 'page-1' }],
  }
}

beforeEach(() => {
  mocks.sharedAccounts.clear()
  mocks.creativeLinks = null
})

describe('CRM company-confirmed bookings → Ads Health result', () => {
  it('counts a traceable first-touch booking once, even if the booking row repeats', () => {
    const result = resolveCompanyConfirmedBookings(input({ bookings: [booking, booking] }))
    expect(result).toMatchObject({ value: 1, attribution: 'crm_first_touch', source_ad_count: 1 })
  })

  it('excludes cancelled and customer-stated bookings from the company-confirmed count', () => {
    expect(resolveCompanyConfirmedBookings(input({ bookings: [{ ...booking, status: 'cancelled' }] })).value).toBe(0)
    expect(resolveCompanyConfirmedBookings(input({
      bookings: [{ ...booking, origin_kind: 'customer_stated' }], events: [], contacts: [],
    })).value).toBe(0)
  })

  it('returns unknown when the company-confirmed record has no auditable evidence reference', () => {
    expect(resolveCompanyConfirmedBookings(input({ bookings: [{ ...booking, evidence_ref: null }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ events: [] })).value).toBeNull()
  })

  it('returns unknown when first-touch ad source is missing, late, same-day ambiguous, or has an invalid timestamp', () => {
    expect(resolveCompanyConfirmedBookings(input({ contacts: [{ ...contact, attr_ad_id: null }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ contacts: [{ ...contact, first_attributed_at: '2026-10-21T00:00:00Z' }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ contacts: [{ ...contact, first_attributed_at: '2026-10-20T00:00:00Z' }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ touchpoints: [] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ touchpoints: [{ ...touchpoint, attr_ad_id: 'other-ad' }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ touchpoints: [touchpoint, { ...touchpoint, id: 'bad-time', occurred_at: 'not-a-date' }] })).value).toBeNull()
  })

  it('rejects impossible calendar dates instead of allowing Date.parse normalization', () => {
    expect(resolveCompanyConfirmedBookings(input({ windowStart: '2026-02-31' })).value).toBeNull()
  })

  it('keeps a UTC-prior touch unknown when it falls on the Auckland booking date', () => {
    const sameAucklandDay = '2026-10-19T23:00:00Z'
    const result = resolveCompanyConfirmedBookings(input({
      contacts: [{ ...contact, first_attributed_at: sameAucklandDay }],
      touchpoints: [{ ...touchpoint, occurred_at: sameAucklandDay }],
    }))
    expect(result.value).toBeNull()
  })

  it('excludes a non-Meta booking only when its summary matches the earliest raw touch', () => {
    const googleContact = { ...contact, attr_platform: 'google', attr_ad_id: 'google-ad-1' }
    const googleTouchpoint = { ...touchpoint, attr_platform: 'google', attr_ad_id: 'google-ad-1' }
    const reliable = resolveCompanyConfirmedBookings(input({
      contacts: [googleContact], touchpoints: [googleTouchpoint], accountIds: [], adFacts: [], clientPageId: null,
    }))
    expect(reliable).toMatchObject({ value: 0, attribution: 'crm_first_touch', source_ad_count: 0 })

    const conflict = resolveCompanyConfirmedBookings(input({
      contacts: [googleContact], touchpoints: [touchpoint], accountIds: [], adFacts: [], clientPageId: null,
    }))
    expect(conflict.value).toBeNull()
  })

  it('returns unknown for shared, ambiguous, cross-tenant or wrong-page ad facts', () => {
    expect(resolveCompanyConfirmedBookings(input({ sharedAccountIds: new Set(['act-1']) })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({
      accountIds: ['act-1', 'act-2'],
      adFacts: [
        { client_id: CLIENT, ad_account_id: 'act-1', entity_id: 'ad-1', creative_page_id: 'page-1' },
        { client_id: CLIENT, ad_account_id: 'act-2', entity_id: 'ad-1', creative_page_id: 'page-1' },
      ],
    })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ bookings: [{ ...booking, client_id: OTHER }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ adFacts: [{ client_id: OTHER, ad_account_id: 'act-1', entity_id: 'ad-1', creative_page_id: 'page-1' }] })).value).toBeNull()
    expect(resolveCompanyConfirmedBookings(input({ adFacts: [{ client_id: CLIENT, ad_account_id: 'act-1', entity_id: 'ad-1', creative_page_id: 'other-page' }] })).value).toBeNull()
  })

  it('does not present partial coverage as a complete count', () => {
    const result = resolveCompanyConfirmedBookings(input({
      bookings: [booking, { ...booking, id: 'booking-2', contact_id: 'contact-missing', evidence_ref: 'INV456' }],
    }))
    expect(result.value).toBeNull()
  })

  it('loads from the existing CRM/audit/account/snapshot facts through the Ads Health adapter', async () => {
    const result = await loadCompanyConfirmedBookingOutcome(CLIENT, START, END, fakeDb(loaderTables()))
    expect(result).toMatchObject({ value: 1, attribution: 'crm_first_touch', window_start: START, window_end: END })
  })

  it('exposes per-creative human context only through complete audit, first-touch, account, and exact-link proof', async () => {
    const secondBooking = { ...booking, id: 'booking-2', contact_id: 'contact-2' }
    const secondEvent = { ...event, booking_id: 'booking-2' }
    const secondContact = { ...contact, id: 'contact-2', attr_ad_id: 'ad-2' }
    const secondTouchpoint = { ...touchpoint, id: 'touch-2', contact_id: 'contact-2', attr_ad_id: 'ad-2' }
    const tables = loaderTables() as Record<string, unknown[]>
    tables.crm_bookings.push(secondBooking)
    tables.crm_booking_events.push(secondEvent)
    tables.contacts.push(secondContact)
    tables.contact_touchpoints.push(secondTouchpoint)
    tables.ad_entity_snapshots.push({ client_id: CLIENT, ad_account_id: 'act-1', level: 'ad', entity_id: 'ad-2', creative_page_id: 'page-1' })
    mocks.creativeLinks = [
      { clientId: CLIENT, platform: 'meta', adId: 'ad-1', creativeRef: 'wo-1', creativeSource: 'content_work_order' },
      { clientId: CLIENT, platform: 'meta', adId: 'ad-2', creativeRef: 'wo-2', creativeSource: 'content_work_order' },
    ]

    const reference = await loadCompanyConfirmedBookingCreativeReference({
      clientId: CLIENT,
      adAccountId: 'act-1',
      windowStart: START,
      windowEnd: END,
      approvedCreatives: [{ ref: 'wo-1', kind: 'work_order' }, { ref: 'wo-2', kind: 'work_order' }],
      db: fakeDb(tables),
    })

    expect(reference).toMatchObject({ status: 'complete', bookings_by_creative_ref: { 'wo-1': 1, 'wo-2': 1 }, window_start: START, window_end: END })
    expect(reference.note).toContain('未校正花费、平台结果或频次')
    expect(JSON.stringify(reference)).not.toContain('booking-1')
    expect(JSON.stringify(reference)).not.toContain('contact-1')
  })

  it('keeps unresolved, non-work-order, or unapproved links partial and never fabricates a zero', async () => {
    mocks.creativeLinks = [
      { clientId: CLIENT, platform: 'meta', adId: 'ad-1', creativeRef: 'wo-1', creativeSource: 'content_work_order' },
    ]
    const reference = await loadCompanyConfirmedBookingCreativeReference({
      clientId: CLIENT,
      adAccountId: 'act-1',
      windowStart: START,
      windowEnd: END,
      approvedCreatives: [{ ref: 'wo-1', kind: 'work_order' }, { ref: 'video-1', kind: 'meta_video' }],
      db: fakeDb(loaderTables()),
    })
    expect(reference.status).toBe('partial')
    expect(reference.bookings_by_creative_ref).toEqual({ 'wo-1': 1 })
    expect(reference.note).toContain('不据此判断素材效果')
  })

  it('duplicate ad-to-creative rows and a different selected account never become a creative result', async () => {
    mocks.creativeLinks = [
      { clientId: CLIENT, platform: 'meta', adId: 'ad-1', creativeRef: 'wo-1', creativeSource: 'content_work_order' },
      { clientId: CLIENT, platform: 'meta', adId: 'ad-1', creativeRef: 'wo-2', creativeSource: 'content_work_order' },
    ]
    const conflict = await loadCompanyConfirmedBookingCreativeReference({
      clientId: CLIENT,
      adAccountId: 'act-1',
      windowStart: START,
      windowEnd: END,
      approvedCreatives: [{ ref: 'wo-1', kind: 'work_order' }, { ref: 'wo-2', kind: 'work_order' }],
      db: fakeDb(loaderTables()),
    })
    expect(conflict.status).toBe('unknown')
    expect(conflict.bookings_by_creative_ref).toEqual({})

    const otherAccount = await loadCompanyConfirmedBookingCreativeReference({
      clientId: CLIENT,
      adAccountId: 'act-other',
      windowStart: START,
      windowEnd: END,
      approvedCreatives: [{ ref: 'wo-1', kind: 'work_order' }],
      db: fakeDb(loaderTables()),
    })
    expect(otherAccount.status).toBe('unknown')
    expect(otherAccount.bookings_by_creative_ref).toEqual({})
  })

  it('loads the raw first touch before excluding a reliable non-Meta booking', async () => {
    const tables = loaderTables() as Record<string, unknown[]>
    tables.contacts = [{ ...contact, attr_platform: 'google', attr_ad_id: 'google-ad-1' }]
    tables.contact_touchpoints = [{ ...touchpoint, attr_platform: 'google', attr_ad_id: 'google-ad-1' }]
    const result = await loadCompanyConfirmedBookingOutcome(CLIENT, START, END, fakeDb(tables))
    expect(result).toMatchObject({ value: 0, attribution: 'crm_first_touch', source_ad_count: 0 })

    const conflictTables = loaderTables()
    conflictTables.contacts = [{ ...contact, attr_platform: 'google', attr_ad_id: 'google-ad-1' }]
    conflictTables.contact_touchpoints = [touchpoint]
    const conflict = await loadCompanyConfirmedBookingOutcome(CLIENT, START, END, fakeDb(conflictTables))
    expect(conflict.value).toBeNull()
  })

  it.each(['crm_booking_events', 'contact_touchpoints', 'ad_entity_snapshots'])('keeps %s query failures unknown rather than showing zero', async table => {
    const result = await loadCompanyConfirmedBookingOutcome(CLIENT, START, END, fakeDb(loaderTables(), new Set([table])))
    expect(result.value).toBeNull()
    expect(result.note).toBe('读取 CRM 或广告事实失败')
  })
})
