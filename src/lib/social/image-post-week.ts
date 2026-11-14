/**
 * Which image-post dates a weekly draft should write.
 * A configured weekly count (social_week, else quota) replaces the daily cap.
 * No weekly count leaves the existing per-day path alone.
 */

import { addCalendarDays, isoDate } from '@/lib/social/week-pack/cadence'
import { resolveConfiguredWeekCounts, type WeekCountSource } from '@/lib/social/social-week-quota'
import { MAX_WEEK_SLOTS } from '@/lib/social/weekly-plan/types'

export interface WeekWindow {
  weekStart: string
  weekEnd: string
}

export type ImagePostBatch =
  | { action: 'day' }
  | { action: 'week-skip'; skipped: string; requested: number | null }
  | { action: 'week'; dates: string[]; source: WeekCountSource; requested: number; weekStart: string; weekEnd: string }

export function decideImagePostBatch(input: { config: unknown; week: WeekWindow | null }): ImagePostBatch {
  if (!input.week || !isoDay(input.week.weekStart)) return { action: 'day' }
  const post = resolveConfiguredWeekCounts(input.config).post
  if (post.source === 'none' || post.value === null) return { action: 'day' }
  if (post.value === 0) {
    const skipped = post.source === 'social_week' ? 'post_per_week=0' : 'post_quota=0'
    return { action: 'week-skip', skipped, requested: 0 }
  }
  if (post.value > MAX_WEEK_SLOTS) {
    return { action: 'week-skip', skipped: 'post_count_over_cap', requested: post.value }
  }
  return {
    action: 'week',
    dates: spreadWeekDates(input.week.weekStart, post.value),
    source: post.source,
    requested: post.value,
    weekStart: input.week.weekStart,
    weekEnd: input.week.weekEnd,
  }
}

/** Evenly spaced days in the Monday–Sunday window. Extra rows after day 7 repeat from Monday. */
export function spreadWeekDates(weekStart: string, count: number): string[] {
  const days = weekDates(weekStart)
  if (!days || count <= 0) return []
  return evenDayIndexes(count).map((index) => days[index] ?? days[0])
}

export function datesStillNeeded(planned: readonly string[], existing: ReadonlyMap<string, number>): string[] {
  const consumed = new Map<string, number>()
  const out: string[] = []
  for (const date of planned) {
    const used = consumed.get(date) ?? 0
    const have = existing.get(date) ?? 0
    consumed.set(date, used + 1)
    if (used < have) continue
    out.push(date)
  }
  return out
}

export function autoImagePostDate(planData: unknown, week: WeekWindow): string | null {
  const root = record(planData)
  const meta = record(root?.command_meta)
  if (meta?.source !== 'auto_image_post') return null
  const days = Array.isArray(root?.days) ? root.days : []
  const date = record(days[0])?.date
  if (typeof date !== 'string' || !isoDay(date)) return null
  if (date < week.weekStart || date > week.weekEnd) return null
  return date
}

function weekDates(weekStart: string): string[] | null {
  const parts = isoDay(weekStart)
  if (!parts) return null
  const out: string[] = []
  for (let i = 0; i < 7; i++) out.push(isoDate(addCalendarDays(parts.year, parts.month, parts.day, i)))
  return out
}

function evenDayIndexes(count: number): number[] {
  const first = Math.min(count, 7)
  const used = new Set<number>()
  const picked: number[] = []
  for (let i = 0; i < first; i++) {
    const ideal = first === 1 ? 0 : Math.round((i * 6) / (first - 1))
    const day = nearestFree(ideal, used)
    used.add(day)
    picked.push(day)
  }
  picked.sort((a, b) => a - b)
  for (let i = 7; i < count; i++) picked.push(i % 7)
  return picked
}

function nearestFree(ideal: number, used: Set<number>): number {
  if (!used.has(ideal)) return ideal
  for (let delta = 1; delta <= 6; delta++) {
    if (ideal + delta <= 6 && !used.has(ideal + delta)) return ideal + delta
    if (ideal - delta >= 0 && !used.has(ideal - delta)) return ideal - delta
  }
  return ideal % 7
}

function isoDay(raw: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
