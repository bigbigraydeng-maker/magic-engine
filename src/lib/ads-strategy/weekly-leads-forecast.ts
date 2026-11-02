/**
 * 当周进线预测：本周已有 + 余下各天按近 28 天同星期几日均估算（区间）。
 */

import {
  FORECAST_HISTORY_DAYS,
  FORECAST_MIN_DAY_TOTAL,
  leadCountRangeFromSamples,
} from '@/lib/ads-strategy/hourly-leads-forecast'
import {
  buildDayBuckets,
  isoDayMinus,
  nzHourFromIso,
  type HourlyLeadTouch,
} from '@/lib/ads-strategy/hourly-meta-leads'
import { nzDayMinus, nzToday } from '@/lib/ads-strategy/promo-window'

export const WEEK_FORECAST_MIN_WEEKDAY_SAMPLES = 2

export interface WeeklyLeadForecastOk {
  status: 'ok'
  rangeMin: number
  rangeMax: number
  weekSoFar: number
  historyDays: number
  disclaimer: string
}

export interface WeeklyLeadForecastInsufficient {
  status: 'insufficient'
  message: '数据不足'
}

export type WeeklyLeadForecast = WeeklyLeadForecastOk | WeeklyLeadForecastInsufficient

function emptyDayMap(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

function dayTotal(hours: readonly number[]): number {
  return hours.reduce((a, b) => a + b, 0)
}

function sumThroughHour(hours: readonly number[], through: number): number {
  let n = 0
  for (let h = 0; h <= through && h < 24; h++) n += hours[h] ?? 0
  return n
}

/** 新西兰日历日：周一=0 … 周日=6 */
export function nzWeekdayMondayZero(day: string): number {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const js = new Date(Date.UTC(year, month - 1, date)).getUTCDay()
  return js === 0 ? 6 : js - 1
}

/** 含 today 在内的当周周一（新西兰日历）。 */
export function nzWeekStartMonday(today: string): string {
  const wd = nzWeekdayMondayZero(today)
  return nzDayMinus(today, wd)
}

function nzDayPlus(day: string, days: number): string {
  if (days <= 0) return day
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const ms = Date.UTC(year, month - 1, date + days)
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function isEligibleDayTotal(total: number): boolean {
  return total >= FORECAST_MIN_DAY_TOTAL
}

function weekdayHistorySamples(
  byDay: ReadonlyMap<string, number[]>,
  today: string,
  weekday: number,
): number[] {
  const samples: number[] = []
  for (let d = 1; d <= FORECAST_HISTORY_DAYS; d++) {
    const day = isoDayMinus(today, d)
    if (nzWeekdayMondayZero(day) !== weekday) continue
    const hours = byDay.get(day)
    if (!hours) continue
    const total = dayTotal(hours)
    if (!isEligibleDayTotal(total)) continue
    samples.push(total)
  }
  return samples
}

export function computeWeeklyLeadForecast(
  byDay: ReadonlyMap<string, number[]>,
  today: string,
  currentHour: number,
): WeeklyLeadForecast {
  const weekStart = nzWeekStartMonday(today)
  const todayWd = nzWeekdayMondayZero(today)

  let weekSoFar = 0
  for (let wd = 0; wd <= todayWd; wd++) {
    const day = nzDayPlus(weekStart, wd)
    const hours = byDay.get(day) ?? emptyDayMap()
    if (day === today) {
      weekSoFar += sumThroughHour(hours, currentHour)
    } else {
      weekSoFar += dayTotal(hours)
    }
  }

  let rangeMin = weekSoFar
  let rangeMax = weekSoFar
  let minSampleCount = FORECAST_HISTORY_DAYS

  for (let wd = todayWd + 1; wd <= 6; wd++) {
    const samples = weekdayHistorySamples(byDay, today, wd)
    const band = leadCountRangeFromSamples(samples, WEEK_FORECAST_MIN_WEEKDAY_SAMPLES)
    if (!band) {
      return { status: 'insufficient', message: '数据不足' }
    }
    minSampleCount = Math.min(minSampleCount, band.sampleCount)
    rangeMin += band.low
    rangeMax += band.high
  }

  return {
    status: 'ok',
    rangeMin: Math.min(rangeMin, rangeMax),
    rangeMax: Math.max(rangeMin, rangeMax),
    weekSoFar,
    historyDays: minSampleCount === FORECAST_HISTORY_DAYS ? FORECAST_HISTORY_DAYS : minSampleCount,
    disclaimer: `按近 ${FORECAST_HISTORY_DAYS} 天同星期几的日均推算，预算或广告一变就会不准`,
  }
}

export function buildWeeklyLeadForecastFromRows(
  rows: readonly HourlyLeadTouch[],
  now: Date = new Date(),
): WeeklyLeadForecast | null {
  if (!Number.isFinite(now.getTime())) return null
  const today = nzToday(now.getTime())
  const currentHour = nzHourFromIso(now.toISOString())
  if (currentHour === null) return null
  const byDay = buildDayBuckets(rows)
  return computeWeeklyLeadForecast(byDay, today, currentHour)
}
