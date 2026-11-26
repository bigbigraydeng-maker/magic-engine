/**
 * 「今天每小时进线」图 —— 纯函数：把 contact_touchpoints.occurred_at 按新西兰钟点分桶。
 */

import { nzDayMinus, nzToday } from '@/lib/ads-strategy/promo-window'

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

interface NzClock {
  hour: number
  minute: number
  second: number
}

function nzPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number | null {
  const raw = parts.find(p => p.type === type)?.value
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 新西兰钟点、分、秒。同一时刻比较用，避免只截到整点。 */
export function nzClockFromIso(iso: string): NzClock | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NZ,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const hour = nzPart(parts, 'hour')
  const minute = nzPart(parts, 'minute')
  const second = nzPart(parts, 'second')
  if (hour === null || minute === null || second === null) return null
  const h = hour === 24 ? 0 : hour
  if (h < 0 || h > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  return { hour: h, minute, second }
}

export function nzHourFromIso(iso: string): number | null {
  return nzClockFromIso(iso)?.hour ?? null
}

function clockAtOrBefore(clock: NzClock, cutoff: NzClock): boolean {
  if (clock.hour !== cutoff.hour) return clock.hour < cutoff.hour
  if (clock.minute !== cutoff.minute) return clock.minute < cutoff.minute
  return clock.second <= cutoff.second
}

/** 历史日累计：只计新西兰时分秒不晚于 cutoff 的记录。 */
function sumDayThroughClock(rows: readonly HourlyLeadTouch[], day: string, cutoff: NzClock): number {
  let n = 0
  for (const row of rows) {
    if (nzDateFromIso(row.occurred_at) !== day) continue
    const clock = nzClockFromIso(row.occurred_at)
    if (clock && clockAtOrBefore(clock, cutoff)) n += 1
  }
  return n
}

/** @deprecated 使用 nzDayMinus；保留导出名供路由 import 不变 */
export function isoDayMinus(day: string, days: number): string {
  return nzDayMinus(day, days)
}

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
    const day = nzDayMinus(today, d)
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
  const cutoff = nzClockFromIso(now.toISOString())
  if (cutoff === null) return { ok: false, reason: '钟点读不到' }
  const currentHour = cutoff.hour

  const byDay = bucketTouchpoints(rows)
  const todayHours = byDay.get(today) ?? emptyDayMap()
  const yesterday = nzDayMinus(today, 1)
  const lastWeek = nzDayMinus(today, 7)

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
        yesterdaySameTime: sumDayThroughClock(rows, yesterday, cutoff),
        lastWeekSameWeekdaySameTime: sumDayThroughClock(rows, lastWeek, cutoff),
      },
    },
  }
}
