/**
 * One reader for publishing_calendar_config weekly counts.
 * social_week wins. A missing weekly field falls back to the quota object.
 * Industry and stage defaults stay in the weekly-plan recipe, not here.
 */

export type WeekCountSource = 'social_week' | 'quota' | 'none'

export interface ResolvedWeekCount {
  value: number | null
  source: WeekCountSource
}

export interface ResolvedWeekCounts {
  story: ResolvedWeekCount
  post: ResolvedWeekCount
  reel: ResolvedWeekCount
  gaps: string[]
}

export function readSocialWeekOnly(config: unknown): {
  storyPerWeek: number | null
  postPerWeek: number | null
  reelPerWeek: number | null
  gaps: string[]
} {
  const week = record(record(config)?.social_week)
  const gaps: string[] = []
  return {
    storyPerWeek: oneWeek(week?.story_per_week, 'Story', gaps),
    postPerWeek: oneWeek(week?.post_per_week, '图文', gaps),
    reelPerWeek: oneWeek(week?.reel_per_week, 'Reel', gaps),
    gaps,
  }
}

/** social_week when that field is a usable integer, otherwise quota (day × 7, reel as-is). */
export function resolveConfiguredWeekCounts(config: unknown): ResolvedWeekCounts {
  const social = readSocialWeekOnly(config)
  const quota = record(record(config)?.quota)
  return {
    story: prefer(social.storyPerWeek, quotaWeek(quota?.story_per_day, true)),
    post: prefer(social.postPerWeek, quotaWeek(quota?.post_per_day, true)),
    reel: prefer(social.reelPerWeek, quotaWeek(quota?.reel_per_week, false)),
    gaps: social.gaps,
  }
}

function prefer(social: number | null, fromQuota: number | null): ResolvedWeekCount {
  if (social !== null) return { value: social, source: 'social_week' }
  if (fromQuota !== null) return { value: fromQuota, source: 'quota' }
  return { value: null, source: 'none' }
}

function quotaWeek(raw: unknown, fromDay: boolean): number | null {
  const day = oneWeek(raw, '', [])
  if (day === null) return null
  if (!fromDay) return day
  const week = day * 7
  return week <= 999 ? week : null
}

function oneWeek(raw: unknown, label: string, gaps: string[]): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 999) return raw
  if (label) gaps.push(`${label}的每周条数不是可用的整数，这项没有采用。`)
  return null
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}
