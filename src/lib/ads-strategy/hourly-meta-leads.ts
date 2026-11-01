/**
 * 「今天每小时进线」图 —— 纯函数：把 contact_touchpoints.occurred_at 按新西兰钟点分桶。
 */

import { nzToday } from '@/lib/ads-strategy/promo-window'

const NZ = 'Pacific/Auckland'

export interface HourlyLeadTouch {
  occurred_at: string
}

export interface HourlyLeadBar {
  hour: number
  today: number
  avg7d: number
  /** 最近 2 小时：表单同步可能有延迟 */
  provisional: boolean
}

export interface HourlyLeadTotals {
  todaySoFar: number
  yesterdaySameTime: number
  lastWeekSameWeekdaySameTime: number
}

export interface HourlyLeadChart {
  nzDate: string
  currentHour: number
  bars: HourlyLeadBar[]
  totals: HourlyLeadTotals
}

export type HourlyLeadBuildResult =
  | { ok: true; chart: HourlyLeadChart }
  | { ok: false; reason: string }

function nzDateFromMs(ms: number): string {
  return nzToday(ms)
}

export function nzDateFromIso(iso: string): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return nzDateFromMs(ms)
}

export function nzHourFromIso(iso: string): number | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NZ,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(ms))
  const h = parts.find(p => p.type === 'hour')?.value
  if (h === undefined) return null
  const n = Number(h)
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : null
}

function isoDayMinus(day: string, days: number): string {
  const ms = Date.parse(`${day}T12:00:00Z`) - days * 86_400_000
  return nzDateFromMs(ms)
}

export { isoDayMinus }

function emptyDayMap(): number[] {
  return Array.from({ length: 24 }, () => 0)
}

function bucketTouchpoints(rows: readonly HourlyLeadTouch[]): Map<string, number[]> {
  const byDay = new Map<string, number[]>()
  for (const row of rows) {
    const d = nzDateFromIso(row.occurred_at)
    const h = nzHourFromIso(row.occurred_at)
    if (d === null || h === null) continue
    let hours = byDay.get(d)
    if (!hours) {
      hours = emptyDayMap()
      byDay.set(d, hours)
    }
    hours[h] += 1
  }
  return byDay
}

export function buildDayBuckets(rows: readonly HourlyLeadTouch[]): Map<string, number[]> {
  return bucketTouchpoints(rows)
}

function sumHours(hours: readonly number[], throughHour: number): number {
  let n = 0
  for (let h = 0; h <= throughHour && h < 24; h++) n += hours[h] ?? 0
  return n
}

function avgPast7SameHour(byDay: Map<string, number[]>, today: string, hour: number): number {
  const samples: number[] = []
  for (let d = 1; d <= 7; d++) {
    const day = isoDayMinus(today, d)
    const hours = byDay.get(day)
    samples.push(hours ? (hours[hour] ?? 0) : 0)
  }
  const sum = samples.reduce((a, b) => a + b, 0)
  return Math.round((sum / samples.length) * 10) / 10
}

/** 构建 0..currentHour 的柱 + 对比总数。rows 为空数组合法（全 0）。 */
export function buildHourlyLeadChart(
  rows: readonly HourlyLeadTouch[],
  now: Date = new Date(),
): HourlyLeadBuildResult {
  if (!Number.isFinite(now.getTime())) return { ok: false, reason: '时间无效' }
  const today = nzToday(now.getTime())
  const currentHour = nzHourFromIso(now.toISOString())
  if (currentHour === null) return { ok: false, reason: '钟点读不到' }

  const byDay = bucketTouchpoints(rows)
  const todayHours = byDay.get(today) ?? emptyDayMap()
  const yesterday = isoDayMinus(today, 1)
  const lastWeek = isoDayMinus(today, 7)
  const yHours = byDay.get(yesterday) ?? emptyDayMap()
  const lwHours = byDay.get(lastWeek) ?? emptyDayMap()

  const bars: HourlyLeadBar[] = []
  for (let hour = 0; hour <= currentHour; hour++) {
    bars.push({
      hour,
      today: todayHours[hour] ?? 0,
      avg7d: avgPast7SameHour(byDay, today, hour),
      provisional: hour >= currentHour - 1,
    })
  }

  return {
    ok: true,
    chart: {
      nzDate: today,
      currentHour,
      bars,
      totals: {
        todaySoFar: sumHours(todayHours, currentHour),
        yesterdaySameTime: sumHours(yHours, currentHour),
        lastWeekSameWeekdaySameTime: sumHours(lwHours, currentHour),
      },
    },
  }
}
