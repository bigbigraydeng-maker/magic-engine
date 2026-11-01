/**
 * Auckland week for a publishing-quota usage line.
 * Monday 00:00 through the next Monday, in Pacific/Auckland calendar dates.
 * An item is in the week when its slot's New Zealand date falls in that range.
 */
import { nzDateKey } from '../story-lite/page-text'

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

function calendarWeekday(dateKey: string): number | null {
  const match = DATE_KEY.exec(dateKey)
  if (!match) return null
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== dateKey) return null
  const day = utc.getUTCDay()
  return day === 0 ? 7 : day
}

function addCalendarDays(dateKey: string, days: number): string | null {
  const match = DATE_KEY.exec(dateKey)
  if (!match) return null
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12))
  if (Number.isNaN(utc.getTime())) return null
  return utc.toISOString().slice(0, 10)
}

/** Inclusive start (Monday) and exclusive end (next Monday). Null when `now` has no calendar date. */
export function aucklandWeekBounds(now: Date): { start: string; end: string } | null {
  const today = nzDateKey(now.toISOString())
  const weekday = calendarWeekday(today)
  if (weekday === null) return null
  const start = addCalendarDays(today, 1 - weekday)
  const end = start ? addCalendarDays(start, 7) : null
  if (!start || !end) return null
  return { start, end }
}

/** How many slots fall in the Auckland week that contains `now`. Unreadable slots are not counted. */
export function countSlotsInAucklandWeek(slotAts: readonly string[], now: Date): number {
  const bounds = aucklandWeekBounds(now)
  if (!bounds) return 0
  let count = 0
  for (const slotAt of slotAts) {
    const day = nzDateKey(slotAt)
    if (day >= bounds.start && day < bounds.end) count += 1
  }
  return count
}
