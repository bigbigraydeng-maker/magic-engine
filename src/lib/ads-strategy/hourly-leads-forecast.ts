/**
 * 需求 ②：按近 28 天钟点规律估算「今天全天大约多少条」——纯函数。
 *
 * 只输出区间；门槛不满足 → 「数据不足，不预测」。
 */

import {
  buildDayBuckets,
  isoDayMinus,
  nzHourFromIso,
  type HourlyLeadTouch,
} from '@/lib/ads-strategy/hourly-meta-leads'
import { nzToday } from '@/lib/ads-strategy/promo-window'

export const FORECAST_HISTORY_DAYS = 28
export const FORECAST_MIN_ELIGIBLE_DAYS = 14
export const FORECAST_MIN_DAY_TOTAL = 5
export const FORECAST_MIN_CUMULATIVE_SHARE = 0.2
export const FORECAST_MIN_TODAY_ARRIVED = 3
export const FORECAST_PROVISIONAL_HOURS = 2

export interface LeadForecastOk {
  status: 'ok'
  rangeMin: number
  rangeMax: number
  historyDays: number
  disclaimer: string
}

export interface LeadForecastInsufficient {
  status: 'insufficient'
  message: '数据不足，不预测'
}

export type LeadForecast = LeadForecastOk | LeadForecastInsufficient

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

function sampleStdDev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function todayArrivedForForecast(todayHours: readonly number[], currentHour: number): number {
  const lastReliableHour = currentHour - FORECAST_PROVISIONAL_HOURS
  if (lastReliableHour < 0) return 0
  return sumThroughHour(todayHours, lastReliableHour)
}

export function computeDailyLeadForecast(
  byDay: ReadonlyMap<string, number[]>,
  today: string,
  currentHour: number,
): LeadForecast {
  const proportions: number[] = []
  for (let d = 1; d <= FORECAST_HISTORY_DAYS; d++) {
    const day = isoDayMinus(today, d)
    const hours = byDay.get(day)
    if (!hours) continue
    const total = dayTotal(hours)
    if (total < FORECAST_MIN_DAY_TOTAL) continue
    const through = sumThroughHour(hours, currentHour)
    proportions.push(through / total)
  }

  if (proportions.length < FORECAST_MIN_ELIGIBLE_DAYS) {
    return { status: 'insufficient', message: '数据不足，不预测' }
  }

  const meanShare = proportions.reduce((a, b) => a + b, 0) / proportions.length
  if (meanShare < FORECAST_MIN_CUMULATIVE_SHARE) {
    return { status: 'insufficient', message: '数据不足，不预测' }
  }

  const todayHours = byDay.get(today) ?? emptyDayMap()
  const arrived = todayArrivedForForecast(todayHours, currentHour)
  if (arrived < FORECAST_MIN_TODAY_ARRIVED) {
    return { status: 'insufficient', message: '数据不足，不预测' }
  }

  const std = sampleStdDev(proportions, meanShare)
  const lowShare = Math.max(meanShare - std, 0.01)
  const highShare = Math.min(meanShare + std, 0.99)

  const rangeMax = Math.max(0, Math.ceil(arrived / lowShare))
  const rangeMin = Math.max(0, Math.floor(arrived / highShare))

  const n = proportions.length
  return {
    status: 'ok',
    rangeMin: Math.min(rangeMin, rangeMax),
    rangeMax: Math.max(rangeMin, rangeMax),
    historyDays: n,
    disclaimer: `按过去 ${n} 天的每小时规律推算，预算或广告一变就会不准`,
  }
}

export function buildLeadForecastFromRows(
  rows: readonly HourlyLeadTouch[],
  now: Date = new Date(),
): LeadForecast | null {
  if (!Number.isFinite(now.getTime())) return null
  const today = nzToday(now.getTime())
  const currentHour = nzHourFromIso(now.toISOString())
  if (currentHour === null) return null
  const byDay = buildDayBuckets(rows)
  return computeDailyLeadForecast(byDay, today, currentHour)
}
