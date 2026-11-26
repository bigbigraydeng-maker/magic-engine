/**
 * Which stills one weekly draft should make. One work order holds the whole week.
 */

import { spreadWeekDates, type WeekWindow } from '@/lib/social/image-post-week'
import { readSocialAgentSettings } from '@/lib/social/recipe/tier-defaults'
import { resolveConfiguredWeekCounts } from '@/lib/social/social-week-quota'
import { MAX_WEEK_SLOTS } from '@/lib/social/weekly-plan/types'

import { FACTORY_STILL_COST_ESTIMATE_USD, type StillAspect, type StillRole } from './still-config'

export interface StillSlot {
  date: string
  role: StillRole
  aspect: StillAspect
}

export function planStillSlots(input: { config: unknown; week: WeekWindow; today: string }): StillSlot[] {
  const counts = resolveConfiguredWeekCounts(input.config)
  return [
    ...countSlots(counts.post, 'post', '4:5', input),
    ...countSlots(counts.story, 'story', '9:16', input),
  ]
}

export function roomForAnother(spentUsd: number, capUsd: number): boolean {
  return spentUsd + FACTORY_STILL_COST_ESTIMATE_USD <= capUsd + 1e-9
}

function countSlots(
  count: { source: string; value: number | null },
  role: StillRole,
  aspect: StillAspect,
  input: { config: unknown; week: WeekWindow; today: string },
): StillSlot[] {
  if (count.source !== 'none' && count.value !== null && count.value > 0 && count.value <= MAX_WEEK_SLOTS) {
    return spreadWeekDates(input.week.weekStart, count.value).map((date) => ({ date, role, aspect }))
  }
  if (role === 'post' && count.source === 'none' && readSocialAgentSettings(input.config, null).imagePostPerDay > 0) {
    return [{ date: input.today, role, aspect }]
  }
  return []
}
