/**
 * P21.10 — Smart Scheduling: Conflict-Free Slot Finder
 *
 * Pure function — no side effects, no I/O. Takes pending posts + existing
 * 14-day schedule, returns AI-suggested scheduled_at per post/platform.
 *
 * Rules:
 *  - Max 1 post per platform per day (TikTok: 2 allowed)
 *  - Platform peak times in AEST (UTC+10)
 *  - Start from baseDate, skip days that are already full
 */

export type SchedulingPlatform = 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'google'

// AEST peak times [hour, minute] (UTC+10 = UTC-based offset applied at runtime)
const PLATFORM_SLOTS: Record<SchedulingPlatform, [number, number][]> = {
  facebook:  [[8, 30]],
  instagram: [[18, 0]],
  linkedin:  [[7, 30]],
  tiktok:    [[12, 0], [19, 0]],
  google:    [[12, 0]],
}

const MAX_POSTS_PER_DAY: Record<SchedulingPlatform, number> = {
  facebook:  1,
  instagram: 1,
  linkedin:  1,
  tiktok:    2,
  google:    1,
}

// AEST = UTC+10, expressed as minutes ahead of UTC
const AEST_OFFSET_MIN = 10 * 60

export interface PendingPost {
  id: string
  platform: SchedulingPlatform
}

export interface ExistingScheduleEntry {
  platform: SchedulingPlatform
  scheduled_at: string  // ISO 8601
}

export interface SlotSuggestion {
  post_id: string
  platform: SchedulingPlatform
  suggested_at: string  // ISO 8601 UTC
  slot_index: number    // 0-based slot within platform day
}

export interface SlotFinderInput {
  posts: PendingPost[]
  existingSchedule: ExistingScheduleEntry[]
  baseDate: Date     // start looking from this day (inclusive)
  windowDays?: number  // how many days to search (default 14)
}

export interface SlotFinderResult {
  suggestions: SlotSuggestion[]
  unscheduled: string[]  // post IDs that couldn't be placed in window
}

type DayKey = string  // 'YYYY-MM-DD' in AEST local date

function toAestDayKey(date: Date): DayKey {
  const aestMs = date.getTime() + AEST_OFFSET_MIN * 60 * 1000
  const d = new Date(aestMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function makeUtcFromAest(dayKey: DayKey, hour: number, minute: number): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  // Construct as AEST local then subtract offset to get UTC
  const aestMs = Date.UTC(year, month - 1, day, hour, minute, 0) - AEST_OFFSET_MIN * 60 * 1000
  return new Date(aestMs)
}

type PlatformDayUsage = Map<string, number>  // `${platform}::${dayKey}` → slot index used

function buildUsageMap(existing: ExistingScheduleEntry[]): PlatformDayUsage {
  const map: PlatformDayUsage = new Map()
  for (const entry of existing) {
    const key = `${entry.platform}::${toAestDayKey(new Date(entry.scheduled_at))}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

export function findSlots(input: SlotFinderInput): SlotFinderResult {
  const { posts, existingSchedule, baseDate } = input
  const windowDays = input.windowDays ?? 14

  const usage = buildUsageMap(existingSchedule)
  const suggestions: SlotSuggestion[] = []
  const unscheduled: string[] = []

  // Session-local usage (posts being scheduled in this batch)
  const sessionUsage: PlatformDayUsage = new Map()

  for (const post of posts) {
    const { id, platform } = post
    const slots = PLATFORM_SLOTS[platform]
    const maxPerDay = MAX_POSTS_PER_DAY[platform]

    let placed = false

    for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
      const candidateMs = baseDate.getTime() + dayOffset * 24 * 60 * 60 * 1000
      const candidateDay = toAestDayKey(new Date(candidateMs))
      const usageKey = `${platform}::${candidateDay}`

      const existingCount = (usage.get(usageKey) ?? 0) + (sessionUsage.get(usageKey) ?? 0)

      if (existingCount >= maxPerDay) continue

      const slotIndex = existingCount  // use next available slot in the day
      const [hour, minute] = slots[slotIndex % slots.length]

      const suggestedAt = makeUtcFromAest(candidateDay, hour, minute)

      suggestions.push({
        post_id:      id,
        platform,
        suggested_at: suggestedAt.toISOString(),
        slot_index:   slotIndex,
      })

      sessionUsage.set(usageKey, (sessionUsage.get(usageKey) ?? 0) + 1)
      placed = true
      break
    }

    if (!placed) {
      unscheduled.push(id)
    }
  }

  return { suggestions, unscheduled }
}
