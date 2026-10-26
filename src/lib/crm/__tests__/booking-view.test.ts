/**
 * Tests for the staff-facing booking view builder.
 *
 * The pure builder is exercised with hand-built rows and catalog facts; the
 * async helpers are exercised through the shared fake Supabase client.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BookingRow,
  BookingView,
  CatalogFacts,
  MilestoneRow,
} from '../booking-types'
import type { TravelBookingRule } from '../industry/travel-booking-rule'
import { buildBookingView, getBookingView, getContactBookingViews, nzTodayIso } from '../booking-view'
import { toBookingRow, toMilestoneRow } from '../booking-store-reads'
import { createFakeDb } from './booking-fake-db'
import type { Row } from './booking-fake-db'
import {
  BOOKING_A1,
  BOOKING_A2,
  BOOKING_B1,
  CLIENT_A,
  CLIENT_B,
  CONTACT_A1,
  CONTACT_A2,
  CONTACT_B1,
  DEP_A1,
  DEP_B1,
  TEST_RULE,
  TOUR_A1,
  TOUR_B1,
  UPDATED_AT,
  bookingRow,
  contactRow,
  departureRow,
  milestoneRow,
  tourRow,
  DEPARTURES_TABLE,
  TOURS_TABLE,
} from './booking-fixtures'

const TODAY = '2026-10-12'

/** Every warning text produced by the scenarios, for the wording sweep. */
const allWarningTexts: string[] = []

/** Narrow a possibly-null mapped row, failing loudly on bad fixtures. */
function must<T>(value: T | null): T {
  if (value === null) throw new Error('fixture row did not map')
  return value
}

function bookingOf(over?: Record<string, unknown>): BookingRow {
  return must(toBookingRow(bookingRow(over)))
}

function milestoneOf(over?: Record<string, unknown>): MilestoneRow {
  return must(toMilestoneRow(milestoneRow(over)))
}

/** Catalog facts with an optional tour and departure override. */
function factsWith(over?: {
  tour?: Record<string, unknown> | null
  departure?: Record<string, unknown> | null
}): CatalogFacts {
  const tours = new Map()
  const departures = new Map()
  if (over?.tour !== null) {
    tours.set(TOUR_A1, {
      id: TOUR_A1,
      name: 'New Zealand South and North Island',
      durationText: '15 Days 14 Nights',
      ...over?.tour,
    })
  }
  if (over?.departure !== null) {
    departures.set(DEP_A1, {
      id: DEP_A1,
      tourId: TOUR_A1,
      departOn: '2027-03-12',
      returnOn: '2027-03-26',
      status: 'open',
      ...over?.departure,
    })
  }
  return { tours, departures }
}

/** Options for the standard active booking used by most tests. */
interface ViewOver {
  booking?: Record<string, unknown>
  deposit?: Record<string, unknown>
  balance?: Record<string, unknown>
  tour?: Record<string, unknown> | null
  departure?: Record<string, unknown> | null
  rule?: TravelBookingRule
}

/** Build the standard active booking view and record its warning texts. */
function viewOf(over?: ViewOver): BookingView {
  const booking = bookingOf(over?.booking)
  const deposit = milestoneOf({
    id: '40000000-0000-4000-8000-0000000000d1',
    kind: 'deposit',
    ...over?.deposit,
  })
  const balance = milestoneOf({
    id: '40000000-0000-4000-8000-0000000000b1',
    kind: 'balance',
    ...over?.balance,
  })
  const view = buildBookingView({
    item: { booking, milestones: [deposit, balance] },
    facts: factsWith({ tour: over?.tour, departure: over?.departure }),
    rule: over?.rule ?? TEST_RULE,
    today: TODAY,
  })
  for (const warning of view.warnings) allWarningTexts.push(warning.text)
  return view
}

/** The milestone view for one kind, failing when it is absent. */
function milestone(view: BookingView, kind: 'deposit' | 'balance') {
  const found = view.milestones.find((m) => m.kind === kind)
  if (found === undefined) throw new Error(`no ${kind} milestone`)
  return found
}

/** Warning codes present on a view. */
function codes(view: BookingView): string[] {
  return view.warnings.map((w) => w.code)
}

describe('buildBookingView happy path', () => {
  it('computes deposit and balance dates for a standard tour', () => {
    const view = viewOf()
    expect(view.departOn).toBe('2027-03-12')
    expect(view.tourName).toBe('New Zealand South and North Island')
    expect(view.payInFull).toBe(false)
    expect(milestone(view, 'deposit').label).toBe('定金')
    expect(milestone(view, 'balance').label).toBe('尾款')
    expect(milestone(view, 'deposit').dueOn).toBe('2026-10-15')
    expect(milestone(view, 'deposit').dueInDays).toBe(3)
    expect(milestone(view, 'balance').dueOn).toBe('2026-12-12')
    expect(milestone(view, 'balance').dueInDays).toBe(61)
    expect(codes(view)).toEqual(['cruise_not_ticked'])
    expect(view.warnings[0].text).toBe('尾款按出发前 90 天算（没勾邮轮）')
  })

  it('uses the cruise lead time when the cruise box is ticked', () => {
    const view = viewOf({ booking: { is_cruise: true } })
    expect(milestone(view, 'balance').dueOn).toBe('2026-11-12')
    expect(codes(view)).not.toContain('cruise_not_ticked')
    expect(codes(view)).toContain('lead_cruise_note')
    expect(view.warnings.find((w) => w.code === 'lead_cruise_note')?.text).toBe('尾款按出发前 120 天算（邮轮）')
  })

  it('says the long-tour reason, not the cruise box, when a 17-day tour uses the long lead', () => {
    const view = viewOf({ departure: { returnOn: '2027-03-28' }, tour: { durationText: '17 Days' } })
    expect(milestone(view, 'balance').dueOn).toBe('2026-11-12')
    const note = view.warnings.find((w) => w.code === 'cruise_not_ticked')
    expect(note?.text).toBe('尾款按出发前 120 天算（团期 16 天以上）')
  })

  it('takes the long-tour day count from the rule', () => {
    const rule: TravelBookingRule = { ...TEST_RULE, longTourMinDays: 12 }
    const view = viewOf({ rule })
    expect(view.warnings.find((w) => w.code === 'cruise_not_ticked')?.text).toBe(
      '尾款按出发前 120 天算（团期 12 天以上）',
    )
  })

  it('reads the lead time from the rule, not a literal', () => {
    const rule: TravelBookingRule = {
      ...TEST_RULE,
      balanceLeadDays: { standard: 60, longOrCruise: 100 },
    }
    const view = viewOf({ rule })
    expect(view.warnings[0].text).toBe('尾款按出发前 60 天算（没勾邮轮）')

    const source = readFileSync(
      join(process.cwd(), 'src/lib/crm/booking-view.ts'),
      'utf8',
    )
    expect(source).not.toContain('90')
    expect(source).not.toContain('120')
  })

  it('switches to the long-tour tier at 16 days', () => {
    const long = viewOf({ departure: { returnOn: '2027-03-27' } })
    expect(milestone(long, 'balance').dueOn).toBe('2026-11-12')
    const standard = viewOf({ departure: { returnOn: '2027-03-26' } })
    expect(milestone(standard, 'balance').dueOn).toBe('2026-12-12')
  })
})

describe('buildBookingView departure warnings', () => {
  it('flags a changed departure date and recomputes', () => {
    const view = viewOf({
      departure: { departOn: '2027-03-19', returnOn: '2027-04-02' },
    })
    const warning = view.warnings.find((w) => w.code === 'departure_changed')
    expect(warning?.needsConfirm).toBe(true)
    expect(warning?.text).toBe(
      '出发日变了：原 2027-03-12 现 2027-03-19，到期日已重算，请确认',
    )
    expect(view.departOn).toBe('2027-03-19')
    expect(milestone(view, 'balance').dueOn).toBe('2026-12-19')
  })

  it('stays quiet when the snapshot matches the live date', () => {
    expect(codes(viewOf())).not.toContain('departure_changed')
  })

  it('flags a departure that vanished from the catalog', () => {
    const view = viewOf({ departure: null })
    const warning = view.warnings.find((w) => w.code === 'departure_missing')
    expect(warning?.text).toBe('团目录里已找不到这个出发日期（原为 2027-03-12），请点「改团/出发日期」重新选')
    expect(view.departOn).toBe('2027-03-12')
  })

  it('flags a cancelled departure', () => {
    const view = viewOf({ departure: { status: 'cancelled' } })
    const warning = view.warnings.find((w) => w.code === 'departure_cancelled')
    expect(warning?.text).toBe('这个出发日期已取消')
  })

  it('flags a booking with no departure at all', () => {
    const view = viewOf({
      booking: { departure_id: null, departure_depart_on: null },
    })
    expect(codes(view)).toContain('departure_not_set')
    expect(codes(view)).not.toContain('due_unavailable')
    const warning = view.warnings.find((w) => w.code === 'departure_not_set')
    expect(warning?.text).toBe('出发日期还没定，补上才有到期日')

    const deposit = milestone(view, 'deposit')
    expect(deposit.dueOn).toBe('2026-10-15')
    expect(deposit.dueInDays).toBe(3)
    expect(deposit.dueNote).toBeNull()

    const balance = milestone(view, 'balance')
    expect(balance.dueOn).toBeNull()
    expect(balance.dueInDays).toBeNull()
    expect(balance.overdue).toBe(false)
    expect(balance.dueNote).toBe('出发日期未定')
  })

  it('keeps the deposit-only date and marks it overdue when past', () => {
    const view = viewOf({
      booking: {
        departure_id: null,
        departure_depart_on: null,
        booked_on: '2026-09-01',
      },
    })
    const deposit = milestone(view, 'deposit')
    expect(deposit.dueOn).toBe('2026-09-04')
    expect(deposit.overdue).toBe(true)
  })

  it('falls back to the deposit-only date when the full computation fails', () => {
    const view = viewOf({
      departure: { departOn: '2027-03-12', returnOn: '2027-03-01' },
    })
    expect(codes(view)).toContain('due_unavailable')
    const deposit = milestone(view, 'deposit')
    expect(deposit.dueOn).toBe('2026-10-15')
    const balance = milestone(view, 'balance')
    expect(balance.dueOn).toBeNull()
    expect(balance.dueNote).toBe('到期日暂时算不出来，请核对出发日期')
  })

  it('warns about a missing holiday table on the deposit-only path', () => {
    const view = viewOf({
      booking: {
        departure_id: null,
        departure_depart_on: null,
        booked_on: '2028-02-01',
      },
    })
    const warning = view.warnings.find((w) => w.code === 'holiday_table_missing')
    expect(warning).toBeDefined()
    expect(warning?.text).toContain('2028')
    expect(milestone(view, 'deposit').dueOn).not.toBeNull()
  })

  it('clears due notes and dates for a cancelled booking', () => {
    const view = viewOf({ booking: { status: 'cancelled' } })
    for (const m of view.milestones) {
      expect(m.dueOn).toBeNull()
      expect(m.dueNote).toBeNull()
    }
  })

  it('lets a manual override win when there is no departure', () => {
    const view = viewOf({
      booking: { departure_id: null, departure_depart_on: null },
      balance: {
        due_override_on: '2026-12-20',
        due_override_depart_on: null,
      },
    })
    const balance = milestone(view, 'balance')
    expect(balance.dueOn).toBe('2026-12-20')
    expect(balance.dueNote).toBeNull()
  })
})

describe('buildBookingView date warnings', () => {
  it('warns about a missing holiday table but keeps provisional dates', () => {
    const view = viewOf({
      booking: {
        booked_on: '2028-02-01',
        departure_depart_on: '2028-09-01',
      },
      departure: { departOn: '2028-09-01', returnOn: '2028-09-15' },
    })
    const warning = view.warnings.find((w) => w.code === 'holiday_table_missing')
    expect(warning).toBeDefined()
    expect(warning?.text).toContain('2028')
    expect(milestone(view, 'deposit').dueOn).not.toBeNull()
  })

  it('warns when the tour length disagrees with the dates', () => {
    const view = viewOf({ tour: { durationText: '10 Days 9 Nights' } })
    const warning = view.warnings.find((w) => w.code === 'tour_length_mismatch')
    expect(warning?.text).toBe('团天数对不上，请核对')
  })

  it('warns about a stale manual override', () => {
    const view = viewOf({
      balance: {
        due_override_on: '2026-12-20',
        due_override_depart_on: '2027-03-10',
      },
    })
    const balance = milestone(view, 'balance')
    expect(balance.dueOn).toBe('2026-12-20')
    expect(balance.dueOverrideOn).toBe('2026-12-20')
    const warning = view.warnings.find((w) => w.code === 'override_stale')
    expect(warning?.kind).toBe('balance')
    expect(warning?.text).toContain('2027-03-10')
    expect(warning?.text).toContain('2027-03-12')
  })

  it('accepts an override that matches the live departure', () => {
    const view = viewOf({
      balance: {
        due_override_on: '2026-12-20',
        due_override_depart_on: '2027-03-12',
      },
    })
    expect(codes(view)).not.toContain('override_stale')
  })

  it('warns when the tour is gone from the catalog', () => {
    const view = viewOf({ tour: null })
    expect(view.tourName).toBeNull()
    const warning = view.warnings.find((w) => w.code === 'tour_missing')
    expect(warning?.text).toBe('团目录里已找不到这个团')
  })
})

describe('buildBookingView special cases', () => {
  it('drops all dates and warnings for a cancelled booking', () => {
    const view = viewOf({
      booking: { status: 'cancelled', cancel_note: 'customer changed plans' },
    })
    expect(view.warnings).toEqual([])
    expect(view.cancelNote).toBe('customer changed plans')
    for (const m of view.milestones) expect(m.dueOn).toBeNull()
  })

  it('merges both dates when the booking is too close to departure', () => {
    const view = viewOf({ booking: { booked_on: '2027-02-20' } })
    expect(view.payInFull).toBe(true)
    const warning = view.warnings.find((w) => w.code === 'pay_in_full')
    expect(warning?.text).toBe('这单离出发太近，需一次付清')
    expect(milestone(view, 'deposit').dueOn).toBe(
      milestone(view, 'balance').dueOn,
    )
  })

  it('marks an overdue unpaid milestone', () => {
    const view = viewOf({
      deposit: {
        due_override_on: '2026-10-07',
        due_override_depart_on: '2027-03-12',
      },
    })
    const deposit = milestone(view, 'deposit')
    expect(deposit.overdue).toBe(true)
    expect(deposit.dueInDays).toBe(-5)
  })

  it('clears overdue once paid and tracks the payment source', () => {
    const paid = viewOf({
      deposit: {
        due_override_on: '2026-10-07',
        due_override_depart_on: '2027-03-12',
        state: 'paid',
        paid_on: '2026-10-08',
        paid_source: 'staff',
      },
    })
    expect(milestone(paid, 'deposit').overdue).toBe(false)
    expect(milestone(paid, 'deposit').autoByEmail).toBe(false)

    const emailed = viewOf({
      deposit: {
        state: 'paid',
        paid_on: '2026-10-08',
        paid_source: 'email',
        paid_evidence_ref: 'm1:deposit',
      },
    })
    expect(milestone(emailed, 'deposit').autoByEmail).toBe(true)
  })
})

describe('view shape and wording', () => {
  it('never leaks internal columns', () => {
    const view = viewOf()
    const forbidden = [
      'clientId',
      'createdBy',
      'departureDepartOn',
      'paidSource',
      'paidEvidenceRef',
    ]
    for (const key of forbidden) {
      expect(Object.keys(view)).not.toContain(key)
      for (const m of view.milestones) expect(Object.keys(m)).not.toContain(key)
    }
    const json = JSON.stringify(view)
    expect(json).not.toContain('client_id')
    expect(json).not.toContain('created_by')
  })

  it('uses plain staff wording in every warning', () => {
    // Re-run the scenarios so the sweep sees their texts.
    viewOf()
    viewOf({ booking: { is_cruise: true } })
    viewOf({ departure: { departOn: '2027-03-19', returnOn: '2027-04-02' } })
    viewOf({ departure: null })
    viewOf({ departure: { status: 'cancelled' } })
    viewOf({ booking: { departure_id: null, departure_depart_on: null } })
    viewOf({ tour: null })
    viewOf({ booking: { booked_on: '2027-02-20' } })
    expect(allWarningTexts.length).toBeGreaterThan(0)
    for (const text of allWarningTexts) {
      expect(text).not.toContain('节点')
      expect(text).not.toContain('里程碑')
      expect(text).not.toContain('班期')
      expect(text).not.toContain('departure id')
    }
  })
})

describe('nzTodayIso', () => {
  it('formats the Auckland calendar day', () => {
    expect(nzTodayIso(new Date('2026-10-11T12:30:00Z'))).toBe('2026-10-12')
    expect(nzTodayIso(new Date('2026-10-11T10:30:00Z'))).toBe('2026-10-11')
  })
})

describe('async view helpers', () => {
  /** Seed the fake database with two clients and three bookings. */
  function seed(): { db: SupabaseClient; state: ReturnType<typeof createFakeDb>['state'] } {
    const { db, state } = createFakeDb()
    const rows: Record<string, Row[]> = {
      crm_bookings: [
        bookingRow({ id: BOOKING_A1, contact_id: CONTACT_A1 }),
        bookingRow({
          id: BOOKING_A2,
          contact_id: CONTACT_A2,
          tour_id: TOUR_A1,
          departure_id: DEP_A1,
        }),
        bookingRow({
          id: BOOKING_B1,
          client_id: CLIENT_B,
          contact_id: CONTACT_B1,
          tour_id: TOUR_B1,
          departure_id: DEP_B1,
        }),
      ],
      crm_booking_milestones: [
        milestoneRow({
          id: '40000000-0000-4000-8000-0000000000d1',
          booking_id: BOOKING_A1,
          kind: 'deposit',
        }),
        milestoneRow({
          id: '40000000-0000-4000-8000-0000000000b1',
          booking_id: BOOKING_A1,
          kind: 'balance',
        }),
      ],
      [TOURS_TABLE]: [
        tourRow(),
        tourRow({ id: TOUR_B1, client_id: CLIENT_B, name: 'Other Tour' }),
      ],
      [DEPARTURES_TABLE]: [
        departureRow(),
        departureRow({
          id: DEP_B1,
          client_id: CLIENT_B,
          tour_id: TOUR_B1,
          depart_on: '2027-05-01',
          return_on: '2027-05-15',
        }),
      ],
      contacts: [
        contactRow(),
        contactRow({ id: CONTACT_A2, display_name: 'Wang Fang' }),
        contactRow({
          id: CONTACT_B1,
          client_id: CLIENT_B,
          display_name: 'Other Client Contact',
        }),
      ],
    }
    state.tables = rows
    return { db, state }
  }

  it('returns only the requested contact bookings', async () => {
    const { db, state } = seed()
    const views = await getContactBookingViews(
      db,
      CLIENT_A,
      CONTACT_A1,
      TEST_RULE,
      TODAY,
    )
    expect(views.map((v) => v.id)).toEqual([BOOKING_A1])
    for (const query of state.queries) {
      expect(query.eqs).toContainEqual(['client_id', CLIENT_A])
    }
  })

  it('returns nothing for a contact of another client', async () => {
    const { db } = seed()
    const views = await getContactBookingViews(
      db,
      CLIENT_A,
      CONTACT_B1,
      TEST_RULE,
      TODAY,
    )
    expect(views).toEqual([])
  })

  it('refuses to read another client booking by id', async () => {
    const { db } = seed()
    const view = await getBookingView(db, CLIENT_A, BOOKING_B1, TEST_RULE, TODAY)
    expect(view).toBeNull()
  })

  it('keeps the seeded updated_at on the view', async () => {
    const { db } = seed()
    const view = await getBookingView(db, CLIENT_A, BOOKING_A1, TEST_RULE, TODAY)
    expect(view?.updatedAt).toBe(UPDATED_AT)
  })
})
