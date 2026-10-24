import { describe, expect, it } from 'vitest'
import { nzCalendarDaysBetween, shouldSkipWeeklyBaseline } from './weekly-throttle'

describe('weekly baseline throttle', () => {
  it('allows a run at 06:00 NZ seven calendar days after a 06:01 run', () => {
    const last = new Date('2026-09-30T17:01:00.000Z') // 2026-10-01 06:01 NZDT
    const now = new Date('2026-10-07T17:00:00.000Z') // 2026-10-08 06:00 NZDT
    expect(nzCalendarDaysBetween(last, now)).toBe(7)
    expect(shouldSkipWeeklyBaseline(last, now)).toBe(false)
  })

  it('still skips when only six New Zealand calendar days have passed', () => {
    const last = new Date('2026-10-01T17:01:00.000Z') // 2026-10-02 06:01 NZDT
    const now = new Date('2026-10-07T17:00:00.000Z') // 2026-10-08 06:00 NZDT
    expect(nzCalendarDaysBetween(last, now)).toBe(6)
    expect(shouldSkipWeeklyBaseline(last, now)).toBe(true)
  })
})
