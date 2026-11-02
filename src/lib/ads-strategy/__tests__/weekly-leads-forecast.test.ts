import { describe, expect, it } from 'vitest'
import {
  computeWeeklyLeadForecast,
  nzWeekStartMonday,
  nzWeekdayMondayZero,
  WEEK_FORECAST_MIN_WEEKDAY_SAMPLES,
} from '../weekly-leads-forecast'
import { FORECAST_MIN_DAY_TOTAL } from '../hourly-leads-forecast'
import { isoDayMinus } from '../hourly-meta-leads'

const CURRENT_HOUR = 16

function emptyDay(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

function setDayTotal(map: Map<string, number[]>, day: string, total: number): void {
  const hours = emptyDay()
  hours[10] = total
  map.set(day, hours)
}

describe('nzWeekStartMonday (Pacific/Auckland calendar)', () => {
  it('Monday is its own week start', () => {
    expect(nzWeekStartMonday('2026-10-19')).toBe('2026-10-19')
    expect(nzWeekdayMondayZero('2026-10-19')).toBe(0)
  })

  it('Wednesday maps back to prior Monday', () => {
    expect(nzWeekStartMonday('2026-10-21')).toBe('2026-10-19')
  })

  it('Sunday belongs to the Monday six days earlier', () => {
    expect(nzWeekStartMonday('2026-10-25')).toBe('2026-10-19')
    expect(nzWeekdayMondayZero('2026-10-25')).toBe(6)
  })
})

describe('weekday averaging', () => {
  it('sums week-so-far and adds per-weekday bands for remaining days', () => {
    const today = '2026-10-21' // Wed
    const byDay = new Map<string, number[]>()

    setDayTotal(byDay, '2026-10-19', 10) // Mon this week
    setDayTotal(byDay, '2026-10-20', 8) // Tue
    const todayHours = emptyDay()
    todayHours[12] = 4
    byDay.set(today, todayHours)

    for (let d = 1; d <= 28; d++) {
      const day = isoDayMinus(today, d)
      const wd = nzWeekdayMondayZero(day)
      if (wd === 3) setDayTotal(byDay, day, 12)
      else if (wd === 4) setDayTotal(byDay, day, 14)
      else if (wd === 5) setDayTotal(byDay, day, 16)
      else if (wd === 6) setDayTotal(byDay, day, 6)
    }

    const r = computeWeeklyLeadForecast(byDay, today, CURRENT_HOUR)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.weekSoFar).toBe(10 + 8 + 4)
    expect(r.rangeMin).toBeGreaterThanOrEqual(r.weekSoFar)
    expect(r.rangeMax).toBeGreaterThanOrEqual(r.rangeMin)
  })
})

describe('paused-day exclusion', () => {
  it(`skips history days with total < ${FORECAST_MIN_DAY_TOTAL} (same gate as daily forecast)`, () => {
    const today = '2026-10-24' // Sat — only Sunday left in week
    const byDay = new Map<string, number[]>()
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
      setDayTotal(byDay, d, 6)
    }
    const todayHours = emptyDay()
    todayHours[11] = 3
    byDay.set(today, todayHours)

    setDayTotal(byDay, '2026-10-18', 12)
    setDayTotal(byDay, '2026-10-11', 14)
    setDayTotal(byDay, '2026-10-04', 0)

    const r = computeWeeklyLeadForecast(byDay, today, CURRENT_HOUR)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.rangeMax).toBeGreaterThan(r.weekSoFar)
  })
})

describe('insufficient sample', () => {
  it(`returns 数据不足 when a remaining weekday has < ${WEEK_FORECAST_MIN_WEEKDAY_SAMPLES} eligible samples`, () => {
    const today = '2026-10-19' // Mon — Tue..Sun remain
    const byDay = new Map<string, number[]>()
    const todayHours = emptyDay()
    todayHours[9] = FORECAST_MIN_DAY_TOTAL
    byDay.set(today, todayHours)

    for (let d = 1; d <= 28; d++) {
      const day = isoDayMinus(today, d)
      const wd = nzWeekdayMondayZero(day)
      if (wd === 1) setDayTotal(byDay, day, 8)
    }

    const r = computeWeeklyLeadForecast(byDay, today, CURRENT_HOUR)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(r.message).toBe('数据不足')
  })
})
