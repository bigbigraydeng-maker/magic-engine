import { describe, expect, it } from 'vitest'
import {
  computeDailyLeadForecast,
  todayArrivedForForecast,
  FORECAST_MIN_ELIGIBLE_DAYS,
  FORECAST_MIN_CUMULATIVE_SHARE,
  FORECAST_MIN_TODAY_ARRIVED,
} from '../hourly-leads-forecast'
import { isoDayMinus } from '../hourly-meta-leads'

const TODAY = '2026-10-20'
const CURRENT_HOUR = 16

function emptyDay(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

/** 每天 total 条，在 0..throughSpread 均匀铺开（用于累计占比）。 */
function seedHistory(
  today: string,
  days: number,
  dailyTotal: number,
  throughSpread: number,
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (let d = 1; d <= days; d++) {
    const day = isoDayMinus(today, d)
    const hours = emptyDay()
    const per = Math.floor(dailyTotal / (throughSpread + 1))
    let left = dailyTotal
    for (let h = 0; h <= throughSpread && left > 0; h++) {
      const n = h === throughSpread ? left : per
      hours[h] = n
      left -= n
    }
    map.set(day, hours)
  }
  return map
}

describe('todayArrivedForForecast', () => {
  it('excludes the last 2 clock hours from today count', () => {
    const hours = emptyDay()
    hours[14] = 2
    hours[15] = 3
    hours[16] = 9
    expect(todayArrivedForForecast(hours, 16)).toBe(2)
  })
})

describe('computeDailyLeadForecast thresholds', () => {
  it(`needs at least ${FORECAST_MIN_ELIGIBLE_DAYS} eligible history days`, () => {
    const byDay = seedHistory(TODAY, FORECAST_MIN_ELIGIBLE_DAYS - 1, 8, CURRENT_HOUR)
    byDay.set(TODAY, emptyDay())
    const r = computeDailyLeadForecast(byDay, TODAY, CURRENT_HOUR)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(r.message).toBe('数据不足，不预测')
  })

  it(`needs mean cumulative share ≥ ${FORECAST_MIN_CUMULATIVE_SHARE}`, () => {
    const byDay = seedHistory(TODAY, 20, 100, 2)
    byDay.set(TODAY, (() => {
      const h = emptyDay()
      h[10] = FORECAST_MIN_TODAY_ARRIVED
      return h
    })())
    const r = computeDailyLeadForecast(byDay, TODAY, 6)
    expect(r.status).toBe('insufficient')
  })

  it(`needs today arrived ≥ ${FORECAST_MIN_TODAY_ARRIVED} (after provisional cut)`, () => {
    const byDay = seedHistory(TODAY, 20, 10, CURRENT_HOUR)
    const todayHours = emptyDay()
    todayHours[10] = FORECAST_MIN_TODAY_ARRIVED - 1
    byDay.set(TODAY, todayHours)
    const r = computeDailyLeadForecast(byDay, TODAY, CURRENT_HOUR)
    expect(r.status).toBe('insufficient')
  })
})

describe('computeDailyLeadForecast range maths', () => {
  it('returns a range only (no point field)', () => {
    const byDay = seedHistory(TODAY, 20, 10, CURRENT_HOUR)
    const todayHours = emptyDay()
    todayHours[10] = 6
    byDay.set(TODAY, todayHours)
    const r = computeDailyLeadForecast(byDay, TODAY, CURRENT_HOUR)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.rangeMin).toBeLessThanOrEqual(r.rangeMax)
    expect(r.rangeMin).toBeGreaterThan(0)
    expect(r.historyDays).toBeGreaterThanOrEqual(FORECAST_MIN_ELIGIBLE_DAYS)
    expect(r.disclaimer).toContain('按过去')
    expect(Object.keys(r)).not.toContain('point')
    expect(Object.keys(r)).not.toContain('mid')
  })

  it('range widens when historical cumulative shares vary more', () => {
    const byDay = new Map<string, number[]>()
    for (let d = 1; d <= 20; d++) {
      const day = isoDayMinus(TODAY, d)
      const hours = emptyDay()
      if (d % 2 === 0) {
        hours[0] = 5
        hours[20] = 5
      } else {
        hours[0] = 9
        hours[16] = 1
      }
      byDay.set(day, hours)
    }
    const todayHours = emptyDay()
    todayHours[10] = 8
    byDay.set(TODAY, todayHours)
    const r = computeDailyLeadForecast(byDay, TODAY, CURRENT_HOUR)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.rangeMax).toBeGreaterThan(r.rangeMin)
  })
})
