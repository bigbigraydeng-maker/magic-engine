import { describe, expect, it } from 'vitest'

import { readBookingScheduleConfig } from '../booking-config'

/** A fully valid, enabled booking schedule config. */
const VALID_SCHEDULE = {
  enabled: true,
  deposit_due_working_days: 3,
  balance_lead_days: { standard: 90, long_or_cruise: 120 },
  long_tour_min_days: 16,
  holiday_region: 'NZ',
  balance_roll_forward: false,
}

/** Wrap a schedule value in a leads config object. */
function withSchedule(schedule: unknown): unknown {
  return { booking_schedule: schedule }
}

/** Build a valid schedule with one field overridden. */
function scheduleWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...VALID_SCHEDULE, ...overrides }
}

describe('readBookingScheduleConfig', () => {
  it('maps a fully valid config to the camelCase rule', () => {
    const result = readBookingScheduleConfig(withSchedule(VALID_SCHEDULE))
    expect(result).toEqual({
      state: 'ready',
      rule: {
        depositDueWorkingDays: 3,
        balanceLeadDays: { standard: 90, longOrCruise: 120 },
        longTourMinDays: 16,
        holidayRegion: 'NZ',
        balanceRollForward: false,
      },
    })
  })

  it('reports missing when leadsConfig is not a plain object', () => {
    expect(readBookingScheduleConfig(undefined)).toEqual({ state: 'missing' })
    expect(readBookingScheduleConfig(null)).toEqual({ state: 'missing' })
    expect(readBookingScheduleConfig([])).toEqual({ state: 'missing' })
    expect(readBookingScheduleConfig('nope')).toEqual({ state: 'missing' })
  })

  it('reports missing when booking_schedule is absent or null', () => {
    expect(readBookingScheduleConfig({})).toEqual({ state: 'missing' })
    expect(readBookingScheduleConfig(withSchedule(null))).toEqual({ state: 'missing' })
  })

  it('reports disabled when enabled is false', () => {
    expect(readBookingScheduleConfig(withSchedule({ enabled: false }))).toEqual({ state: 'disabled' })
  })

  it('reports invalid when enabled is not a boolean', () => {
    const result = readBookingScheduleConfig(withSchedule({ enabled: 'true' }))
    expect(result).toEqual({ state: 'invalid', problems: ['enabled'] })
  })

  it('reports invalid for a non-object booking_schedule', () => {
    const result = readBookingScheduleConfig(withSchedule('nope'))
    expect(result).toEqual({ state: 'invalid', problems: ['booking_schedule'] })
  })

  it('reports invalid for each bad numeric field', () => {
    const badValues = [0, 31, 1.5, '3', Number.NaN, null]
    for (const bad of badValues) {
      const result = readBookingScheduleConfig(withSchedule(scheduleWith({ deposit_due_working_days: bad })))
      expect(result.state).toBe('invalid')
      if (result.state === 'invalid') {
        expect(result.problems).toContain('deposit_due_working_days')
      }
    }
  })

  it('reports invalid when long_or_cruise is below standard', () => {
    const result = readBookingScheduleConfig(
      withSchedule(scheduleWith({ balance_lead_days: { standard: 90, long_or_cruise: 30 } })),
    )
    expect(result.state).toBe('invalid')
    if (result.state === 'invalid') {
      expect(result.problems).toContain('balance_lead_days.long_or_cruise')
    }
  })

  it('reports invalid for an unknown key', () => {
    const result = readBookingScheduleConfig(withSchedule(scheduleWith({ surprise: 1 })))
    expect(result.state).toBe('invalid')
    if (result.state === 'invalid') {
      expect(result.problems).toContain('unknown_key:surprise')
    }
  })

  it('reports invalid for an unsupported holiday region', () => {
    const result = readBookingScheduleConfig(withSchedule(scheduleWith({ holiday_region: 'AU' })))
    expect(result.state).toBe('invalid')
    if (result.state === 'invalid') {
      expect(result.problems).toContain('holiday_region')
    }
  })

  it('lists every problem when two fields are bad', () => {
    const result = readBookingScheduleConfig(
      withSchedule(scheduleWith({ deposit_due_working_days: 0, long_tour_min_days: 999 })),
    )
    expect(result.state).toBe('invalid')
    if (result.state === 'invalid') {
      expect(result.problems).toContain('deposit_due_working_days')
      expect(result.problems).toContain('long_tour_min_days')
    }
  })
})
