/**
 * Write path for `clients.publishing_calendar_config.quota`.
 * Replaces only the quota numbers that were sent. Sibling keys (weekly_pack and anything else) stay.
 * A missing number is null, never 0. 0 is a real cap. No client id is known here.
 */

export const QUOTA_KEYS = ['post_per_day', 'story_per_day', 'post_per_week', 'story_per_week', 'reel_per_week'] as const
export type QuotaKey = (typeof QUOTA_KEYS)[number]
export const QUOTA_COUNT_MAX = 99

export interface StoredQuota {
  post_per_day: number | null
  story_per_day: number | null
  post_per_week: number | null
  story_per_week: number | null
  reel_per_week: number | null
}

export type QuotaPatch = Partial<Record<QuotaKey, number | null>>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function isQuotaKey(key: string): key is QuotaKey {
  return (QUOTA_KEYS as readonly string[]).includes(key)
}

export function emptyStoredQuota(): StoredQuota {
  return { post_per_day: null, story_per_day: null, post_per_week: null, story_per_week: null, reel_per_week: null }
}

/** Numbers currently stored. Invalid values are shown as unset. Other column keys are not returned. */
export function readStoredQuota(config: unknown): { quota: StoredQuota; has_other_config: boolean } {
  const root = asRecord(config)
  const source = root ? asRecord(root.quota) : null
  const quota = emptyStoredQuota()
  if (source) {
    for (const key of QUOTA_KEYS) quota[key] = wholeNumber(source[key])
  }
  const has_other_config = Boolean(root && Object.keys(root).some((key) => key !== 'quota'))
  return { quota, has_other_config }
}

/** Accept only the five quota keys. null clears that key. Anything else is rejected. */
export function parseQuotaPatch(body: unknown): { ok: true; patch: QuotaPatch } | { ok: false; error: string } {
  const record = asRecord(body)
  if (!record) return { ok: false, error: '请求格式不对' }
  const keys = Object.keys(record)
  if (keys.length === 0) return { ok: false, error: '没有要保存的名额' }
  const patch: QuotaPatch = {}
  for (const key of keys) {
    if (!isQuotaKey(key)) return { ok: false, error: '只能改名额数字' }
    const value = record[key]
    if (value === null) {
      patch[key] = null
      continue
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > QUOTA_COUNT_MAX) {
      return { ok: false, error: '名额必须是 0 到 99 的整数，留空表示不配置' }
    }
    patch[key] = value
  }
  return { ok: true, patch }
}

/**
 * Copy the existing column, then apply the patch onto `quota` only.
 * Refuses to replace a value that is not an object, so a bad cell is not overwritten.
 */
export function mergeQuotaConfig(
  current: unknown,
  patch: QuotaPatch,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (current !== null && current !== undefined && asRecord(current) === null) {
    return { ok: false, error: '现有配置不是一份记录，没有覆盖它' }
  }
  const root: Record<string, unknown> = { ...(asRecord(current) ?? {}) }
  const quota: Record<string, unknown> = { ...(asRecord(root.quota) ?? {}) }
  for (const key of QUOTA_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value === null || value === undefined) delete quota[key]
    else quota[key] = value
  }
  if (Object.keys(quota).length === 0) delete root.quota
  else root.quota = quota
  return { ok: true, config: root }
}
