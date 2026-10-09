import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  isBusinessDay,
  isPastPromiseDue,
  leadPromiseDueAt,
  nextBusinessDay,
  nzLocalDate,
  zonedMidnightUtc,
} from '../nz-business-days'

const HOLIDAYS: ReadonlySet<string> = new Set(['2026-10-26'])

describe('nzLocalDate', () => {
  it('returns the next calendar day when the instant is late UTC', () => {
    expect(nzLocalDate(new Date('2026-10-05T12:30:00Z'))).toBe('2026-10-06')
  })

  it('returns the same calendar day when the instant is early UTC', () => {
    expect(nzLocalDate(new Date('2026-10-05T10:00:00Z'))).toBe('2026-10-05')
  })
})

describe('isBusinessDay', () => {
  it('is true for a Monday', () => {
    expect(isBusinessDay('2026-10-05', HOLIDAYS)).toBe(true)
  })

  it('is false for a Saturday', () => {
    expect(isBusinessDay('2026-10-10', HOLIDAYS)).toBe(false)
  })

  it('is false for a Sunday', () => {
    expect(isBusinessDay('2026-10-11', HOLIDAYS)).toBe(false)
  })

  it('is false for a listed holiday', () => {
    expect(isBusinessDay('2026-10-26', HOLIDAYS)).toBe(false)
  })
})

describe('addDaysIso', () => {
  it('adds days across a month boundary', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01')
  })
})

describe('nextBusinessDay', () => {
  it('skips the weekend from a Friday', () => {
    expect(nextBusinessDay('2026-10-09', HOLIDAYS)).toBe('2026-10-12')
  })

  it('skips the weekend from a Saturday', () => {
    expect(nextBusinessDay('2026-10-10', HOLIDAYS)).toBe('2026-10-12')
  })

  it('skips the weekend and the Monday holiday', () => {
    expect(nextBusinessDay('2026-10-23', HOLIDAYS)).toBe('2026-10-27')
  })
})

describe('leadPromiseDueAt', () => {
  it('is due at the end of the next business day for a Monday submission', () => {
    const due = leadPromiseDueAt(new Date('2026-10-05T01:00:00Z'), HOLIDAYS)
    expect(due.toISOString()).toBe('2026-10-06T11:00:00.000Z')
  })

  it('is due at the end of Monday for a Saturday submission', () => {
    const due = leadPromiseDueAt(new Date('2026-10-09T23:00:00Z'), HOLIDAYS)
    expect(due.toISOString()).toBe('2026-10-12T11:00:00.000Z')
  })

  it('is due at the end of Tuesday when Monday is a holiday', () => {
    const due = leadPromiseDueAt(new Date('2026-10-23T01:00:00Z'), HOLIDAYS)
    expect(due.toISOString()).toBe('2026-10-27T11:00:00.000Z')
  })
})

describe('zonedMidnightUtc', () => {
  it('uses NZST (UTC+12) on the DST start day', () => {
    expect(zonedMidnightUtc('2026-09-27').toISOString()).toBe('2026-09-26T12:00:00.000Z')
  })

  it('uses NZDT (UTC+13) after the DST start', () => {
    expect(zonedMidnightUtc('2026-09-28').toISOString()).toBe('2026-09-27T11:00:00.000Z')
  })
})

describe('isPastPromiseDue', () => {
  const submittedAt = new Date('2026-10-05T01:00:00Z')
  const due = leadPromiseDueAt(submittedAt, HOLIDAYS)

  it('is false one millisecond before the due instant', () => {
    const now = new Date(due.getTime() - 1)
    expect(isPastPromiseDue(submittedAt, now, HOLIDAYS)).toBe(false)
  })

  it('is true exactly at the due instant', () => {
    const now = new Date(due.getTime())
    expect(isPastPromiseDue(submittedAt, now, HOLIDAYS)).toBe(true)
  })
})
