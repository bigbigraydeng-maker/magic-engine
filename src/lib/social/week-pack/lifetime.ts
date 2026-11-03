/**
 * Story authorisation lifetime for one weekly pack.
 * Story lite counts whole days from the click, and refuses anything outside 1..14.
 * Seven days from a Friday click ends before the following Sunday, so the pack must
 * use the shortest allowed lifetime that still covers the target week.
 */

import { addCalendarDays, targetWeek } from './cadence'

const DAY_MS = 24 * 60 * 60 * 1000
const NZ = 'Pacific/Auckland'
const MIN_DAYS = 1
const MAX_DAYS = 14

function nzOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NZ, timeZoneName: 'longOffset', hour: '2-digit',
  }).formatToParts(instant)
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  const match = raw.match(/([+-])(\d{2}):(\d{2})/)
  if (!match) throw new Error('week-pack: timezone offset unreadable')
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000
}

/** 00:00 in New Zealand on the given calendar day, as a UTC instant. */
export function nzMidnightUtc(year: number, month: number, day: number): Date {
  const rough = new Date(Date.UTC(year, month - 1, day) - 13 * 60 * 60 * 1000)
  const utc = Date.UTC(year, month - 1, day) - nzOffsetMs(rough)
  const instant = new Date(utc)
  const again = Date.UTC(year, month - 1, day) - nzOffsetMs(instant)
  return new Date(again)
}

/**
 * Whole days from `now` through the end of `weekEnd` (that NZ Sunday inclusive).
 * Clamped to the 1..14 days Story lite accepts.
 */
export function lifetimeDaysCoveringWeek(now: Date, weekEnd: string): number {
  const [year, month, day] = weekEnd.split('-').map(Number)
  if (!year || !month || !day) return MAX_DAYS
  const next = addCalendarDays(year, month, day, 1)
  const end = nzMidnightUtc(next.year, next.month, next.day)
  const days = Math.ceil((end.getTime() - now.getTime()) / DAY_MS)
  if (!Number.isFinite(days) || days < MIN_DAYS) return MIN_DAYS
  if (days > MAX_DAYS) return MAX_DAYS
  return days
}

/** The lifetime load and authorise must both use for this click. */
export function storyAuthorizeLifetime(now: Date): number {
  return lifetimeDaysCoveringWeek(now, targetWeek(now).weekEnd)
}
