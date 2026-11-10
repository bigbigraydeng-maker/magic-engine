/**
 * Story invite-DM window. Pure: no clock, no database, no Meta.
 *
 * A count is a number only after a successful messenger sync has started at
 * or after the window end. Anything else is not_readable, never zero.
 * Threads whose entry_referral object has an ad_id key are left out.
 */
export const STORY_DM_LOGIC_VERSION = 'wp1.v1'
export const STORY_DM_DEFAULT_HOURS = 12
export const STORY_DM_INVITE_ROLE = 'invite'
export const STORY_DM_SYNC_LAG_MINUTES = 70
export const STORY_DM_MAX_HOURS = 168
export const STORY_DM_THREAD_CAP = 500
export const STORY_DM_READ_POINT_PREFIX = 'dm_'
export const MESSENGER_SYNC_JOB = 'messenger-sync-hourly'

export interface StoryDmThread {
  createdAt: string
  entryReferral: unknown
}

export interface StoryDmCountInput {
  sentAt: string
  hours: number
  lastSuccessfulSyncStartedAt: string | null
}

export type StoryDmCount =
  | { verdict: 'counted'; observedValue: number; reason: null }
  | { verdict: 'not_readable'; observedValue: null; reason: string }

export type StoryDmWindowConfig =
  | { ok: true; hours: number; inviteRole: string; fromDefault: boolean }
  | { ok: false; reason: 'window_not_configured' }

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

function unread(reason: string): StoryDmCount {
  return { verdict: 'not_readable', observedValue: null, reason }
}

export function isStoryDmWindowHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= STORY_DM_MAX_HOURS
}

function isInviteRole(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z_]{1,40}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ISO end instant, or null when the anchor or the hour count is unusable. */
export function storyDmWindowEnd(sentAt: string, hours: number): string | null {
  if (!isStoryDmWindowHours(hours)) return null
  const start = Date.parse(sentAt)
  if (!Number.isFinite(start)) return null
  return new Date(start + hours * HOUR_MS).toISOString()
}

/** When the counter may run: window end plus the sync lag. */
export function storyDmReadAt(windowEnd: string, lagMinutes = STORY_DM_SYNC_LAG_MINUTES): string | null {
  const end = Date.parse(windowEnd)
  if (!Number.isFinite(end) || !Number.isInteger(lagMinutes) || lagMinutes < 0) return null
  return new Date(end + lagMinutes * MINUTE_MS).toISOString()
}

export function storyDmReadPoint(hours: number): string {
  return `${STORY_DM_READ_POINT_PREFIX}${hours}h`
}

/** Top-level `ad_id` key only. A missing key is kept; a present key is dropped. */
export function threadHasAdId(referral: unknown): boolean {
  if (!isRecord(referral)) return false
  return Object.prototype.hasOwnProperty.call(referral, 'ad_id')
}

/**
 * Null threads means the read failed. Do not turn that into zero.
 * A sync that started before the window end has not caught the last hour.
 */
export function countNewThreads(
  threads: readonly StoryDmThread[] | null,
  input: StoryDmCountInput,
): StoryDmCount {
  const endMs = Date.parse(storyDmWindowEnd(input.sentAt, input.hours) ?? '')
  if (!Number.isFinite(endMs)) return unread('window_invalid')
  const syncMs = input.lastSuccessfulSyncStartedAt ? Date.parse(input.lastSuccessfulSyncStartedAt) : Number.NaN
  if (!Number.isFinite(syncMs) || syncMs < endMs) return unread('sync_not_caught_up')
  if (threads === null) return unread('threads_unreadable')
  return countInsideWindow(threads, Date.parse(input.sentAt), endMs)
}

function countInsideWindow(threads: readonly StoryDmThread[], startMs: number, endMs: number): StoryDmCount {
  let observed = 0
  for (const thread of threads) {
    if (threadHasAdId(thread.entryReferral)) continue
    const at = Date.parse(thread.createdAt)
    if (!Number.isFinite(at)) return unread('thread_time_unreadable')
    if (at >= startMs && at < endMs) observed += 1
  }
  return { verdict: 'counted', observedValue: observed, reason: null }
}

/** Error becomes null (unreadable). An empty list is a real zero only after the caller counts it. */
export function rowsFromThreadQuery(
  error: { message?: string } | null,
  rows: readonly StoryDmThread[],
): StoryDmThread[] | null {
  if (error) return null
  return [...rows]
}

/** Role used to recognise the invite slot, even when the hour count is unusable. */
export function storyDmInviteRole(calendar: unknown): string {
  const config = readStoryDmWindowConfig(calendar)
  if (config.ok) return config.inviteRole
  if (isRecord(calendar) && isRecord(calendar.story_dm_window) && isInviteRole(calendar.story_dm_window.invite_role)) {
    return calendar.story_dm_window.invite_role
  }
  return STORY_DM_INVITE_ROLE
}

/**
 * Missing `story_dm_window` uses the platform default (invite role, 12 hours).
 * A present but unusable block is not_configured — we do not guess a number.
 */
export function readStoryDmWindowConfig(calendar: unknown): StoryDmWindowConfig {
  if (!isRecord(calendar) || calendar.story_dm_window == null) {
    return { ok: true, hours: STORY_DM_DEFAULT_HOURS, inviteRole: STORY_DM_INVITE_ROLE, fromDefault: true }
  }
  if (!isRecord(calendar.story_dm_window)) return { ok: false, reason: 'window_not_configured' }
  const raw = calendar.story_dm_window
  const hours = raw.hours === undefined ? STORY_DM_DEFAULT_HOURS : raw.hours
  const inviteRole = raw.invite_role === undefined ? STORY_DM_INVITE_ROLE : raw.invite_role
  if (!isStoryDmWindowHours(hours) || !isInviteRole(inviteRole)) {
    return { ok: false, reason: 'window_not_configured' }
  }
  return { ok: true, hours, inviteRole, fromDefault: false }
}

const UNREADABLE_ZH: Record<string, string> = {
  sync_not_caught_up: '私信同步还没追上这条的窗口结束，没有记成 0',
  threads_unreadable: '私信列表读失败，没有记成 0',
  threads_truncated: '窗口里的私信太多，没有估一个偏低的数',
  thread_time_unreadable: '有一条私信没有时间，没有记成 0',
  instagram_dm_not_stored: '会话表没有 Instagram 渠道，没有记成 0',
  window_invalid: '窗口时间无效，没有记成 0',
  retries_exhausted: '读了几次仍失败，没有记成 0',
}

/** One line for the read-back panel. Unknown reasons stay generic so raw ids never surface. */
export function formatStoryDmLabel(input: {
  verdict: string
  observedValue: number | null
  reason: string | null
  windowHours: number | null
}): string | null {
  if (input.verdict === 'counted' && typeof input.observedValue === 'number' && Number.isFinite(input.observedValue)) {
    const hours = input.windowHours ?? STORY_DM_DEFAULT_HOURS
    return `发后 ${hours} 小时新开私信 ${input.observedValue} 条（已去掉带来广告编号的会话）`
  }
  if (input.verdict !== 'not_readable') return null
  const why = UNREADABLE_ZH[input.reason ?? ''] ?? '没有读到，没有记成 0'
  return `私信数读不到：${why}`
}
