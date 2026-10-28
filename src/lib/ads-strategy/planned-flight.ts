/** Calendar dates on an approved plan are New Zealand dates, inclusive. */
import { nzToday, parsePromoWindow } from './promo-window'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export interface PlannedFlight {
  startDate: string
  endDate: string
}

export function plannedFlightShapeError(flight: PlannedFlight | undefined, durationDays: number): string | null {
  if (!flight) return null
  const parsed = parsePromoWindow({ kind: 'dated', start: flight.startDate, end: flight.endDate })
  if (!parsed || parsed.kind !== 'dated') return '计划投放日期读不懂。'
  const days = 1 + Math.round((Date.parse(`${flight.endDate}T00:00:00Z`) - Date.parse(`${flight.startDate}T00:00:00Z`)) / DAY_MS)
  if (days !== durationDays) return '计划投放日期和草稿天数对不上。'
  return null
}

export function plannedFlightSchedule(
  flight: PlannedFlight | undefined,
  durationDays: number,
  nowMs: number,
): { ok: true; startMs: number; endMs: number } | { ok: false; reason: string } {
  const shape = plannedFlightShapeError(flight, durationDays)
  if (shape) return { ok: false, reason: shape }
  if (!flight) return { ok: true, startMs: nowMs, endMs: nowMs + durationDays * DAY_MS }
  const today = nzToday(nowMs)
  if (today > flight.startDate) return { ok: false, reason: '计划开始日已过，不能把已批准的投放区间往后挪。请先修订计划。' }
  const startMs = today === flight.startDate ? nowMs : nzMidnightMs(flight.startDate)
  const endMs = nzMidnightMs(nextDay(flight.endDate))
  if (endMs - startMs <= DAY_MS) return { ok: false, reason: '计划剩余投放时间不足 24 小时，不能建每日预算广告组。' }
  return { ok: true, startMs, endMs }
}

export function plannedActivationBlock(flight: PlannedFlight | undefined, nowMs: number): string | null {
  if (!flight) return null
  const parsed = parsePromoWindow({ kind: 'dated', start: flight.startDate, end: flight.endDate })
  if (!parsed || parsed.kind !== 'dated') return '计划投放日期读不懂，不能开投。'
  const today = nzToday(nowMs)
  if (today < flight.startDate) return '还没到计划开始日，不能提前开投。'
  if (today > flight.endDate) return '计划投放日期已经结束，不能开投。'
  return null
}

function nextDay(day: string): string {
  const ms = Date.parse(`${day}T00:00:00Z`) + DAY_MS
  return new Date(ms).toISOString().slice(0, 10)
}

/** Convert local midnight to UTC milliseconds, including NZ daylight-saving changes. */
function nzMidnightMs(day: string): number {
  const localAsUtc = Date.parse(`${day}T00:00:00Z`)
  let guess = localAsUtc - 12 * HOUR_MS
  for (let i = 0; i < 3; i += 1) guess = localAsUtc - nzOffsetMs(guess)
  return guess
}

function nzOffsetMs(at: number): number {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Auckland', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(at)).find((value) => value.type === 'timeZoneName')?.value ?? ''
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part)
  if (!match) throw new Error('New Zealand time-zone offset unreadable')
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60_000
}
