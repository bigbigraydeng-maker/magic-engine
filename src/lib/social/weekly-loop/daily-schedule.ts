/**
 * Daily cadence for the social agent (dev plan v1.2, knife 1). Pure helpers only.
 *
 * - Look window: tomorrow .. today+28 (NZ). Everything already dated inside it occupies its day,
 *   so a date is never booked twice and product adjacency sees the whole month.
 * - Slot window: tomorrow and the day after. Only empty days there get a new item.
 * - Versions: if any version of the same reel already has a date, no other version gets one
 *   (the dated one may already be approved); otherwise only the newest version is eligible.
 */
import { groupVersions, type VersionRow } from './version-groups'
import type { ScheduledItem } from './schedule'
import { isExcludedByCard } from '@/lib/factory/publish/promote/scheduled-authorize-list'

/** Reel publishing allows scheduling up to 29 days ahead; one day of margin. */
export const DAILY_LOOK_DAYS = 28
export const DAILY_SLOT_DAYS = 2

const DAY_MS = 24 * 60 * 60 * 1000
const NZ_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10)
}

export interface DailyWindows {
  today: string
  lookStart: string
  lookEnd: string
  slotDates: string[]
}

export function dailyWindows(now: Date): DailyWindows {
  const today = NZ_DATE_FMT.format(now)
  const slotDates: string[] = []
  for (let i = 1; i <= DAILY_SLOT_DAYS; i += 1) slotDates.push(addDays(today, i))
  return { today, lookStart: addDays(today, 1), lookEnd: addDays(today, DAILY_LOOK_DAYS), slotDates }
}

/** Monday (YYYY-MM-DD) of the week holding `iso`; the week-card subject is keyed by it. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(iso, -((weekday + 6) % 7))
}

export interface DatedRow extends VersionRow {
  scheduledOn: string | null
}

export type DailyVersionReason = 'ambiguous_version' | 'superseded' | 'version_already_scheduled' | 'excluded_by_card' | 'version_excluded'

/** Which rows stay in the run, and why the others left. */
export function dailyVersionDecisions(rows: readonly DatedRow[]): {
  keep: Set<string>
  excluded: Map<string, DailyVersionReason>
} {
  const { groups, ambiguous } = groupVersions(rows)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const keep = new Set<string>()
  const excluded = new Map<string, DailyVersionReason>()
  for (const entry of ambiguous) {
    for (const id of entry.ids) excluded.set(id, 'ambiguous_version')
  }
  for (const group of groups) {
    const dated = group.memberIds.filter((id) => byId.get(id)?.scheduledOn != null)
    if (dated.length > 0) {
      for (const id of group.memberIds) {
        if (excluded.has(id)) continue
        if (dated.includes(id)) keep.add(id)
        else excluded.set(id, 'version_already_scheduled')
      }
      continue
    }
    // The newest version was taken off the list: the whole reel stays off; only a version made later can return.
    const latestExcluded = isExcludedByCard(byId.get(group.latestId)?.brief)
    for (const id of group.memberIds) {
      if (excluded.has(id)) continue
      if (latestExcluded) excluded.set(id, id === group.latestId ? 'excluded_by_card' : 'version_excluded')
      else if (id === group.latestId) keep.add(id)
      else excluded.set(id, 'superseded')
    }
  }
  return { keep, excluded }
}

/** Every dated row occupies its day, whatever happened to it in this run. */
export function occupiedDays(
  rows: ReadonlyArray<{ id: string; scheduledOn: string | null }>,
  productKeyOf: (id: string) => string | null,
): ScheduledItem[] {
  const out: ScheduledItem[] = []
  for (const r of rows) {
    if (r.scheduledOn !== null) out.push({ id: r.id, publishOn: r.scheduledOn, productKey: productKeyOf(r.id) })
  }
  return out
}

/** Days of content left in the pool at the daily quota; null when the quota is 0. */
export function poolDepthDays(eligibleUnscheduled: number, reelPerDay: number): number | null {
  if (reelPerDay <= 0) return null
  return Math.floor(eligibleUnscheduled / reelPerDay)
}
