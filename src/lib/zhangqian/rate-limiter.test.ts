/**
 * TDD — Phase X.S3 H3: persistent public-scan rate limiter.
 *
 * Verifies:
 *   - All three dimensions (ip, email, domain) are checked.
 *   - Email is canonicalised before keying (Gmail alias bypass closed).
 *   - Increments survive the in-memory state being lost.
 *   - getDomainCache returns a fresh, non-failed hit only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Supabase mock — single-row store keyed by (table, key tuple). ─────────────

type Row = Record<string, unknown>
const store: Record<string, Row[]> = {}

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {}
  const builder: Record<string, unknown> = {}

  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val
    return builder
  })
  builder.gte = vi.fn((col: string, val: unknown) => {
    filters[`${col}__gte`] = val
    return builder
  })

  function findOne(): Row | undefined {
    return (store[table] ?? []).find(r =>
      Object.entries(filters).every(([k, v]) => {
        if (k.endsWith('__gte')) {
          const col = k.slice(0, -5)
          return (r[col] as string) >= (v as string)
        }
        return r[k] === v
      }),
    )
  }

  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: findOne() ?? null, error: null }))
  builder.single      = vi.fn(() => Promise.resolve({ data: findOne() ?? null, error: null }))

  builder.upsert = vi.fn((payload: Row) => {
    store[table] ??= []
    // Naive upsert: replace any row matching the PK columns we know about.
    const pkCols = Object.keys(payload).filter(k =>
      k === 'bucket_type' || k === 'bucket_key' || k === 'window_start' || k === 'domain',
    )
    const existing = (store[table] ?? []).find(r => pkCols.every(c => r[c] === payload[c]))
    if (existing) Object.assign(existing, payload)
    else store[table].push({ ...payload })
    return Promise.resolve({ data: null, error: null })
  })

  builder.update = vi.fn((patch: Row) => {
    const row = findOne()
    if (row) Object.assign(row, patch)
    return builder
  })

  return builder
}

// RPC mock simulates the atomic INSERT...ON CONFLICT increment.
const rpcMock = vi.fn(async (name: string, params: Record<string, unknown>) => {
  if (name !== 'zhangqian_rate_limit_consume') return { data: null, error: null }
  const { p_bucket_type, p_bucket_key, p_window_start, p_cap } = params as {
    p_bucket_type: string; p_bucket_key: string; p_window_start: string; p_cap: number
  }
  store['zhangqian_scan_rate_limits'] ??= []
  const existing = store['zhangqian_scan_rate_limits'].find(r =>
    r.bucket_type === p_bucket_type && r.bucket_key === p_bucket_key && r.window_start === p_window_start
  )
  let newCount: number
  if (existing) {
    existing.count = (existing.count as number) + 1
    newCount = existing.count as number
  } else {
    newCount = 1
    store['zhangqian_scan_rate_limits'].push({
      bucket_type: p_bucket_type, bucket_key: p_bucket_key, window_start: p_window_start, count: 1,
    })
  }
  return { data: [{ allowed: newCount <= p_cap, post_count: newCount }], error: null }
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeBuilder(t),
    rpc: (name: string, params: Record<string, unknown>) => rpcMock(name, params),
  },
}))

import {
  checkScanRateLimits,
  recordScanAttempt,
  consumeScanRateLimits,
  getDomainCache,
  setDomainCache,
  updateDomainCacheStatus,
} from './rate-limiter'

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  rpcMock.mockClear()
})

describe('consumeScanRateLimits (Phase X.S6 M-4)', () => {
  it('atomically increments all three dimensions on first hit and allows', async () => {
    const r = await consumeScanRateLimits({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    expect(r.allowed).toBe(true)
    expect(r.limits.ip.count).toBe(1)
    expect(r.limits.email.count).toBe(1)
    expect(r.limits.domain.count).toBe(1)
    expect(rpcMock).toHaveBeenCalledTimes(3)
  })

  it('blocks on the dimension that first crosses cap (post-increment)', async () => {
    // Three previous IP hits — fourth crosses cap.
    const ws = new Date(Date.UTC(
      new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
    )).toISOString()
    store['zhangqian_scan_rate_limits'] = [
      { bucket_type: 'ip', bucket_key: '1.2.3.4', window_start: ws, count: 3 },
    ]
    const r = await consumeScanRateLimits({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    expect(r.allowed).toBe(false)
    expect(r.blockedBy).toBe('ip')
    expect(r.limits.ip.count).toBe(4)
  })

  it('still increments even when blocked (prevents probe attacks)', async () => {
    const ws = new Date(Date.UTC(
      new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(),
    )).toISOString()
    store['zhangqian_scan_rate_limits'] = [
      { bucket_type: 'ip', bucket_key: '1.2.3.4', window_start: ws, count: 3 },
    ]
    await consumeScanRateLimits({ ip: '1.2.3.4', domain: 'x.com' })
    const ipRow = store['zhangqian_scan_rate_limits'].find(r => r.bucket_type === 'ip')
    expect(ipRow?.count).toBe(4)
  })

  it('uses canonical email so Gmail aliases share one bucket', async () => {
    await consumeScanRateLimits({ ip: '1.1.1.1', email: 'A.B+x@Gmail.com', domain: 'x.com' })
    await consumeScanRateLimits({ ip: '2.2.2.2', email: 'a.b@googlemail.com', domain: 'y.com' })
    const emailRows = store['zhangqian_scan_rate_limits'].filter(r => r.bucket_type === 'email')
    expect(emailRows).toHaveLength(1)
    expect(emailRows[0]?.bucket_key).toBe('ab@gmail.com')
    expect(emailRows[0]?.count).toBe(2)
  })

  it('falls back to legacy upsert when RPC errors', async () => {
    rpcMock.mockImplementationOnce(async () => ({ data: null, error: { message: 'function not found' } }))
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await consumeScanRateLimits({ ip: '1.1.1.1', domain: 'x.com' })
    // Legacy path: the IP row should still increment to 1 (no prior).
    expect(r.limits.ip.count).toBe(1)
    spy.mockRestore()
  })
})

describe('recordScanAttempt — Phase X.S6 delegates to consume', () => {
  it('still bumps counters but now via RPC', async () => {
    await recordScanAttempt({ ip: '1.1.1.1', email: 'a@b.com', domain: 'x.com' })
    expect(rpcMock).toHaveBeenCalledTimes(3)
  })
})

describe('checkScanRateLimits', () => {
  it('allows the first hit on all three dimensions', async () => {
    const r = await checkScanRateLimits({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    expect(r.allowed).toBe(true)
    expect(r.limits.ip.count).toBe(0)
    expect(r.limits.email.count).toBe(0)
    expect(r.limits.domain.count).toBe(0)
  })

  it('blocks when ip cap is reached', async () => {
    // Pre-populate ip counter at cap (3)
    await setDomainCache('seed.com', 'job-seed')  // ensure the mock has at least one row
    const ws = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    )).toISOString()
    store['zhangqian_scan_rate_limits'] = [
      { bucket_type: 'ip', bucket_key: '1.2.3.4', window_start: ws, count: 3 },
    ]
    const r = await checkScanRateLimits({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    expect(r.allowed).toBe(false)
    expect(r.blockedBy).toBe('ip')
  })

  it('canonicalises email before checking — Gmail aliases share one counter', async () => {
    const ws = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    )).toISOString()
    // Counter at cap keyed by canonical Gmail form (no dots, no +alias).
    store['zhangqian_scan_rate_limits'] = [
      { bucket_type: 'email', bucket_key: 'alice@gmail.com', window_start: ws, count: 3 },
    ]
    // Attempt with an aliased form must hit the same key and be blocked.
    const r = await checkScanRateLimits({
      ip: '9.9.9.9',  // fresh IP — should not save them
      email: 'a.l.i.c.e+promo@googlemail.com',
      domain: 'newsite.com',
    })
    expect(r.allowed).toBe(false)
    expect(r.blockedBy).toBe('email')
  })

  it('normalises www. + uppercase in domain', async () => {
    const ws = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    )).toISOString()
    store['zhangqian_scan_rate_limits'] = [
      { bucket_type: 'domain', bucket_key: 'example.com', window_start: ws, count: 3 },
    ]
    const r = await checkScanRateLimits({ ip: '1.1.1.1', domain: 'WWW.Example.com' })
    expect(r.allowed).toBe(false)
    expect(r.blockedBy).toBe('domain')
  })
})

describe('recordScanAttempt', () => {
  it('increments all three dimensions', async () => {
    await recordScanAttempt({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    const rows = store['zhangqian_scan_rate_limits'] ?? []
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.count === 1)).toBe(true)
  })

  it('uses canonical Gmail key for email increments', async () => {
    await recordScanAttempt({ ip: '1.2.3.4', email: 'A.B+promo@Gmail.com', domain: 'example.com' })
    const emailRow = (store['zhangqian_scan_rate_limits'] ?? []).find(r => r.bucket_type === 'email')
    expect(emailRow?.bucket_key).toBe('ab@gmail.com')
  })

  it('on a second call, the row count goes from 1 to 2 (not duplicates)', async () => {
    await recordScanAttempt({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    await recordScanAttempt({ ip: '1.2.3.4', email: 'a@b.com', domain: 'example.com' })
    const ipRow = (store['zhangqian_scan_rate_limits'] ?? []).find(r => r.bucket_type === 'ip')
    expect(ipRow?.count).toBe(2)
  })
})

describe('domain cache', () => {
  it('returns null when the cache is empty', async () => {
    const hit = await getDomainCache('example.com')
    expect(hit).toBeNull()
  })

  it('returns the job pointer when fresh + non-failed', async () => {
    await setDomainCache('example.com', 'job-1', 'completed')
    const hit = await getDomainCache('example.com')
    expect(hit?.job_id).toBe('job-1')
    expect(hit?.job_status).toBe('completed')
  })

  it('drops a failed job from the cache (caller should re-run)', async () => {
    await setDomainCache('example.com', 'job-bad', 'queued')
    await updateDomainCacheStatus('example.com', 'failed')
    const hit = await getDomainCache('example.com')
    expect(hit).toBeNull()
  })

  it('upserts replace the existing row instead of duplicating it', async () => {
    await setDomainCache('example.com', 'job-1')
    await setDomainCache('example.com', 'job-2', 'completed')
    expect(store['zhangqian_scan_domain_cache']).toHaveLength(1)
    expect(store['zhangqian_scan_domain_cache']?.[0]?.job_id).toBe('job-2')
  })

  it('normalises domain (www + case) when matching', async () => {
    await setDomainCache('Example.com', 'job-1', 'completed')
    const hit = await getDomainCache('www.example.com')
    expect(hit?.job_id).toBe('job-1')
  })
})
