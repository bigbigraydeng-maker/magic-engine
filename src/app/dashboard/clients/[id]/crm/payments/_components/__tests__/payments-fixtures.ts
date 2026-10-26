/**
 * Shared fixtures for the 付款总览 page tests. Not a test file.
 * Counts only: no fixture carries an amount (the tracker stores none).
 */

import { vi } from 'vitest'
import type { OverviewPayload } from '@/lib/crm/booking-overview-load'
import type { OverviewGroup, OverviewListRow } from '@/lib/crm/booking-overview-types'

export const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const TOUR_A = '10000000-0000-4000-8000-0000000000a1'
export const TOUR_B = '10000000-0000-4000-8000-0000000000b2'
export const DEP_A = '20000000-0000-4000-8000-0000000000a1'
export const DEP_B = '20000000-0000-4000-8000-0000000000b2'
export const CONTACT_1 = 'c1a1a1a1-0000-4000-8000-000000000001'
export const CONTACT_2 = 'c1a1a1a1-0000-4000-8000-000000000002'

export function makeGroup(over: Partial<OverviewGroup> = {}): OverviewGroup {
  return {
    key: DEP_A,
    kind: 'departure',
    tourId: TOUR_A,
    tourName: '新西兰南北岛 12 天',
    departureId: DEP_A,
    departOn: '2027-03-19',
    departed: false,
    orders: 6,
    partySize: 0,
    partySizeMissing: 0,
    depositPaid: 5,
    balancePaid: 2,
    fullyPaid: 2,
    unsettled: 4,
    unsettledOverdue: 1,
    offlineHandled: 1,
    nearestDueOn: '2026-12-19',
    unpaidItems: 5,
    openItems: 4,
    dateAmbiguous: false,
    warningCodes: [],
    ...over,
  }
}

export function makeRow(over: Partial<OverviewListRow> = {}): OverviewListRow {
  return {
    bookingId: '30000000-0000-4000-8000-0000000000a1',
    contactId: CONTACT_1,
    contactName: 'Wang M.',
    tourId: TOUR_A,
    tourName: '新西兰南北岛 12 天',
    departureId: DEP_A,
    departOn: '2027-03-19',
    status: 'active',
    partySize: null,
    deposit: {
      kind: 'deposit', label: '定金', state: 'paid', paidOn: '2026-10-08',
      dueOn: '2026-10-10', dueNote: null, overdue: false, quiet: false,
    },
    balance: {
      kind: 'balance', label: '尾款', state: 'unpaid', paidOn: null,
      dueOn: '2026-12-19', dueNote: null, overdue: false, quiet: false,
    },
    lastNudgedOn: '2026-10-01',
    warnings: [],
    note: null,
    ...over,
  }
}

export function makePayload(over: Partial<OverviewPayload> = {}): OverviewPayload {
  const groups = [
    makeGroup(),
    makeGroup({
      key: DEP_B, departureId: DEP_B, tourId: TOUR_B, tourName: '澳洲东海岸 9 天',
      departOn: '2026-11-02', departed: true, orders: 2, depositPaid: 2, balancePaid: 1,
      unsettled: 1, unsettledOverdue: 1, offlineHandled: 0, nearestDueOn: '2026-08-05',
      warningCodes: ['departure_changed'],
    }),
    makeGroup({
      key: 'none', kind: 'undecided', tourId: null, tourName: null, departureId: null,
      departOn: null, orders: 2, depositPaid: 1, balancePaid: 0, unsettled: 1,
      unsettledOverdue: 1, offlineHandled: 1, nearestDueOn: '2026-10-02',
    }),
  ]
  return {
    summary: {
      groups,
      totals: { orders: 10, partySize: 0, partySizeMissing: 0, depositPaid: 8, balancePaid: 3, unsettled: 6, unsettledOverdue: 3, offlineHandled: 2 },
      hiddenGroupCount: 2,
      hiddenOrders: 3,
      hiddenOfflineOnlyGroups: 0,
      notes: { offlineHandledOrders: 2, snoozedOrders: 3, cancelledOrders: 4 },
    },
    hasBookings: true,
    paidWithoutBooking: { total: 0, rows: [] },
    list: {
      rows: [
        makeRow(),
        makeRow({
          bookingId: '30000000-0000-4000-8000-0000000000a2', contactId: CONTACT_2, contactName: 'Li & Li',
          deposit: { kind: 'deposit', label: '定金', state: 'unpaid', paidOn: null, dueOn: '2026-10-09', dueNote: null, overdue: true, quiet: false },
          lastNudgedOn: null, note: '没勾邮轮按90天算',
        }),
      ],
      page: 1, pageCount: 3, total: 120,
    },
    today: '2026-10-12',
    ...over,
  }
}

export function makeEmptyPayload(): OverviewPayload {
  return makePayload({
    hasBookings: false,
    summary: {
      groups: [],
      totals: { orders: 0, partySize: 0, partySizeMissing: 0, depositPaid: 0, balancePaid: 0, unsettled: 0, unsettledOverdue: 0, offlineHandled: 0 },
      hiddenGroupCount: 0,
      hiddenOrders: 0,
      hiddenOfflineOnlyGroups: 0,
      notes: { offlineHandledOrders: 0, snoozedOrders: 0, cancelledOrders: 0 },
    },
    list: { rows: [], page: 1, pageCount: 1, total: 0 },
    paidWithoutBooking: {
      total: 29,
      rows: [
        { id: CONTACT_1, name: 'Wang M.', stage: 'deposit_paid' },
        { id: CONTACT_2, name: null, stage: 'paid_full' },
        { id: 'c1a1a1a1-0000-4000-8000-000000000003', name: 'Chen', stage: 'traveling_soon' },
      ],
    },
  })
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export type OverviewHandler = (url: string) => Response | Promise<Response>

/** Stub fetch: overview calls go to `handler`; the tab probe and options calls get fixed answers. */
export function stubFetch(handler: OverviewHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/crm/bookings/overview')) return handler(url)
    if (url.includes('/crm/bookings/access')) return json(200, { ok: true })
    if (url.includes('/crm/bookings/options')) {
      return json(200, { tours: [{ id: TOUR_A, name: 'x', durationText: null, departures: [{ id: DEP_A, departOn: '2027-03-19', returnOn: null, status: 'open' }] }] })
    }
    return json(200, { client: { industry: 'travel' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function overviewCalls(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/crm/bookings/overview'))
}
