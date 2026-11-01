/**
 * Client publishing quota inside `clients.publishing_calendar_config.quota`.
 *
 * Legacy keys are always read: post_per_day, story_per_day, reel_per_week.
 * Weekly keys are read only when SOCIAL_WEEKLY_QUOTA_ENABLED is exactly "true":
 * post_per_week, story_per_week. reel_per_week is already a weekly cap and stays on.
 * A present weekly whole number wins for that kind; the daily number is not also a cap.
 * A missing key is null, never 0. No client name or client number is hard-coded here.
 *
 * Readers that plan or check a cap (daily plan, week overview, to-do lines) call `kindCap`.
 * `weekly_pack` on the same column is the weekday cadence, not a count.
 */

export const WEEKLY_QUOTA_ENV = 'SOCIAL_WEEKLY_QUOTA_ENABLED'

export type QuotaPeriod = 'day' | 'week'
export type QuotaKind = 'post' | 'story' | 'reel'

/** Resolved cap. The inactive period's count is null, so a reader cannot apply both. */
export interface PublishingQuota {
  post_per_day: number | null
  story_per_day: number | null
  reel_per_week: number | null
  post_per_week: number | null
  story_per_week: number | null
  post_period: QuotaPeriod | null
  story_period: QuotaPeriod | null
  reel_period: 'week' | null
}

export interface QuotaCap {
  period: QuotaPeriod
  count: number
}

type QuotaEnv = NodeJS.ProcessEnv | Record<string, string | undefined>

export function weeklyQuotaEnabled(env: QuotaEnv): boolean {
  return env.SOCIAL_WEEKLY_QUOTA_ENABLED === 'true'
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** The `quota` object only. Sibling keys such as `weekly_pack` are left untouched. */
export function quotaRecordFromConfig(config: unknown): Record<string, unknown> | null {
  const root = asRecord(config)
  return root ? asRecord(root.quota) : null
}

interface GatedKind {
  perDay: number | null
  perWeek: number | null
  period: QuotaPeriod | null
}

/** Weekly wins only when the switch is on and the weekly value is a whole number. */
function gatedKind(dailyRaw: unknown, weeklyRaw: unknown, weeklyEnabled: boolean): GatedKind {
  const perDay = wholeNumber(dailyRaw)
  const perWeek = wholeNumber(weeklyRaw)
  if (weeklyEnabled && perWeek !== null) return { perDay: null, perWeek, period: 'week' }
  if (perDay !== null) return { perDay, perWeek: null, period: 'day' }
  return { perDay: null, perWeek: null, period: null }
}

export function parsePublishingQuota(quota: unknown, weeklyEnabled: boolean): PublishingQuota | null {
  const record = asRecord(quota)
  if (!record) return null
  const post = gatedKind(record.post_per_day, record.post_per_week, weeklyEnabled)
  const story = gatedKind(record.story_per_day, record.story_per_week, weeklyEnabled)
  const reel = wholeNumber(record.reel_per_week)
  if (post.period === null && story.period === null && reel === null) return null
  return {
    post_per_day: post.perDay,
    story_per_day: story.perDay,
    reel_per_week: reel,
    post_per_week: post.perWeek,
    story_per_week: story.perWeek,
    post_period: post.period,
    story_period: story.period,
    reel_period: reel === null ? null : 'week',
  }
}

/**
 * The cap a planner or a health line must use.
 * When `period` is missing (an older payload), a daily number wins over a weekly one.
 * The server sets `period: 'week'` only after the switch has accepted the weekly key.
 */
export function kindCap(quota: Partial<PublishingQuota> | null | undefined, kind: QuotaKind): QuotaCap | null {
  if (!quota) return null
  if (kind === 'reel') {
    return typeof quota.reel_per_week === 'number' ? { period: 'week', count: quota.reel_per_week } : null
  }
  const period = kind === 'story' ? quota.story_period : quota.post_period
  const weekly = kind === 'story' ? quota.story_per_week : quota.post_per_week
  const daily = kind === 'story' ? quota.story_per_day : quota.post_per_day
  if (period === 'week' && typeof weekly === 'number') return { period: 'week', count: weekly }
  if (typeof daily === 'number') return { period: 'day', count: daily }
  if (typeof weekly === 'number') return { period: 'week', count: weekly }
  return null
}
