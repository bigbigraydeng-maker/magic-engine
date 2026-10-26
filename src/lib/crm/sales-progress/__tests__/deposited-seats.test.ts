/**
 * Acceptance: an inquiry about tour A, then a deposit for tour B with 2 people,
 * is 1 deal and 2 seats under B. The ad source stays as it was. The balance
 * payment does not add a deal. Cancelled bookings and bookings with no deposit
 * are not counted. Deposits before the cutoff are not new progress.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SalesBooking, SalesUnit } from '../types'
import {
  attachPayments,
  countDepositedSeats,
  depositCutoff,
  depositedSeatsToFetchResult,
  incrementalSeatBaseline,
  paymentsByBooking,
  type DepositSeatBooking,
  type SeatDeparture,
} from '../deposited-seats'

const PERIOD_START = '2026-10-21'
const PERIOD_END = '2027-02-28'
const CREATED_AT = '2026-10-16T01:00:00.000Z'
const AD_SOURCE = 'meta-ad-tour-a'

const SCOPE: SeatDeparture[] = [
  { departOn: '2027-03-11', tourId: 'tour-a' },
  { departOn: '2027-03-18', tourId: 'tour-b' },
]

function unit(overrides: Partial<SalesUnit> = {}): SalesUnit {
  return {
    unitId: 'dep-b',
    groupId: 'tour-b',
    label: '2027-03-18',
    date: '2027-03-18',
    capacity: 18,
    capacityNote: null,
    unitStatus: 'open',
    ...overrides,
  }
}

function booking(overrides: Partial<SalesBooking> = {}): SalesBooking {
  return {
    id: 'b-new',
    tourId: 'tour-b',
    departureId: 'dep-b',
    departureDepartOn: '2027-03-18',
    bookedOn: '2026-11-01',
    partySize: 2,
    originKind: 'staff_entered',
    evidenceRef: null,
    status: 'active',
    ...overrides,
  }
}

function paidRow(overrides: Partial<DepositSeatBooking> = {}): DepositSeatBooking {
  return {
    booking: booking(),
    deposit: { state: 'paid', paidOn: '2026-11-02' },
    balancePaid: false,
    adSource: AD_SOURCE,
    ...overrides,
  }
}

const UNITS = [
  unit({ unitId: 'dep-a', groupId: 'tour-a', label: '2027-03-11', date: '2027-03-11' }),
  unit(),
]

function count(rows: DepositSeatBooking[], scope: SeatDeparture[] = SCOPE) {
  return countDepositedSeats({
    units: UNITS,
    rows,
    scope,
    cutoff: depositCutoff(PERIOD_START, CREATED_AT),
    periodEnd: PERIOD_END,
  })
}

describe('deposited seats for a scoped goal', () => {
  it('counts 1 deal and 2 seats under the bought tour, and keeps the ad source', () => {
    const inquiry = { tourId: 'tour-a', adSource: AD_SOURCE }
    const payments = paymentsByBooking([
      { bookingId: 'b-new', kind: 'deposit', state: 'paid', paidOn: '2026-11-02' },
      { bookingId: 'b-new', kind: 'balance', state: 'paid', paidOn: '2026-12-01' },
      { bookingId: 'b-old', kind: 'deposit', state: 'paid', paidOn: '2026-10-10' },
      { bookingId: 'b-cancel', kind: 'deposit', state: 'paid', paidOn: '2026-11-05' },
      { bookingId: 'b-balance', kind: 'balance', state: 'paid', paidOn: '2026-11-06' },
      { bookingId: 'b-other', kind: 'deposit', state: 'paid', paidOn: '2026-11-03' },
    ])
    expect(payments.size).toBe(5)
    expect(payments.get('b-new')).toEqual({
      deposit: { state: 'paid', paidOn: '2026-11-02' },
      balancePaid: true,
    })
    expect(payments.get('b-balance')?.deposit.state).toBe('unpaid')

    const bookings = [
      booking(),
      booking({ id: 'b-old', tourId: 'tour-a', departureId: 'dep-a', departureDepartOn: '2027-03-11', partySize: 9 }),
      booking({ id: 'b-cancel', partySize: 4, status: 'cancelled' }),
      booking({ id: 'b-balance', partySize: 3 }),
      booking({
        id: 'b-other',
        tourId: 'tour-c',
        departureId: 'dep-c',
        departureDepartOn: '2027-04-01',
        partySize: 8,
      }),
    ]
    const rows = attachPayments(bookings, payments, (id) => (id === 'b-new' ? inquiry.adSource : null))
    const result = count(rows)
    const progress = depositedSeatsToFetchResult(result, PERIOD_END)

    expect(result.deals).toBe(1)
    expect(result.seats).toBe(2)
    expect(result.byDeparture).toEqual([
      { departOn: '2027-03-18', tourId: 'tour-b', deals: 1, seats: 2 },
    ])
    expect(result.byDeparture.map((row) => row.tourId)).not.toContain(inquiry.tourId)
    expect(result.sources).toEqual([{ bookingId: 'b-new', adSource: inquiry.adSource }])
    expect(rows[0].adSource).toBe(AD_SOURCE)
    expect(progress).toMatchObject({ ok: true, value: 2, source: 'auto.crm_deposited_seats' })
  })

  it('does not count a deposit marked before the cutoff', () => {
    const early = count([paidRow({ deposit: { state: 'paid', paidOn: '2026-10-20' } })])
    const onCutoff = count([paidRow({ deposit: { state: 'paid', paidOn: PERIOD_START } })])
    expect(depositedSeatsToFetchResult(early, PERIOD_END)).toMatchObject({ ok: false, unknown: true, noData: true })
    expect(onCutoff.seats).toBe(2)
  })

  it('excludes a cancelled booking and a booking with no deposit', () => {
    const cancelled = count([paidRow({ booking: booking({ status: 'cancelled' }) })])
    const unpaid = count([paidRow({
      deposit: { state: 'unpaid', paidOn: null },
      balancePaid: true,
    })])
    expect(depositedSeatsToFetchResult(cancelled, PERIOD_END)).toMatchObject({ noData: true })
    expect(depositedSeatsToFetchResult(unpaid, PERIOD_END)).toMatchObject({ noData: true })
    expect(depositedSeatsToFetchResult(unpaid, PERIOD_END)).not.toMatchObject({ ok: true, value: 0 })
  })

  it('reports a missing headcount as unknown and does not publish a number', () => {
    const result = count([paidRow({ booking: booking({ partySize: null }) })])
    const progress = depositedSeatsToFetchResult(result, PERIOD_END)
    expect(result.seats).toBeNull()
    expect(result.unknownHeadcount).toBe(1)
    expect(progress.ok).toBe(false)
    if (progress.ok) throw new Error('expected unknown')
    expect(progress.reason).toContain('人数未知 1 笔')
    expect(progress).not.toHaveProperty('value')
    expect(progress).not.toHaveProperty('noData')
  })

  it('reports an unconfirmed departure on a scoped tour as unknown', () => {
    const result = count([paidRow({
      booking: booking({ departureId: null, departureDepartOn: null }),
    })])
    const progress = depositedSeatsToFetchResult(result, PERIOD_END)
    expect(result.seats).toBeNull()
    expect(result.unknownTourDate).toBe(1)
    if (progress.ok) throw new Error('expected unknown')
    expect(progress.reason).toContain('出发日未知 1 笔')
  })

  it('reports a missing ad source and still counts the seats', () => {
    const result = count([paidRow({ adSource: null })])
    const progress = depositedSeatsToFetchResult(result, PERIOD_END)
    expect(result.seats).toBe(2)
    expect(result.unknownSource).toBe(1)
    expect(progress).toMatchObject({ ok: true, value: 2 })
    if (!progress.ok) throw new Error('expected a seat count')
    expect(progress.label).toContain('来源未知 1 笔')
  })

  it('reports a paid deposit with no date as unknown', () => {
    const result = count([paidRow({ deposit: { state: 'paid', paidOn: null } })])
    const progress = depositedSeatsToFetchResult(result, PERIOD_END)
    expect(result.unknownDepositDate).toBe(1)
    expect(result.seats).toBeNull()
    if (progress.ok) throw new Error('expected unknown')
    expect(progress.reason).toContain('定金日期未知 1 笔')
  })

  it('ignores a deposit after the goal period', () => {
    const result = count([paidRow({ deposit: { state: 'paid', paidOn: '2027-03-01' } })])
    expect(depositedSeatsToFetchResult(result, PERIOD_END)).toMatchObject({ noData: true })
  })

  it('moves the cutoff to the created day when that day is after period start', () => {
    const createdAt = '2026-10-31T14:00:00.000Z'
    expect(depositCutoff(PERIOD_START, createdAt)).toBe('2026-11-01')
    const before = countDepositedSeats({
      units: UNITS,
      rows: [paidRow({ deposit: { state: 'paid', paidOn: '2026-10-25' } })],
      scope: SCOPE,
      cutoff: depositCutoff(PERIOD_START, createdAt),
      periodEnd: PERIOD_END,
    })
    const onDay = countDepositedSeats({
      units: UNITS,
      rows: [paidRow({ deposit: { state: 'paid', paidOn: '2026-11-01' } })],
      scope: SCOPE,
      cutoff: depositCutoff(PERIOD_START, createdAt),
      periodEnd: PERIOD_END,
    })
    expect(before.seats).toBe(0)
    expect(onDay.seats).toBe(2)
  })

  it('does not count a deposit on a closed departure', () => {
    const result = countDepositedSeats({
      units: [unit({ unitStatus: 'cancelled' })],
      rows: [paidRow()],
      scope: SCOPE,
      cutoff: depositCutoff(PERIOD_START, CREATED_AT),
      periodEnd: PERIOD_END,
    })
    const progress = depositedSeatsToFetchResult(result, PERIOD_END)
    expect(result.excludedClosed).toBe(1)
    expect(result.seats).toBe(0)
    if (progress.ok) throw new Error('expected unknown')
    expect(progress.reason).toContain('关闭')
    expect(progress).not.toHaveProperty('noData')
  })

  it('publishes new seats only when the stored baseline is 0', () => {
    expect(incrementalSeatBaseline(0)).toEqual({ ok: true })
    expect(incrementalSeatBaseline('0')).toEqual({ ok: true })
    const blocked = incrementalSeatBaseline(17)
    expect(blocked.ok).toBe(false)
    if (blocked.ok) throw new Error('expected a block')
    expect(blocked.reason).toContain('17')
    expect(incrementalSeatBaseline(undefined).ok).toBe(false)
  })

  it('does not consult the notes classifier', () => {
    const seatFile = readFileSync(join(process.cwd(), 'src/lib/crm/sales-progress/deposited-seats.ts'), 'utf8')
    const fetchFile = readFileSync(join(process.cwd(), 'src/lib/strategy/deposited-seat-fetch.ts'), 'utf8')
    expect(seatFile).not.toContain('classifyNote')
    expect(fetchFile).not.toContain('classifyNote')
    expect(fetchFile).not.toContain('me_sale_outcomes')
  })
})
