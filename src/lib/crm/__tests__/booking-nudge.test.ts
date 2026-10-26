/**
 * Tests for the staff "payments to chase" list builder.
 *
 * Everything runs through the shared fake Supabase client so the tests
 * assert on the access pattern (client scoping, limits) as well as on the
 * assembled list.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildNudgeList,
  bucketFor,
  decideNudgeItem,
  normaliseNudgeLimit,
  pickTightestItem,
} from '../booking-nudge'
import type { BookingView, MilestoneView } from '../booking-types'
import { createFakeDb } from './booking-fake-db'
import type { FakeState, Row } from './booking-fake-db'
import {
  CLIENT_A,
  CLIENT_B,
  CONTACT_A1,
  CONTACT_B1,
  DEP_A1,
  TEST_RULE,
  TOUR_A1,
  bookingPair,
  contactRow,
  departureRow,
  milestoneRow,
  tourRow,
  DEPARTURES_TABLE,
  TOURS_TABLE,
} from './booking-fixtures'

const TODAY = '2026-10-12'
const LIVE_DEPART_ON = '2027-03-12'

/** A valid uuid string for the given small integer. */
function uuid(n: number): string {
  return `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

interface SeedOptions {
  n: number
  clientId?: string
  contact?: Record<string, unknown>
  booking?: Record<string, unknown>
  deposit?: Record<string, unknown>
  balance?: Record<string, unknown>
}

/** Register one contact plus its booking/deposit/balance rows. */
function seed(state: FakeState, options: SeedOptions): void {
  const clientId = options.clientId ?? CLIENT_A
  const contactId = uuid(1000 + options.n)
  const bookingId = uuid(options.n)

  push(state, 'contacts', [
    contactRow({
      id: contactId,
      client_id: clientId,
      display_name: `Guest ${options.n}`,
      ...options.contact,
    }),
  ])

  const [booking, deposit, balance] = bookingPair(bookingId, clientId, {
    booking: {
      contact_id: contactId,
      tour_id: TOUR_A1,
      departure_id: DEP_A1,
      ...options.booking,
    },
    deposit: options.deposit,
    balance: options.balance,
  })
  push(state, 'crm_bookings', [booking])
  push(state, 'crm_booking_milestones', [deposit, balance])
}

/** Append rows to a fake table, creating it on first use. */
function push(state: FakeState, table: string, rows: Row[]): void {
  const existing = state.tables[table]
  if (existing === undefined) {
    state.tables[table] = rows
  } else {
    existing.push(...rows)
  }
}

/**
 * Seed a booking whose deposit is paid and whose balance is due on `dueOn`.
 * The override depart date matches the live departure so no stale warning.
 */
function chase(
  state: FakeState,
  n: number,
  dueOn: string,
  extra?: {
    booking?: Record<string, unknown>
    balance?: Record<string, unknown>
    contact?: Record<string, unknown>
  },
): void {
  seed(state, {
    n,
    contact: extra?.contact,
    booking: extra?.booking,
    deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
    balance: {
      due_override_on: dueOn,
      due_override_depart_on: LIVE_DEPART_ON,
      ...extra?.balance,
    },
  })
}

/** A minimal BookingView for pickTightestItem tests. */
function view(over: Partial<BookingView>): BookingView {
  return {
    id: uuid(1),
    tourId: TOUR_A1,
    tourName: 'Tour',
    departureId: DEP_A1,
    departOn: LIVE_DEPART_ON,
    departureStatus: 'open',
    bookedOn: '2026-10-01',
    partySize: null,
    isCruise: false,
    status: 'active',
    cancelNote: null,
    note: null,
    updatedAt: '2026-10-01T00:00:00.000000+00:00',
    payInFull: false,
    milestones: [],
    warnings: [],
    ...over,
  }
}

/** A minimal MilestoneView for pickTightestItem tests. */
function milestone(over: Partial<MilestoneView>): MilestoneView {
  return {
    kind: 'balance',
    label: '尾款',
    state: 'unpaid',
    paidOn: null,
    autoByEmail: false,
    dueOn: '2026-10-08',
    dueNote: null,
    dueOverrideOn: null,
    dueInDays: -4,
    overdue: true,
    remindAfter: null,
    quiet: false,
    updatedAt: '2026-10-01T00:00:00.000000+00:00',
    ...over,
  }
}

let db: SupabaseClient
let state: FakeState

beforeEach(() => {
  const fake = createFakeDb()
  db = fake.db
  state = fake.state
  push(state, TOURS_TABLE, [tourRow()])
  push(state, DEPARTURES_TABLE, [departureRow()])
})

describe('buildNudgeList ordering and buckets', () => {
  it('orders by bucket then due date and collapses deep overdue', async () => {
    chase(state, 1, '2026-10-07') // overdue by 5
    chase(state, 2, '2026-10-22') // in 10 days
    chase(state, 3, '2026-10-14') // in 2 days
    chase(state, 4, '2026-09-22') // overdue by 20 -> collapsed
    chase(state, 5, '2026-11-11') // in 30 days -> not listed

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)

    expect(list.rows.map((row) => row.dueOn)).toEqual([
      '2026-10-07',
      '2026-10-14',
      '2026-10-22',
    ])
    expect(list.rows.map((row) => row.bucket)).toEqual([
      'overdue',
      'within_3',
      'within_14',
    ])
    expect(list.collapsedOverdue).toBe(1)
    expect(list.more).toBe(false)
    expect(list.truncated).toBe(false)

    const first = list.rows[0]
    expect(first.contactName).toBe('Guest 1')
    expect(first.kind).toBe('balance')
    expect(first.label).toBe('尾款')
    expect(first.dueInDays).toBe(-5)
  })
})

describe('overdue fold boundary', () => {
  it('lists a booking overdue by exactly 14 days', async () => {
    chase(state, 1, '2026-09-28')
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.dueOn)).toEqual(['2026-09-28'])
    expect(list.rows[0].bucket).toBe('overdue')
    expect(list.collapsedOverdue).toBe(0)
  })

  it('collapses a booking overdue by 15 days', async () => {
    chase(state, 1, '2026-09-27')
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toEqual([])
    expect(list.collapsedOverdue).toBe(1)
  })
})

describe('collapsed rows (the guests behind the folded line)', () => {
  it('lists each folded guest as a row, most overdue first, with the same shape', async () => {
    chase(state, 1, '2026-09-10')
    chase(state, 2, '2026-09-01')
    chase(state, 3, '2026-09-20')
    chase(state, 4, '2026-10-07')
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.collapsedOverdue).toBe(3)
    expect(list.collapsedRows.map((row) => row.dueOn)).toEqual(['2026-09-01', '2026-09-10', '2026-09-20'])
    const first = list.collapsedRows[0]
    expect(first.contactName).toBe('Guest 2')
    expect(first.bucket).toBe('overdue')
    expect(first.milestoneUpdatedAt).toBeTruthy()
    expect(first.tourName).toBeTruthy()
    expect(list.rows.map((row) => row.dueOn)).toEqual(['2026-10-07'])
  })

  it('caps the folded rows at 50 but still counts every folded booking', async () => {
    for (let n = 1; n <= 55; n += 1) chase(state, n, '2026-09-01')
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.collapsedOverdue).toBe(55)
    expect(list.collapsedRows).toHaveLength(50)
  })

  it('has no folded rows when nothing is folded', async () => {
    chase(state, 1, '2026-10-07')
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.collapsedRows).toEqual([])
  })
})

describe('bucketFor', () => {
  it('maps due-in-days onto buckets', () => {
    expect(bucketFor(-15)).toBe('collapsed')
    expect(bucketFor(-14)).toBe('overdue')
    expect(bucketFor(-1)).toBe('overdue')
    expect(bucketFor(0)).toBe('within_3')
    expect(bucketFor(3)).toBe('within_3')
    expect(bucketFor(4)).toBe('within_14')
    expect(bucketFor(14)).toBe('within_14')
    expect(bucketFor(15)).toBe('later')
  })
})

describe('one row per booking, tightest item', () => {
  it('picks the earliest due milestone', async () => {
    seed(state, {
      n: 1,
      deposit: {
        due_override_on: '2026-10-20',
        due_override_depart_on: LIVE_DEPART_ON,
      },
      balance: {
        due_override_on: '2026-10-08',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0].kind).toBe('balance')
    expect(list.rows[0].dueOn).toBe('2026-10-08')
  })

  it('prefers the deposit when both are due the same day', async () => {
    seed(state, {
      n: 1,
      deposit: {
        due_override_on: '2026-10-08',
        due_override_depart_on: LIVE_DEPART_ON,
      },
      balance: {
        due_override_on: '2026-10-08',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0].kind).toBe('deposit')
  })
})

describe('exclusions', () => {
  it('skips a quiet milestone', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { balance: { quiet: true } })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('skips a milestone snoozed until tomorrow', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { balance: { remind_after: '2026-10-13' } })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('lists a milestone snoozed until today', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { balance: { remind_after: '2026-10-12' } })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1), uuid(2)])
  })

  it('lists a milestone whose snooze has passed', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { balance: { remind_after: '2026-10-01' } })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1), uuid(2)])
  })

  it('skips a cancelled booking', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', {
      booking: { status: 'cancelled', cancel_note: 'changed plans' },
    })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('skips a paid balance', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', {
      balance: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
    })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('skips a do-not-contact contact', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { contact: { do_not_contact: true } })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('skips a booking whose contact row is missing', async () => {
    chase(state, 1, '2026-10-07')
    seed(state, { n: 2, balance: { due_override_on: '2026-10-07' } })
    // Remove the contact row for booking 2.
    state.tables.contacts = (state.tables.contacts ?? []).filter(
      (row) => row.id !== uuid(1002),
    )
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('keeps a booking with no departure date as an undated row', async () => {
    chase(state, 1, '2026-10-07')
    seed(state, {
      n: 2,
      booking: { departure_id: null, departure_depart_on: null },
      deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
    })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1), uuid(2)])

    const undated = list.rows[1]
    expect(undated.bucket).toBe('undated')
    expect(undated.dueOn).toBeNull()
    expect(undated.dueInDays).toBeNull()
    expect(undated.kind).toBe('balance')
    expect(undated.note).toBe('出发日期未定')
  })
})

describe('other-client exclusion', () => {
  it('does not list another client booking', async () => {
    chase(state, 1, '2026-10-07')
    seed(state, {
      n: 2,
      clientId: CLIENT_B,
      contact: { id: CONTACT_B1, client_id: CLIENT_B },
      booking: { contact_id: CONTACT_B1 },
      deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
      balance: {
        due_override_on: '2026-10-07',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('does not list a foreign booking pointing at a local contact', async () => {
    chase(state, 1, '2026-10-07')
    seed(state, {
      n: 2,
      clientId: CLIENT_B,
      contact: { id: CONTACT_A1, client_id: CLIENT_A },
      booking: { contact_id: CONTACT_A1 },
      deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
      balance: {
        due_override_on: '2026-10-07',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('scopes every recorded query to the client', async () => {
    chase(state, 1, '2026-10-07')
    push(state, 'contact_touchpoints', [
      {
        client_id: CLIENT_A,
        contact_id: uuid(1001),
        occurred_at: '2026-09-01T00:00:00Z',
        metadata: { outcome: 'no_answer' },
      },
    ])
    await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)

    const tables = new Set(state.queries.map((query) => query.table))
    expect(tables.has('crm_bookings')).toBe(true)
    expect(tables.has('crm_booking_milestones')).toBe(true)
    expect(tables.has('contacts')).toBe(true)
    expect(tables.has(TOURS_TABLE)).toBe(true)
    expect(tables.has(DEPARTURES_TABLE)).toBe(true)
    expect(tables.has('contact_touchpoints')).toBe(true)

    for (const query of state.queries) {
      expect(query.eqs).toContainEqual(['client_id', CLIENT_A])
    }
  })
})

describe('page size', () => {
  it('truncates to the limit and reports more', async () => {
    for (let n = 1; n <= 12; n += 1) {
      const day = String(n).padStart(2, '0')
      chase(state, n, `2026-10-${day}`)
    }

    const page = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(page.rows).toHaveLength(10)
    expect(page.more).toBe(true)

    const all = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 20)
    expect(all.rows).toHaveLength(12)
    expect(all.more).toBe(false)
  })

  it('normalises the limit', () => {
    expect(normaliseNudgeLimit(null)).toBe(10)
    expect(normaliseNudgeLimit(0)).toBe(10)
    expect(normaliseNudgeLimit(-3)).toBe(10)
    expect(normaliseNudgeLimit(2.5)).toBe(10)
    expect(normaliseNudgeLimit(7)).toBe(7)
    expect(normaliseNudgeLimit(500)).toBe(100)
  })
})

describe('hard cap', () => {
  it('flags truncation and caps the candidate query', async () => {
    for (let n = 1; n <= 505; n += 1) {
      const bookedOn =
        n === 1 ? '2026-01-01' : n === 505 ? '2026-09-30' : '2026-06-01'
      seed(state, {
        n,
        booking: { booked_on: bookedOn },
        deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
        balance: {
          due_override_on: '2026-10-07',
          due_override_depart_on: LIVE_DEPART_ON,
        },
      })
    }

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 100)
    expect(list.truncated).toBe(true)

    const ids = list.rows.map((row) => row.bookingId)
    expect(ids).toContain(uuid(1))
    expect(ids).not.toContain(uuid(505))

    const bookingQueries = state.queries.filter(
      (query) => query.table === 'crm_bookings',
    )
    expect(bookingQueries.length).toBeGreaterThan(0)
    for (const query of bookingQueries) {
      expect(query.eqs).toContainEqual(['client_id', CLIENT_A])
      expect(query.eqs).toContainEqual(['status', 'active'])
    }
  })

  it('does not flag truncation for a small client', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-08')
    chase(state, 3, '2026-10-09')
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.truncated).toBe(false)
  })
})

describe('snooze and nudge', () => {
  it('hides a nudged booking until the snooze date', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { balance: { remind_after: '2026-10-13' } })

    const today = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(today.rows.map((row) => row.bookingId)).toEqual([uuid(1)])

    const tomorrow = await buildNudgeList(
      db,
      CLIENT_A,
      TEST_RULE,
      '2026-10-13',
      10,
    )
    expect(tomorrow.rows.map((row) => row.bookingId)).toEqual([uuid(1), uuid(2)])
  })
})

describe('empty client', () => {
  it('returns an empty list', async () => {
    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list).toEqual({
      rows: [],
      more: false,
      collapsedOverdue: 0,
      collapsedRows: [],
      truncated: false,
    })
  })
})

describe('read failure', () => {
  it('rejects when the booking read fails', async () => {
    chase(state, 1, '2026-10-07')
    state.failTables.add('crm_bookings')
    await expect(
      buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10),
    ).rejects.toThrow()
  })
})

describe('candidate cap and long-paid bookings', () => {
  it('does not let fully paid bookings consume the candidate cap', async () => {
    for (let n = 1; n <= 501; n += 1) {
      seed(state, {
        n,
        booking: { booked_on: '2026-01-01' },
        deposit: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
        balance: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
      })
    }
    seed(state, {
      n: 900,
      booking: { booked_on: '2026-01-01' },
      deposit: {
        due_override_on: '2026-10-07',
        due_override_depart_on: LIVE_DEPART_ON,
      },
      balance: { state: 'paid', paid_on: '2026-10-01', paid_source: 'staff' },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 100)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(900)])
    expect(list.truncated).toBe(false)

    const milestoneQuery = state.queries.find(
      (query) => query.table === 'crm_booking_milestones',
    )
    expect(milestoneQuery?.eqs).toContainEqual(['state', 'unpaid'])
    expect(milestoneQuery?.eqs).toContainEqual(['quiet', false])
    expect(milestoneQuery?.eqs).toContainEqual(['client_id', CLIENT_A])
  })
})

describe('folding only when nothing is listable', () => {
  it('lists the balance when the deposit is deep overdue', async () => {
    seed(state, {
      n: 1,
      deposit: {
        due_override_on: '2026-09-22',
        due_override_depart_on: LIVE_DEPART_ON,
      },
      balance: {
        due_override_on: '2026-10-14',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0].kind).toBe('balance')
    expect(list.rows[0].dueOn).toBe('2026-10-14')
    expect(list.rows[0].bucket).toBe('within_3')
    expect(list.collapsedOverdue).toBe(0)
  })

  it('folds when every dated item is deep overdue', async () => {
    seed(state, {
      n: 1,
      deposit: {
        due_override_on: '2026-09-22',
        due_override_depart_on: LIVE_DEPART_ON,
      },
      balance: {
        due_override_on: '2026-09-12',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toEqual([])
    expect(list.collapsedOverdue).toBe(1)
  })

  it('folds when the only listable item is far in the future', async () => {
    seed(state, {
      n: 1,
      deposit: {
        due_override_on: '2026-09-22',
        due_override_depart_on: LIVE_DEPART_ON,
      },
      balance: {
        due_override_on: '2026-11-21',
        due_override_depart_on: LIVE_DEPART_ON,
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toEqual([])
    expect(list.collapsedOverdue).toBe(1)
  })

  it('decideNudgeItem picks the listable balance over a collapsed deposit', () => {
    const decision = decideNudgeItem(
      view({
        milestones: [
          milestone({
            kind: 'deposit',
            dueOn: '2026-09-22',
            dueInDays: -20,
          }),
          milestone({
            kind: 'balance',
            dueOn: '2026-10-14',
            dueInDays: 2,
          }),
        ],
      }),
      TODAY,
    )
    expect(decision.kind).toBe('row')
    if (decision.kind === 'row') {
      expect(decision.item.kind).toBe('balance')
      expect(decision.bucket).toBe('within_3')
    }
  })

  it('decideNudgeItem collapses when every dated item is deep overdue', () => {
    const decision = decideNudgeItem(
      view({
        milestones: [
          milestone({
            kind: 'deposit',
            dueOn: '2026-09-22',
            dueInDays: -20,
          }),
          milestone({
            kind: 'balance',
            dueOn: '2026-09-12',
            dueInDays: -30,
          }),
        ],
      }),
      TODAY,
    )
    expect(decision.kind).toBe('collapsed')
  })
})

describe('undated bookings', () => {
  it('lists the deposit when the departure is unknown', async () => {
    seed(state, {
      n: 1,
      booking: {
        departure_id: null,
        departure_depart_on: null,
        booked_on: '2026-10-05',
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0].kind).toBe('deposit')
    expect(list.rows[0].dueOn).toBe('2026-10-08')
    expect(list.rows[0].bucket).toBe('overdue')
    expect(list.rows[0].note).toBe('出发日期未定')
  })

  it('folds an undated booking whose deposit is deep overdue', async () => {
    seed(state, {
      n: 1,
      booking: {
        departure_id: null,
        departure_depart_on: null,
        booked_on: '2026-09-01',
      },
    })

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows).toEqual([])
    expect(list.collapsedOverdue).toBe(1)
  })
})

describe('do-not-contact from touch history', () => {
  /** Two chaseable bookings; the second has no contact-level DNC flag. */
  function twoChaseable(): void {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { contact: { do_not_contact: false } })
  }

  it('hides a contact flagged by a touch outcome', async () => {
    twoChaseable()
    push(state, 'contact_touchpoints', [
      {
        client_id: CLIENT_A,
        contact_id: uuid(1002),
        occurred_at: '2026-09-01T00:00:00Z',
        metadata: { outcome: 'do_not_contact' },
      },
    ])

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('lists a contact whose do-not-contact was cleared', async () => {
    chase(state, 1, '2026-10-07')
    chase(state, 2, '2026-10-07', { contact: { do_not_contact: true } })
    push(state, 'contact_touchpoints', [
      {
        client_id: CLIENT_A,
        contact_id: uuid(1002),
        occurred_at: '2026-08-01T00:00:00Z',
        metadata: { outcome: 'do_not_contact' },
      },
      {
        client_id: CLIENT_A,
        contact_id: uuid(1002),
        occurred_at: '2026-09-01T00:00:00Z',
        metadata: { outcome: 'dnc_cleared' },
      },
    ])

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1), uuid(2)])
  })

  it('ignores another client touch for the same contact id', async () => {
    twoChaseable()
    push(state, 'contact_touchpoints', [
      {
        client_id: CLIENT_B,
        contact_id: uuid(1002),
        occurred_at: '2026-09-01T00:00:00Z',
        metadata: { outcome: 'do_not_contact' },
      },
    ])

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1), uuid(2)])
  })

  it('hides a contact flagged by the metadata flag form', async () => {
    twoChaseable()
    push(state, 'contact_touchpoints', [
      {
        client_id: CLIENT_A,
        contact_id: uuid(1002),
        occurred_at: '2026-09-01T00:00:00Z',
        metadata: { do_not_contact: true },
      },
    ])

    const list = await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 10)
    expect(list.rows.map((row) => row.bookingId)).toEqual([uuid(1)])
  })

  it('batches touch reads by at most 100 contact ids', async () => {
    for (let n = 1; n <= 150; n += 1) {
      chase(state, n, '2026-10-07')
    }

    await buildNudgeList(db, CLIENT_A, TEST_RULE, TODAY, 100)

    const touchQueries = state.queries.filter(
      (query) => query.table === 'contact_touchpoints',
    )
    expect(touchQueries.length).toBeLessThanOrEqual(2)
    for (const query of touchQueries) {
      expect(query.eqs).toContainEqual(['client_id', CLIENT_A])
      const inFilter = query.ins.find(([col]) => col === 'contact_id')
      expect(inFilter).toBeDefined()
      expect((inFilter?.[1] ?? []).length).toBeLessThanOrEqual(100)
    }
  })
})

describe('pickTightestItem', () => {
  it('returns null for a cancelled booking', () => {
    const cancelled = view({
      status: 'cancelled',
      milestones: [milestone({ dueOn: '2026-10-08' })],
    })
    expect(pickTightestItem(cancelled, TODAY)).toBeNull()
  })

  it('returns null when the only unpaid milestone has no due date', () => {
    const noDue = view({
      milestones: [milestone({ dueOn: null, dueInDays: null })],
    })
    expect(pickTightestItem(noDue, TODAY)).toBeNull()
  })
})
