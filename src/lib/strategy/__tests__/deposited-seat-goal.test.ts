/**
 * signups_count with a departure list counts deposited seats.
 * The same metric without that list still counts purchase rows.
 */

import { describe, expect, it } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

type Client = Parameters<typeof autoFetchMetricValue>[0]

const PERIOD = { period_start: '2026-10-21', period_end: '2027-02-28' }
const SCOPE = [
  { departOn: '2027-03-11', tourId: 'tour-a' },
  { departOn: '2027-03-18', tourId: 'tour-b' },
]

function bookingRow(overrides: Record<string, unknown>) {
  return {
    id: 'b-new',
    tour_id: 'tour-b',
    departure_id: 'dep-b',
    departure_depart_on: '2027-03-18',
    booked_on: '2026-11-01',
    party_size: 2,
    status: 'active',
    origin_kind: 'staff_entered',
    evidence_ref: null,
    ...overrides,
  }
}

function fakeDb(tables: Record<string, unknown[]>): Client {
  function chain(rows: unknown[]) {
    const thenable = {
      select: () => thenable,
      eq: () => thenable,
      order: () => thenable,
      range: () => thenable,
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
    }
    return thenable
  }
  return {
    from: (table: string) => {
      if (table === 'me_sale_outcomes') throw new Error('deal rows must not be read for a scoped goal')
      if (!(table in tables)) throw new Error(`unexpected table ${table}`)
      return chain(tables[table])
    },
  } as unknown as Client
}

const TABLES = {
  crm_bookings: [
    bookingRow({}),
    bookingRow({
      id: 'b-old',
      tour_id: 'tour-a',
      departure_id: 'dep-a',
      departure_depart_on: '2027-03-11',
      party_size: 9,
    }),
    bookingRow({ id: 'b-cancel', party_size: 4, status: 'cancelled' }),
    bookingRow({ id: 'b-balance', party_size: 3 }),
  ],
  crm_booking_milestones: [
    { id: 'm1', booking_id: 'b-new', kind: 'deposit', state: 'paid', paid_on: '2026-11-02' },
    { id: 'm2', booking_id: 'b-new', kind: 'balance', state: 'paid', paid_on: '2026-12-01' },
    { id: 'm3', booking_id: 'b-old', kind: 'deposit', state: 'paid', paid_on: '2026-10-10' },
    { id: 'm4', booking_id: 'b-cancel', kind: 'deposit', state: 'paid', paid_on: '2026-11-05' },
    { id: 'm5', booking_id: 'b-balance', kind: 'balance', state: 'paid', paid_on: '2026-11-06' },
  ],
  tour_catalog_tours: [
    { id: 'tour-a', name: 'Tour A', slug: 'tour-a', max_group_size: 18 },
    { id: 'tour-b', name: 'Tour B', slug: 'tour-b', max_group_size: 18 },
  ],
  tour_catalog_departures: [
    { id: 'dep-a', tour_id: 'tour-a', depart_on: '2027-03-11', status: 'open', internal: { capacity: 18 } },
    { id: 'dep-b', tour_id: 'tour-b', depart_on: '2027-03-18', status: 'open', internal: { capacity: 18 } },
  ],
}

describe('autoFetchMetricValue signups_count with a departure list', () => {
  it('updates goal progress to 2 seats under tour B, not the old booking or the balance', async () => {
    const result = await autoFetchMetricValue(fakeDb(TABLES), 'client-1', 'signups_count', {
      goalPeriod: PERIOD,
      depositedSeatScope: SCOPE,
      goalCreatedAt: '2026-10-16T01:00:00.000Z',
      baselineValue: 0,
    })

    expect(result).toMatchObject({
      ok: true,
      value: 2,
      source: 'auto.crm_deposited_seats',
      snapshot_date: PERIOD.period_end,
    })
    if (!result.ok) throw new Error('expected seats')
    expect(result.label).toContain('1 笔定金')
    expect(result.label).toContain('2 个座位')
    expect(result.label).toContain('来源未知')
  })

  it('does not publish a number when the stored baseline is not 0', async () => {
    const db = { from: () => { throw new Error('should not read') } } as unknown as Client
    const result = await autoFetchMetricValue(db, 'client-1', 'signups_count', {
      goalPeriod: PERIOD,
      depositedSeatScope: SCOPE,
      goalCreatedAt: '2026-10-16T01:00:00.000Z',
      baselineValue: 17,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a block')
    expect(result.reason).toContain('17')
    expect(result).not.toHaveProperty('value')
  })
})
