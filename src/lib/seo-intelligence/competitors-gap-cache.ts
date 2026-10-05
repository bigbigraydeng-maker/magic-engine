/**
 * Server-side result cache for the SEO Intelligence competitors-gap route.
 *
 * Why: one uncached page view fires several PAID DataForSEO live calls
 * (competitors_domain + up to 5 domain_rank_overview + up to 3
 * domain_intersection + 1 keyword_overview). The HTTP Cache-Control header is
 * only 60 s and is not a billing guard, so every view re-billed.
 *
 * Storage: existing `local_data_cache` table (service-role only, no migration).
 *
 * Invalidation:
 *   - TTL 24 h.
 *   - `fingerprint` of every input that changes the answer (domain, location,
 *     FDE competitor list, brief competitor list/terms). An FDE edit changes
 *     the fingerprint, so it is a miss immediately — no waiting for TTL.
 *   - Manual refresh (?refresh=1) is honoured only after REFRESH_COOLDOWN_MS,
 *     so the param cannot be used to hammer the vendor.
 *
 * Fail-closed rules live in the caller: errors / partial results are never
 * written here (see isCacheableResult).
 */

import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const COMPETITORS_GAP_TTL_MS = 24 * 60 * 60 * 1000
export const REFRESH_COOLDOWN_MS = 10 * 60 * 1000

const CONNECTOR = 'dataforseo_competitors_gap'

export interface CachedGapPayload<T> {
  fingerprint: string
  result: T
}

export function competitorsGapCacheKey(clientId: string, locationCode: number): string {
  return `seo-competitors-gap:v1:${clientId}:${locationCode}`
}

/** Stable hash of every input that changes the answer. */
export function competitorsGapFingerprint(inputs: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 32)
}

/**
 * Only complete results may be cached. getKeywordsGap swallows per-competitor
 * failures (allSettled), so any failed competitor call (gapFailedCount > 0), or a stub
 * competitor whose enrichment failed (both metrics still null), is a degraded
 * answer that must be retried rather than frozen for 24 h.
 */
export function isCacheableResult(args: {
  competitors: Array<{ monthly_traffic: number | null; keyword_count: number | null }>
  gapFailedCount: number
}): boolean {
  const stubUnenriched = args.competitors.some(
    c => c.monthly_traffic === null && c.keyword_count === null,
  )
  if (stubUnenriched) return false
  if (args.gapFailedCount > 0) return false
  return true
}

export async function readCompetitorsGapCache<T>(
  key: string,
  fingerprint: string,
  opts: { forceRefresh: boolean; now?: number },
): Promise<T | null> {
  const now = opts.now ?? Date.now()
  const { data, error } = await supabaseAdmin
    .from('local_data_cache')
    .select('payload, fetched_at, expires_at')
    .eq('cache_key', key)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[competitors-gap-cache] read failed, treating as miss', error.message)
    return null
  }
  if (new Date(data.expires_at as string).getTime() <= now) return null

  const payload = data.payload as CachedGapPayload<T> | null
  if (!payload || payload.fingerprint !== fingerprint) return null

  if (opts.forceRefresh) {
    const lastAttempt = await readRefreshAttempt(key)
    const last = Math.max(new Date(data.fetched_at as string).getTime(), lastAttempt ?? 0)
    if (now - last >= REFRESH_COOLDOWN_MS) return null
  }
  return payload.result
}

function attemptKey(key: string): string {
  return `${key}:refresh-attempt`
}

async function readRefreshAttempt(key: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('local_data_cache')
    .select('fetched_at')
    .eq('cache_key', attemptKey(key))
    .maybeSingle()
  if (error || !data) return null
  const t = new Date(data.fetched_at as string).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Persist the start of a paid forced refresh in its own row, so the cooldown
 * holds even when the refresh fails or yields an uncacheable result (the old
 * valid cache row is left untouched).
 */
export async function markRefreshAttempt(key: string, market: string, now: number = Date.now()): Promise<void> {
  const { error } = await supabaseAdmin.from('local_data_cache').upsert(
    {
      cache_key: attemptKey(key),
      connector: CONNECTOR,
      market,
      payload: {},
      fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + REFRESH_COOLDOWN_MS).toISOString(),
    },
    { onConflict: 'cache_key' },
  )
  if (error) console.warn('[competitors-gap-cache] attempt marker write failed', error.message)
}

export async function writeCompetitorsGapCache<T>(
  key: string,
  fingerprint: string,
  market: string,
  result: T,
  now: number = Date.now(),
): Promise<void> {
  const { error } = await supabaseAdmin.from('local_data_cache').upsert(
    {
      cache_key: key,
      connector: CONNECTOR,
      market,
      payload: { fingerprint, result } satisfies CachedGapPayload<T>,
      fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + COMPETITORS_GAP_TTL_MS).toISOString(),
    },
    { onConflict: 'cache_key' },
  )
  if (error) console.warn('[competitors-gap-cache] write failed (result still returned)', error.message)
}

const inFlight = new Map<string, Promise<unknown>>()

/** Collapse concurrent misses for the same key into one vendor run. */
export function dedupeInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = run().finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}
