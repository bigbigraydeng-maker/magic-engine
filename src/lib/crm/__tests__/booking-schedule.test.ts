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

/** Unwrap the 'ok' result; fail loudly for any other state. */
function datesOf(result: DueDatesResult): DueDates {
  if (result.state !== 'ok') {
    throw new Error(`expected state 'ok' but got '${result.state}'`)
  }
  return result.dates
}

describe('deposit due date', () => {
  it('counts 3 working days after a Monday booking', () => {
    const dates = datesOf(computeMilestoneDueDates(RULE, input({})))
    expect(dates.depositDueOn).toBe('2026-11-05')
  })

  it('skips the weekend for a Friday booking', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-11-06' })),
    )
    expect(dates.depositDueOn).toBe('2026-11-11')
  })

  it('is not 3 calendar days after a Friday booking', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-11-06' })),
    )
    expect(dates.depositDueOn).not.toBe('2026-11-09')
  })

  it('skips Christmas and the rolled Boxing Day', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-12-23' })),
    )
    expect(dates.depositDueOn).toBe('2026-12-30')
  })

  it('treats the observed Boxing Day as a holiday', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-12-26' })),
    )
    expect(dates.depositDueOn).toBe('2026-12-31')
  })

  it('skips the observed Anzac Day', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2027-04-22' })),
    )
    expect(dates.depositDueOn).toBe('2027-04-28')
  })

  it('crosses a month boundary', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-06-30' })),
    )
    expect(dates.depositDueOn).toBe('2026-07-03')
  })

  it('skips Matariki', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-07-08' })),
    )
    expect(dates.depositDueOn).toBe('2026-07-14')
  })
})

describe('holiday table missing', () => {
  it('reports the uncovered year and a provisional deposit', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({
        bookedOn: '2028-06-01',
        departOn: '2028-12-01',
        returnOn: '2028-12-15',
      }),
    )
    expect(result.state).toBe('holiday_table_missing')
    if (result.state !== 'holiday_table_missing') return
    expect(result.missingYears).toEqual([2028])
    expect(result.provisional.depositDueOn).toBe('2028-06-06')
  })

  it('reports a year the deposit scan runs into', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({
        bookedOn: '2027-12-30',
        departOn: '2028-06-01',
        returnOn: '2028-06-15',
      }),
    )
    expect(result.state).toBe('holiday_table_missing')
    if (result.state !== 'holiday_table_missing') return
    expect(result.missingYears).toEqual([2028])
  })

  it('never reports ok when the table is missing', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({
        bookedOn: '2027-12-30',
        departOn: '2028-06-01',
        returnOn: '2028-06-15',
      }),
    )
    expect(result.state).not.toBe('ok')
  })

  it('is ok when only the balance date falls in an uncovered year', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({
        bookedOn: '2027-12-20',
        departOn: '2028-06-01',
        returnOn: null,
      }),
    )
    expect(result.state).toBe('ok')
  })
})

describe('balance due date', () => {
  it('uses the standard lead for a 15-day tour', () => {
    const dates = datesOf(computeMilestoneDueDates(RULE, input({})))
    expect(dates.balanceDueOn).toBe('2027-06-22')
    expect(dates.tier).toBe('standard')
    expect(dates.leadDays).toBe(90)
    expect(dates.tourDays).toBe(15)
    expect(dates.tourDaysSource).toBe('return_on')
  })

  it('uses the long lead for a 16-day tour', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ returnOn: '2027-10-05' })),
    )
    expect(dates.balanceDueOn).toBe('2027-05-23')
    expect(dates.tier).toBe('long_or_cruise')
    expect(dates.leadDays).toBe(120)
    expect(dates.tourDays).toBe(16)
  })

  it('uses the long lead for a cruise regardless of length', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ returnOn: '2027-09-29', isCruise: true }),
      ),
    )
    expect(dates.balanceDueOn).toBe('2027-05-23')
    expect(dates.leadDays).toBe(120)
  })

  it('subtracts the lead in calendar days', () => {
    const dates = datesOf(computeMilestoneDueDates(RULE, input({})))
    expect(dates.balanceDueOn).toBe('2027-06-22')
  })
})

describe('tour length source', () => {
  it('reads the length from duration text when there is no return date', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ returnOn: null, durationText: '16 Days 15 Nights' }),
      ),
    )
    expect(dates.tourDays).toBe(16)
    expect(dates.tourDaysSource).toBe('duration_text')
    expect(dates.tier).toBe('long_or_cruise')
    expect(dates.balanceDueOn).toBe('2027-05-23')
  })

  it('reads a compact duration text', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ returnOn: null, durationText: '15D/14N' }),
      ),
    )
    expect(dates.tourDays).toBe(15)
    expect(dates.tier).toBe('standard')
  })

  it('treats unparseable duration text as unknown', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ returnOn: null, durationText: 'TBC' }),
      ),
    )
    expect(dates.tourDays).toBeNull()
    expect(dates.tourDaysSource).toBe('unknown')
    expect(dates.tier).toBe('standard')
    expect(dates.leadDays).toBe(90)
    expect(dates.durationMismatch).toBe(false)
  })

  it('flags a mismatch and prefers the return date', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ durationText: '16 days' })),
    )
    expect(dates.durationMismatch).toBe(true)
    expect(dates.tourDays).toBe(15)
    expect(dates.tourDaysSource).toBe('return_on')
    expect(dates.tier).toBe('standard')
  })

  it('does not flag a mismatch when the lengths agree', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ returnOn: '2027-10-05', durationText: '16 days' }),
      ),
    )
    expect(dates.durationMismatch).toBe(false)
  })
})

describe('parseDurationDays', () => {
  it('parses "16 Days 15 Nights"', () => {
    expect(parseDurationDays('16 Days 15 Nights')).toBe(16)
  })

  it('parses "15D/14N"', () => {
    expect(parseDurationDays('15D/14N')).toBe(15)
  })

  it('parses "10 day"', () => {
    expect(parseDurationDays('10 day')).toBe(10)
  })

  it('returns null for "14 nights"', () => {
    expect(parseDurationDays('14 nights')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseDurationDays('')).toBeNull()
  })

  it('returns null for null', () => {
    expect(parseDurationDays(null)).toBeNull()
  })

  it('returns null for "0 days"', () => {
    expect(parseDurationDays('0 days')).toBeNull()
  })

  it('parses "3天"', () => {
    expect(parseDurationDays('3天')).toBe(3)
  })
})

describe('too close to departure', () => {
  it('merges the balance into the deposit', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2027-08-01' })),
    )
    expect(dates.mode).toBe('full_payment')
    expect(dates.depositDueOn).toBe('2027-08-04')
    expect(dates.balanceDueOn).toBe(dates.depositDueOn)
  })

  it('never puts the balance before the deposit', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2027-08-01' })),
    )
    expect(dates.balanceDueOn >= dates.depositDueOn).toBe(true)
  })

  it('merges when the balance equals the booking day', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2027-06-22' })),
    )
    expect(dates.mode).toBe('full_payment')
  })

  it('stays split when the balance is after the deposit date', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2027-06-14' })),
    )
    expect(dates.mode).toBe('split')
    expect(dates.balanceDueOn).toBe('2027-06-22')
  })
})

describe('no departure and invalid input', () => {
  it('reports no departure when departOn is null', () => {
    const result = computeMilestoneDueDates(RULE, input({ departOn: null }))
    expect(result.state).toBe('no_departure')
  })

  it('reports an invalid departOn', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({ departOn: 'not-a-date' }),
    )
    expect(result.state).toBe('invalid_input')
    if (result.state !== 'invalid_input') return
    expect(result.field).toBe('departOn')
  })

  it('reports an invalid bookedOn', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({ bookedOn: '2026-13-01' }),
    )
    expect(result.state).toBe('invalid_input')
    if (result.state !== 'invalid_input') return
    expect(result.field).toBe('bookedOn')
  })

  it('reports a return date before the departure date', () => {
    const result = computeMilestoneDueDates(
      RULE,
      input({ departOn: '2027-09-20', returnOn: '2027-09-19' }),
    )
    expect(result.state).toBe('invalid_input')
    if (result.state !== 'invalid_input') return
    expect(result.field).toBe('returnOn')
  })
})

describe('roll forward', () => {
  it('rolls a Sunday balance to Monday', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        ROLL,
        input({ departOn: '2027-09-18', returnOn: '2027-10-02' }),
      ),
    )
    expect(dates.balanceDueOn).toBe('2027-06-21')
    expect(dates.rolledForward).toBe(true)
  })

  it('does not roll when roll-forward is off', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        RULE,
        input({ departOn: '2027-09-18', returnOn: '2027-10-02' }),
      ),
    )
    expect(dates.balanceDueOn).toBe('2027-06-20')
    expect(dates.rolledForward).toBe(false)
  })

  it('rolls a Matariki balance past the holiday', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        ROLL,
        input({ departOn: '2027-09-23', returnOn: '2027-10-07' }),
      ),
    )
    expect(dates.balanceDueOn).toBe('2027-06-28')
  })

  it('does not roll a balance already on a working day', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        ROLL,
        input({ departOn: '2027-09-20', returnOn: '2027-10-04' }),
      ),
    )
    expect(dates.balanceDueOn).toBe('2027-06-22')
    expect(dates.rolledForward).toBe(false)
  })

  it('never rolls in full_payment mode', () => {
    const dates = datesOf(
      computeMilestoneDueDates(
        ROLL,
        input({ bookedOn: '2027-08-01', departOn: '2027-09-18' }),
      ),
    )
    expect(dates.mode).toBe('full_payment')
    expect(dates.rolledForward).toBe(false)
  })
})

describe('mutation sanity', () => {
  const SWAPPED: TravelBookingRule = {
    ...RULE,
    balanceLeadDays: { standard: 120, longOrCruise: 90 },
  }

  it('swapping the leads changes the 15-day balance', () => {
    const dates = datesOf(computeMilestoneDueDates(SWAPPED, input({})))
    expect(dates.balanceDueOn).not.toBe('2027-06-22')
    expect(dates.balanceDueOn).toBe('2027-05-23')
  })

  it('swapping the leads changes the 16-day balance', () => {
    const dates = datesOf(
      computeMilestoneDueDates(SWAPPED, input({ returnOn: '2027-10-05' })),
    )
    expect(dates.balanceDueOn).not.toBe('2027-05-23')
    expect(dates.balanceDueOn).toBe('2027-06-22')
  })

  it('the Friday deposit is not calendar-day arithmetic', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-11-06' })),
    )
    expect(dates.depositDueOn).not.toBe('2026-11-09')
  })

  it('the Friday deposit does not count the booking day', () => {
    const dates = datesOf(
      computeMilestoneDueDates(RULE, input({ bookedOn: '2026-11-06' })),
    )
    expect(dates.depositDueOn).not.toBe('2026-11-10')
  })

  it('changing the deposit window moves the deposit date', () => {
    const fourDays: TravelBookingRule = { ...RULE, depositDueWorkingDays: 4 }
    const dates = datesOf(computeMilestoneDueDates(fourDays, input({})))
    expect(dates.depositDueOn).toBe('2026-11-06')
  })
})
