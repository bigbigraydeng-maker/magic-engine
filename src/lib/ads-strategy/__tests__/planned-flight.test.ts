import { describe, expect, it } from 'vitest'
import { plannedFlightSchedule } from '../planned-flight'

describe('approved plan flight', () => {
  const flight = { startDate: '2026-09-27', endDate: '2026-09-28' }

  it('keeps New Zealand calendar dates across the daylight-saving change', () => {
    const schedule = plannedFlightSchedule(flight, 2, Date.parse('2026-09-26T00:00:00Z'))
    expect(schedule).toEqual({
      ok: true,
      startMs: Date.parse('2026-09-26T12:00:00Z'),
      endMs: Date.parse('2026-09-28T11:00:00Z'),
    })
  })

  it('does not move an approved start day to the following day', () => {
    expect(plannedFlightSchedule(flight, 2, Date.parse('2026-09-28T00:00:00Z'))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('开始日已过'),
    })
    expect(plannedFlightSchedule(flight, 3, Date.parse('2026-09-26T00:00:00Z'))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('对不上'),
    })
  })
})
