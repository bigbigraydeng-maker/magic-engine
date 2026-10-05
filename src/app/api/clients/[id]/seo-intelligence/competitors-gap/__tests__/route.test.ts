import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Fake DB modelled by table (not by call order) ───────────────────────────
const db = {
  client: { id: 'c1', domain: 'client.com', semrush_db: 'nz', industry: 'x', competitor_domains: null as string[] | null },
  cache: new Map<string, Record<string, unknown>>(),
  failCacheWrite: false,
  tier: 'admin' as 'admin' | 'paid_client',
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'clients') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: db.client, error: null }) }) }) }
      }
      return {
        select: () => ({
          eq: (_c: string, key: string) => ({
            maybeSingle: async () => ({ data: db.cache.get(key) ?? null, error: null }),
          }),
        }),
        upsert: async (row: Record<string, unknown>) => {
          if (db.failCacheWrite) return { error: { message: 'boom' } }
          db.cache.set(row.cache_key as string, row)
          return { error: null }
        },
      }
    },
  },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: async () => ({ ok: true, tier: db.tier }),
}))
vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: async () => null }))
vi.mock('@/lib/competitors/resolver', () => ({
  getClientCompetitors: async (_id: string, auto: string[]) => ({
    domains: db.client.competitor_domains ?? auto.slice(0, 5),
    sources: {},
  }),
}))
vi.mock('@/lib/seo-intelligence/keyword-relevance', () => ({
  buildBusinessKeywordTerms: () => ['x'],
  extractBriefSeedTerms: () => [],
  extractExcludedTopics: () => [],
  isBusinessRelevantKeyword: () => true,
}))

const getSerpCompetitors = vi.fn()
const getKeywordsGap = vi.fn()
const fetchDomainRankOverview = vi.fn()
vi.mock('@/lib/dataforseo/labs', () => ({
  getSerpCompetitors: (...a: unknown[]) => getSerpCompetitors(...a),
  getKeywordsGapWithStatus: (...a: unknown[]) => getKeywordsGap(...a),
  fetchDomainRankOverview: (...a: unknown[]) => fetchDomainRankOverview(...a),
}))

import { GET } from '../route'
import { REFRESH_COOLDOWN_MS, COMPETITORS_GAP_TTL_MS } from '@/lib/seo-intelligence/competitors-gap-cache'

const serp = (domain: string) => ({ domain, avg_position: 3, intersections: 10, monthly_traffic: 100, keyword_count: 50 })
const kw = (keyword: string) => ({ keyword, search_volume: 100, keyword_difficulty: 10, cpc: 1, competition: 0.1, intent: 'commercial', position: null, from_competitor: 'a.com' })

const call = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/clients/c1/seo-intelligence/competitors-gap${qs}`), {
    params: Promise.resolve({ id: 'c1' }),
  })

const paidCalls = () =>
  getSerpCompetitors.mock.calls.length + getKeywordsGap.mock.calls.length + fetchDomainRankOverview.mock.calls.length

beforeEach(() => {
  vi.useRealTimers()
  db.cache.clear()
  db.failCacheWrite = false
  db.client.competitor_domains = null
  db.tier = 'admin'
  getSerpCompetitors.mockReset().mockResolvedValue([serp('a.com'), serp('b.com')])
  getKeywordsGap.mockReset().mockResolvedValue({ keywords: [kw('k1')], failedCount: 0 })
  fetchDomainRankOverview.mockReset().mockResolvedValue({ organic_keywords: 5, organic_traffic: 7 })
})

describe('competitors-gap server cache', () => {
  it('first view calls the vendor, repeat views within TTL do not re-bill', async () => {
    const r1 = await call()
    expect(r1.headers.get('X-Cache')).toBe('MISS')
    const billed = paidCalls()
    expect(billed).toBeGreaterThan(0)

    const r2 = await call()
    const r3 = await call()
    expect(r2.headers.get('X-Cache')).toBe('HIT')
    expect(r3.headers.get('X-Cache')).toBe('HIT')
    expect(paidCalls()).toBe(billed) // zero extra paid calls
    expect(await r2.json()).toEqual(await r1.json())
  })

  it('concurrent first views share one vendor run', async () => {
    await Promise.all([call(), call(), call()])
    expect(getSerpCompetitors).toHaveBeenCalledTimes(1)
    expect(getKeywordsGap).toHaveBeenCalledTimes(1)
  })

  it('FDE competitor edit invalidates immediately (fingerprint), no TTL wait', async () => {
    await call()
    db.client.competitor_domains = ['hand.com']
    const r = await call()
    expect(r.headers.get('X-Cache')).toBe('MISS')
    expect(getSerpCompetitors).toHaveBeenCalledTimes(2)
  })

  it('?refresh=1 is ignored inside the cooldown, honoured after it', async () => {
    const t0 = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    await call()
    const billed = paidCalls()

    vi.setSystemTime(t0 + REFRESH_COOLDOWN_MS - 1000)
    expect((await call('?refresh=1')).headers.get('X-Cache')).toBe('HIT')
    expect(paidCalls()).toBe(billed)

    vi.setSystemTime(t0 + REFRESH_COOLDOWN_MS + 1000)
    expect((await call('?refresh=1')).headers.get('X-Cache')).toBe('MISS')
    expect(paidCalls()).toBeGreaterThan(billed)
  })

  it('refresh=1 is ignored for non-admin client accounts even after the cooldown', async () => {
    const t0 = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    db.tier = 'paid_client'
    await call()
    const billed = paidCalls()

    vi.setSystemTime(t0 + REFRESH_COOLDOWN_MS + 1000)
    expect((await call('?refresh=1')).headers.get('X-Cache')).toBe('HIT')
    expect(paidCalls()).toBe(billed)
  })

  it('expires after 24h', async () => {
    const t0 = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t0)
    await call()
    vi.setSystemTime(t0 + COMPETITORS_GAP_TTL_MS + 1000)
    expect((await call()).headers.get('X-Cache')).toBe('MISS')
  })

  it('fails closed: vendor error returns 502 and caches nothing', async () => {
    getSerpCompetitors.mockRejectedValueOnce(new Error('402'))
    const r = await call()
    expect(r.status).toBe(502)
    expect(db.cache.size).toBe(0)
    // next view retries the vendor (not a poisoned cache)
    expect((await call()).status).toBe(200)
  })

  it('does not cache a partial gap (some competitors failed but keywords returned)', async () => {
    getKeywordsGap.mockResolvedValueOnce({ keywords: [kw('k1')], failedCount: 1 })
    await call()
    expect(db.cache.size).toBe(0)
  })

  it('caches a complete empty gap (all calls succeeded, no gap)', async () => {
    getKeywordsGap.mockResolvedValueOnce({ keywords: [], failedCount: 0 })
    await call()
    expect(db.cache.size).toBe(1)
  })

  it('does not cache a degraded result (gap swallowed to empty for real competitors)', async () => {
    getKeywordsGap.mockResolvedValueOnce({ keywords: [], failedCount: 1 })
    await call()
    expect(db.cache.size).toBe(0)
    expect((await call()).headers.get('X-Cache')).toBe('MISS')
    expect(db.cache.size).toBe(1)
  })

  it('does not cache when a stub competitor failed enrichment', async () => {
    db.client.competitor_domains = ['hand.com']
    fetchDomainRankOverview.mockRejectedValueOnce(new Error('x'))
    await call()
    expect(db.cache.size).toBe(0)
  })

  it('cache write failure still returns the result', async () => {
    db.failCacheWrite = true
    const r = await call()
    expect(r.status).toBe(200)
  })
})
