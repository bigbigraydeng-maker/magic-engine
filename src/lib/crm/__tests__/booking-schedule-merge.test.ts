import { describe, expect, it } from 'vitest'
import {
  computeMilestoneDueDates,
  parseDurationDays,
  type BookingDueInput,
  type DueDates,
  type DueDatesResult,
} from '../booking-schedule'
import type { TravelBookingRule } from '../industry/travel-booking-rule'

const RULE: TravelBookingRule = {
  depositDueWorkingDays: 3,
  balanceLeadDays: { standard: 90, longOrCruise: 120 },
  longTourMinDays: 16,
  holidayRegion: 'NZ',
  balanceRollForward: false,
}

const ROLL: TravelBookingRule = { ...RULE, balanceRollForward: true }

/** Build a booking input, overriding only the fields a test cares about. */
function input(partial: Partial<BookingDueInput>): BookingDueInput {
  return {
    bookedOn: '2026-11-02',
    departOn: '2027-09-20',
    returnOn: '2027-10-04',
    durationText: null,
    isCruise: false,
    ...partial,
  }
}

/** Unwrap an 'ok' result, failing loudly on any other state. */
function datesOf(result: DueDatesResult): DueDates {
  if (result.state !== 'ok') {
    throw new Error(`expected state 'ok' but got '${result.state}'`)
  }
  return result.dates
}

describe('merge rule uses the rolled balance, deposit date and departure cap', () => {
  it('merges when the raw balance falls before the deposit date', () => {
    // Booked Mon 2026-10-12 -> deposit Thu 2026-10-15.
    // 15-day tour (lead 90) -> raw balance Tue 2026-10-13, before the deposit.
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({
          bookedOn: '2026-10-12',
          departOn: '2027-01-11',
          returnOn: '2027-01-25',
        }),
      ),
    )
    expect(dates.mode).toBe('full_payment')
    expect(dates.depositDueOn).toBe('2026-10-15')
    expect(dates.balanceDueOn).toBe('2026-10-15')
  })

  it('clamps a merged date to the day before departure', () => {
    // Deposit would be 2026-10-15, after the 2026-10-13 departure, so the
    // merged date is clamped back to the day before departure.
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({
          bookedOn: '2026-10-12',
          departOn: '2026-10-13',
          returnOn: null,
        }),
      ),
    )
    expect(dates.mode).toBe('full_payment')
    expect(dates.depositDueOn).toBe('2026-10-12')
    expect(dates.balanceDueOn).toBe('2026-10-12')
  })

  it('never merges earlier than the booking day', () => {
    // Departure equals the booking day, so the lower clamp wins.
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({
          bookedOn: '2026-10-12',
          departOn: '2026-10-12',
          returnOn: null,
        }),
      ),
    )
    expect(dates.mode).toBe('full_payment')
    expect(dates.depositDueOn).toBe('2026-10-12')
    expect(dates.balanceDueOn).toBe('2026-10-12')
  })

  it('merges when the balance equals the deposit date', () => {
    // Booked Thu 2027-06-17 -> deposit Tue 2027-06-22.
    // 15-day tour (lead 90) -> balance Tue 2027-06-22, exactly equal.
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({
          bookedOn: '2027-06-17',
          departOn: '2027-09-20',
          returnOn: '2027-10-04',
        }),
      ),
    )
    expect(dates.mode).toBe('full_payment')
    expect(dates.depositDueOn).toBe('2027-06-22')
    expect(dates.balanceDueOn).toBe('2027-06-22')
  })

  it('stays split when the balance is one day after the deposit date', () => {
    // Booked Wed 2027-06-16 -> deposit Mon 2027-06-21.
    // Balance Tue 2027-06-22 is one day later, so the dates stay split.
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({
          bookedOn: '2027-06-16',
          departOn: '2027-09-20',
          returnOn: '2027-10-04',
        }),
      ),
    )
    expect(dates.mode).toBe('split')
    expect(dates.depositDueOn).toBe('2027-06-21')
    expect(dates.balanceDueOn).toBe('2027-06-22')
  })

  it('caps a roll-forward at the day before departure', () => {
    // Lead 1 -> raw balance Sun 2027-09-19. Rolling would reach the Monday
    // departure day, which is not allowed, so the date stays put.
    const rule: TravelBookingRule = {
      ...ROLL,
      balanceLeadDays: { standard: 1, longOrCruise: 1 },
    }
    const dates = datesOf(
      computeMilestoneDueDates(
        rule,
        input({
          bookedOn: '2027-08-02',
          departOn: '2027-09-20',
          returnOn: null,
        }),
      ),
    )
    expect(dates.mode).toBe('split')
    expect(dates.balanceDueOn).toBe('2027-09-19')
    expect(dates.rolledForward).toBe(false)
  })

  it('rolls forward normally when there is room', () => {
    // Lead 90 -> raw balance Sun 2027-06-20, rolled to Mon 2027-06-21.
    const dates = datesOf(
      computeMilestoneDueDates(
        ROLL,
        input({
          bookedOn: '2026-11-02',
          departOn: '2027-09-18',
          returnOn: null,
        }),
      ),
    )
    expect(dates.mode).toBe('split')
    expect(dates.balanceDueOn).toBe('2027-06-21')
    expect(dates.rolledForward).toBe(true)
  })

  it('checks the merge against the rolled balance', () => {
    // Booked Wed 2027-06-16 -> deposit Mon 2027-06-21.
    // With ROLL the raw balance Sun 2027-06-20 rolls to Mon 2027-06-21,
    // which equals the deposit date, so the dates merge.
    const rolled = datesOf(
      computeMilestoneDueDates(
        ROLL,
        input({
          bookedOn: '2027-06-16',
          departOn: '2027-09-18',
          returnOn: null,
        }),
      ),
    )
    expect(rolled.mode).toBe('full_payment')
    expect(rolled.depositDueOn).toBe('2027-06-21')
    expect(rolled.balanceDueOn).toBe('2027-06-21')

    // Without rolling the raw balance Sun 2027-06-20 is already on or before
    // the deposit date, so it merges to the same date.
    const raw = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({
          bookedOn: '2027-06-16',
          departOn: '2027-09-18',
          returnOn: null,
        }),
      ),
    )
    expect(raw.mode).toBe('full_payment')
    expect(raw.depositDueOn).toBe('2027-06-21')
    expect(raw.balanceDueOn).toBe('2027-06-21')
  })

  it('keeps a merged date within the booking and departure bounds', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['2026-10-12', '2026-10-13'],
      ['2026-10-12', '2026-10-14'],
      ['2026-10-16', '2026-10-19'],
      ['2027-03-01', '2027-03-03'],
    ]
    for (const [bookedOn, departOn] of pairs) {
      const dates = datesOf(
        computeMilestoneDueDates(
          RULE,
          input({ bookedOn, departOn, returnOn: null }),
        ),
      )
      expect(dates.mode).toBe('full_payment')
      expect(dates.depositDueOn >= bookedOn).toBe(true)
      expect(
        dates.depositDueOn < departOn || dates.depositDueOn === bookedOn,
      ).toBe(true)
    }
  })
})

describe('tour length parsing', () => {
  it('rejects implausible or embedded numbers', () => {
    expect(parseDurationDays('2026 days')).toBeNull()
    expect(parseDurationDays('200 days')).toBeNull()
    expect(parseDurationDays('121 days')).toBeNull()
    expect(parseDurationDays('1616 days')).toBeNull()
  })

  it('accepts plausible day counts', () => {
    expect(parseDurationDays('120 days')).toBe(120)
    expect(parseDurationDays('Tour 2026 - 16 days')).toBe(16)
    expect(parseDurationDays('1 day')).toBe(1)
    expect(parseDurationDays('16 Days 15 Nights')).toBe(16)
  })

  it('falls back to an unknown length when the text has no day count', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ returnOn: null, durationText: '2026 days' }),
      ),
    )
    expect(dates.tourDays).toBeNull()
    expect(dates.tourDaysSource).toBe('unknown')
    expect(dates.tier).toBe('standard')
  })
})
