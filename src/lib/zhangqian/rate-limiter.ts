/**
 * Phase X.S3 — Persistent public-scan rate limiter + 24h domain cache.
 *
 * Replaces the per-process Map<ip,...> in both public-scan/start and
 * discover/register routes. Survives Render restarts and works correctly
 * across multiple instances.
 *
 * This is also, as of the Tools Lab shared-plumbing pass, the one place that calls the
 * `zhangqian_rate_limit_consume` RPC (`consumeQuotaBucket` below) — every atomic per-bucket quota check
 * in the codebase (public-scan/discover-register's multi-dimension limiter here, and every Tools Lab
 * tool's per-visitor/whole-site cap via `consumeQuota`) goes through this one function now. Two
 * different failure policies sit on top of the same call: `consumeQuota` fails closed (any RPC error
 * refuses the request — used by site-check, a fully public tool where a silent failure would mean
 * unlimited free paid-AI calls); `consumeScanRateLimits` fails open with a legacy upsert fallback (used
 * by public-scan/discover-register, unchanged from before this refactor — see its own docstring).
 *
 * Four services exported:
 *
 *   consumeQuota(bucketType, bucketKey, windowStart, cap) → boolean, throws QuotaUnavailable on any failure
 *   checkScanRateLimits({ ip, email?, domain }) → { allowed, blockedBy?, limits }
 *   consumeScanRateLimits({ ip, email?, domain }) → same shape, atomically incrementing
 *   getDomainCache(domain) / setDomainCache(domain, job_id)
 *
 * Defaults: 3 scans per dimension per UTC day. The function increments the
 * counter for EVERY dimension that is provided — so a single hit costs one
 * row per (ip, email, domain). A blocked attempt does NOT increment further
 * (callers should still feel free to retry next day).
 *
 * Cache: a domain hit returns the previously-recorded job_id when the cached
 * job is < 24h old and not in 'failed' state. Callers should reuse the cached
 * job_id and skip the agent run entirely.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { canonicalEmail } from '@/lib/auth/email'

export interface AtomicConsumeResult {
  allowed: boolean
  postCount: number
}

export interface AtomicConsumeFailure {
  error: string
  /**
   * 'rpc_error': the call itself failed (network/PostgREST/permission — the store is genuinely down).
   * 'malformed_response': the call succeeded but returned a shape with no usable decision (a store-side
   * contract bug, not an availability problem). Callers may treat these differently — see
   * `consumeScanRateLimits` below, which blocks on 'malformed_response' rather than falling back to its
   * legacy fail-open path, matching this function's behavior before it was centralised here.
   */
  kind: 'rpc_error' | 'malformed_response'
}

/**
 * The bare RPC call: one atomic check+increment against `zhangqian_rate_limit_consume` for a single
 * bucket. No failure policy of its own — callers decide fail-open vs fail-closed on error (see
 * `consumeQuota`, fail-closed on either failure kind, and `consumeScanRateLimits` below, fail-open with
 * a legacy fallback only for 'rpc_error').
 */
export async function consumeQuotaBucket(
  bucketType: string,
  bucketKey: string,
  windowStart: string,
  cap: number,
): Promise<AtomicConsumeResult | AtomicConsumeFailure> {
  const { data, error } = await supabaseAdmin.rpc('zhangqian_rate_limit_consume', {
    p_bucket_type: bucketType,
    p_bucket_key: bucketKey,
    p_window_start: windowStart,
    p_cap: cap,
  })
  if (error) return { error: error.message, kind: 'rpc_error' }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; post_count?: unknown } | null
  if (!row || typeof row.allowed !== 'boolean') return { error: 'quota store returned no decision', kind: 'malformed_response' }
  return { allowed: row.allowed, postCount: typeof row.post_count === 'number' ? row.post_count : 0 }
}

export class QuotaUnavailable extends Error {}

/**
 * Fail-closed atomic consume: returns true when allowed. Any RPC error, thrown exception, or missing
 * decision throws `QuotaUnavailable` — callers refuse the request rather than let it through. This is
 * the policy every Tools Lab tool wants (a public, unauthenticated, paid-AI-calling endpoint must never
 * fail open just because the quota store hiccupped).
 */
export async function consumeQuota(
  bucketType: string,
  bucketKey: string,
  windowStart: string,
  cap: number,
): Promise<boolean> {
  let result: AtomicConsumeResult | AtomicConsumeFailure
  try {
    result = await consumeQuotaBucket(bucketType, bucketKey, windowStart, cap)
  } catch (err) {
    throw new QuotaUnavailable(err instanceof Error ? err.message : String(err))
  }
  if ('error' in result) throw new QuotaUnavailable(result.error)
  return result.allowed
}

/**
 * UTC day/month window starts for `consumeQuota` bucket keys. Moved here (not left in site-check's own
 * guards.ts, which they were previously defined in) because this is the neutral, tool-agnostic home for
 * atomic-quota plumbing — a non-site-check caller (e.g. ads-check's spend cap) importing a date helper
 * from a file whose own header says "for the free website check" would be a new, backwards coupling.
 */
export function dayStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

export function monthStartUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

const DEFAULT_DAILY_CAP = 3
/** 24h — both the rate-limit window length and the domain cache TTL. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export type BucketType = 'ip' | 'email' | 'domain'

export interface ScanRateLimitInput {
  ip:      string
  email?:  string | null
  domain:  string
  /** Override the per-bucket-type cap (default 3). For internal use / tests. */
  cap?:    number
}

export interface ScanRateLimitResult {
  allowed:   boolean
  blockedBy?: BucketType
  /** Per-dimension current count and cap (after the increment, if it happened). */
  limits: Record<BucketType, { count: number; cap: number; key: string }>
}

/** Returns the start (UTC midnight) of the window containing `now`. */
function windowStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/** Lowercase + strip the ::ffff:0.0.0.0 IPv6-mapped-IPv4 prefix. */
function normalizeIp(raw: string): string {
  const v = raw.trim().toLowerCase()
  if (v.startsWith('::ffff:')) return v.slice('::ffff:'.length)
  return v
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, '')
}

/**
 * Pre-flight check: looks at the current counter for each bucket and returns
 * { allowed: false, blockedBy } if any one of them is already at the cap.
 * No DB writes happen here — the increment is a second call after the
 * scan actually starts.
 */
export async function checkScanRateLimits(
  input: ScanRateLimitInput,
): Promise<ScanRateLimitResult> {
  const cap = input.cap ?? DEFAULT_DAILY_CAP
  const ws  = windowStart()

  const keys: Array<[BucketType, string]> = [['ip', normalizeIp(input.ip)]]
  const emailCanon = canonicalEmail(input.email ?? '')
  if (emailCanon)         keys.push(['email',  emailCanon])
  if (input.domain)       keys.push(['domain', normalizeDomain(input.domain)])

  const counts: Partial<Record<BucketType, { count: number; cap: number; key: string }>> = {}
  let blockedBy: BucketType | undefined

  for (const [type, key] of keys) {
    const { data } = await supabaseAdmin
      .from('zhangqian_scan_rate_limits')
      .select('count')
      .eq('bucket_type', type)
      .eq('bucket_key', key)
      .eq('window_start', ws)
      .maybeSingle<{ count: number }>()
    const current = data?.count ?? 0
    counts[type] = { count: current, cap, key }
    if (current >= cap && !blockedBy) blockedBy = type
  }

  // Fill in any dimension that wasn't queried so callers always get a value.
  if (!counts.ip)     counts.ip     = { count: 0, cap, key: normalizeIp(input.ip) }
  if (!counts.email)  counts.email  = { count: 0, cap, key: emailCanon }
  if (!counts.domain) counts.domain = { count: 0, cap, key: normalizeDomain(input.domain) }

  return {
    allowed: !blockedBy,
    blockedBy,
    limits: counts as Record<BucketType, { count: number; cap: number; key: string }>,
  }
}

/**
 * Increment ALL applicable dimensions for this scan attempt. Should be called
 * after `checkScanRateLimits` returns `allowed: true` and the job row has
 * been created.
 *
 * Phase X.S6 M-4: each dimension is now consumed via the atomic
 * zhangqian_rate_limit_consume RPC; concurrent callers serialise on the
 * unique (bucket_type, bucket_key, window_start) constraint so the per-day
 * cap can no longer be exceeded by parallel hits sharing the same fingerprint.
 *
 * For routes that want the strongest guarantee, prefer `consumeScanRateLimits`
 * below — it merges check + record into one round-trip per dimension and is
 * race-free by construction.
 */
export async function recordScanAttempt(input: ScanRateLimitInput): Promise<void> {
  await consumeScanRateLimits(input)
}

/**
 * Atomically increment + check every applicable dimension for this scan.
 * Returns a verdict per dimension; the caller can short-circuit further work
 * (e.g. skip creating the job + running the agent) when any dimension is over
 * cap.
 *
 * Race property: each (bucket_type, bucket_key, window_start) tuple has a
 * unique constraint, so two concurrent INSERT ... ON CONFLICT calls
 * targeting the same tuple serialise; whichever runs second sees the
 * post-increment value and may exceed the cap by 1 on its return — but that
 * second call's `allowed` will still be `false`, so the caller does not
 * proceed.
 */
export async function consumeScanRateLimits(
  input: ScanRateLimitInput,
): Promise<ScanRateLimitResult> {
  const cap = input.cap ?? DEFAULT_DAILY_CAP
  const ws  = windowStart()

  const keys: Array<[BucketType, string]> = [['ip', normalizeIp(input.ip)]]
  const emailCanon = canonicalEmail(input.email ?? '')
  if (emailCanon)         keys.push(['email',  emailCanon])
  if (input.domain)       keys.push(['domain', normalizeDomain(input.domain)])

  const counts: Partial<Record<BucketType, { count: number; cap: number; key: string }>> = {}
  let blockedBy: BucketType | undefined

  for (const [type, key] of keys) {
    const result = await consumeQuotaBucket(type, key, ws, cap)
    if ('error' in result && result.kind === 'malformed_response') {
      // The RPC itself is reachable and answered — it just didn't return a usable decision (a store-side
      // contract bug, not an availability problem). Block this dimension rather than falling through to
      // the "RPC unreachable" fallback below — matches this function's behavior before the atomic call
      // was centralised into `consumeQuotaBucket` (魏征 review, PR #2163).
      console.warn('[rate-limiter] atomic RPC returned no usable decision, blocking this dimension', { type, key, error: result.error })
      counts[type] = { count: 0, cap, key }
      if (!blockedBy) blockedBy = type
      continue
    }
    if ('error' in result) {
      // Defensive: fall back to legacy non-atomic upsert + treat as allowed
      // (loud warning so we notice if the RPC starts failing in prod).
      console.warn('[rate-limiter] atomic RPC failed, falling back', { type, key, error: result.error })
      const { data: row } = await supabaseAdmin
        .from('zhangqian_scan_rate_limits')
        .select('count')
        .eq('bucket_type', type)
        .eq('bucket_key', key)
        .eq('window_start', ws)
        .maybeSingle<{ count: number }>()
      const newCount = (row?.count ?? 0) + 1
      await supabaseAdmin
        .from('zhangqian_scan_rate_limits')
        .upsert(
          { bucket_type: type, bucket_key: key, window_start: ws, count: newCount, updated_at: new Date().toISOString() },
          { onConflict: 'bucket_type,bucket_key,window_start' },
        )
      counts[type] = { count: newCount, cap, key }
      if (newCount > cap && !blockedBy) blockedBy = type
      continue
    }

    counts[type] = { count: result.postCount, cap, key }
    if (!result.allowed && !blockedBy) blockedBy = type
  }

  if (!counts.ip)     counts.ip     = { count: 0, cap, key: normalizeIp(input.ip) }
  if (!counts.email)  counts.email  = { count: 0, cap, key: emailCanon }
  if (!counts.domain) counts.domain = { count: 0, cap, key: normalizeDomain(input.domain) }

  return {
    allowed: !blockedBy,
    blockedBy,
    limits: counts as Record<BucketType, { count: number; cap: number; key: string }>,
  }
}

// ─── 24h domain cache ─────────────────────────────────────────────────────────

export interface DomainCacheHit {
  job_id:     string
  cached_at:  string
  job_status: string
}

/**
 * Returns the cached job for this domain if it was started within the last 24h
 * and is NOT in `failed` status. Returns null when there is no usable cache
 * entry — the caller should run a fresh scan.
 */
export async function getDomainCache(domain: string): Promise<DomainCacheHit | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString()
  const { data } = await supabaseAdmin
    .from('zhangqian_scan_domain_cache')
    .select('job_id, cached_at, job_status')
    .eq('domain', normalizeDomain(domain))
    .gte('cached_at', cutoff)
    .maybeSingle<DomainCacheHit>()
  if (!data) return null
  if (data.job_status === 'failed') return null
  return data
}

/** Upserts the cache pointer for this domain. Called right after a new job is created. */
export async function setDomainCache(domain: string, jobId: string, jobStatus: string = 'queued'): Promise<void> {
  await supabaseAdmin
    .from('zhangqian_scan_domain_cache')
    .upsert(
      { domain: normalizeDomain(domain), job_id: jobId, cached_at: new Date().toISOString(), job_status: jobStatus },
      { onConflict: 'domain' },
    )
}

/** Updates the cached job's status — call from the worker when the scan finishes. */
export async function updateDomainCacheStatus(domain: string, jobStatus: string): Promise<void> {
  await supabaseAdmin
    .from('zhangqian_scan_domain_cache')
    .update({ job_status: jobStatus })
    .eq('domain', normalizeDomain(domain))
}

