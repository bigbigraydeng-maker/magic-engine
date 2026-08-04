import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mocks — hoisted so they're available at vi.mock factory time
// ---------------------------------------------------------------------------

const { mockMetaScrape, mockGoogleScrape } = vi.hoisted(() => ({
  mockMetaScrape: vi.fn(),
  mockGoogleScrape: vi.fn(),
}))

vi.mock('@/lib/apify/ad-library', () => ({
  scrapeCompetitorMetaAds: mockMetaScrape,
}))

vi.mock('@/lib/dataforseo/serp', () => ({
  getGoogleAdsPresence: mockGoogleScrape,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { AdsCollector } from '../ads-collector'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-ads-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

const HEALTHY_META = {
  domain: 'Example Brand',
  activeAdsCount: 8,
  adTypes: ['image', 'video', 'carousel'],
  estimatedSpend: 'medium' as const,
  topAdCopy: ['Buy now', 'Limited offer', 'Free shipping'],
}

const HEALTHY_GOOGLE = {
  advertiser: 'Example Brand',
  activeAdsCount: 12,
  adFormats: ['text', 'image', 'video'],
  regions: ['NZ'],
  topAdPreviews: ['Top tours NZ', 'Best deals', '5-star reviews'],
}

/**
 * 🔴 **按表建模**，不要对所有表返回同一条链。
 *    这个假件原来不分表，于是「查自家真实投放数据」那一步会撞上
 *    一条没有 `.gte` 的链、抛异常、被外层吞成 score:null ——
 *    症状出现在完全不相干的断言上。（同一个教训今天已经踩过两次。）
 *
 * `ownAdRows` = `ad_daily_insights` 里这个客户近 14 天的真实投放行。
 * 默认空数组 = 我们没有这个客户的自家数据（老行为不变）。
 */
function makeSupabase(
  overrides: {
    name?: string | null
    semrush_db?: string | null
    ownAdRows?: Array<{ insight_date: string; spend: number; impressions: number }>
  } = {},
): SupabaseClient {
  const { name = 'Example Brand', semrush_db = 'nz', ownAdRows = [] } = overrides
  return {
    from: vi.fn((table: string) => {
      if (table === 'ad_daily_insights') {
        const chain: Record<string, unknown> = {}
        const self = () => chain
        chain.select = self
        chain.eq = self
        chain.gte = () => Promise.resolve({ data: ownAdRows, error: null })
        return chain
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { name, semrush_db }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`测试假件没准备 ${table} 表的数据`)
    }),
  } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockMetaScrape.mockResolvedValue({ ...HEALTHY_META })
  mockGoogleScrape.mockResolvedValue({ ...HEALTHY_GOOGLE })
})

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — basic shape', () => {
  it('returns { score, findings, meta_ads, google_ads } with score 0–100', async () => {
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(Array.isArray(result.findings)).toBe(true)
    expect(result.meta_ads).not.toBeNull()
    expect(result.google_ads).not.toBeNull()
  })

  it('uses client.name as search term, not domain', async () => {
    await new AdsCollector(makeSupabase({ name: 'Big Brand Co' })).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockMetaScrape).toHaveBeenCalledWith('Big Brand Co', expect.any(String))
    expect(mockGoogleScrape).toHaveBeenCalledWith('Big Brand Co', expect.any(String), expect.any(String))
  })

  it('passes NZ market when client semrush_db = nz', async () => {
    await new AdsCollector(makeSupabase({ semrush_db: 'nz' })).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockMetaScrape).toHaveBeenCalledWith(expect.any(String), 'NZ')
    expect(mockGoogleScrape).toHaveBeenCalledWith(expect.any(String), 'NZ', expect.any(String))
  })
})

// ---------------------------------------------------------------------------
// Missing domain
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — missing domain', () => {
  it('returns score=null + budget_inefficiency finding when domain is empty', async () => {
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, '', KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].finding_type).toBe('budget_inefficiency')
    expect(mockMetaScrape).not.toHaveBeenCalled()
    expect(mockGoogleScrape).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// No active ads on either platform
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — no active ads', () => {
  it('emits high-severity budget_inefficiency and score=0 when both platforms return 0 ads', async () => {
    mockMetaScrape.mockResolvedValue({ ...HEALTHY_META, activeAdsCount: 0, adTypes: [] })
    mockGoogleScrape.mockResolvedValue({ ...HEALTHY_GOOGLE, activeAdsCount: 0, adFormats: [] })
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
    const f = result.findings.find(x => x.finding_type === 'budget_inefficiency')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('🔴 公开渠道查不到、但自家账户有真实花费 → 不许报「没在投」', async () => {
    // 2026-08-05 真实事故：CTS 当天在投两个系列（NZ$114.19 + NZ$96.88，上万曝光），
    // 而表单广告没有网站链接、公开广告库按域名天生搜不到 ——
    // 结果体检报「No active paid advertising detected」并标 high。
    // 这条假发现会喂进下一轮方案，让 AI 给正花着钱的客户开「该开始投广告」。
    mockMetaScrape.mockResolvedValue({ ...HEALTHY_META, activeAdsCount: 0, adTypes: [] })
    mockGoogleScrape.mockResolvedValue({ ...HEALTHY_GOOGLE, activeAdsCount: 0, adFormats: [] })
    const result = await new AdsCollector(
      makeSupabase({
        ownAdRows: [
          { insight_date: '2026-08-03', spend: 114.19, impressions: 3871 },
          { insight_date: '2026-08-02', spend: 96.88, impressions: 6183 },
        ],
      }),
    ).collect(CLIENT_ID, DOMAIN, KEYWORDS)

    expect(result.score).toBe(60)
    const f = result.findings.find(x => x.finding_type === 'budget_inefficiency')
    expect(f?.severity).toBe('low')
    expect(f?.title).toContain('公开渠道查不到')
    expect(f?.description).toContain('211.07')
  })

  it('🔴 有曝光但零花费 → 仍按「没在投」处理，别把自然触达当投放', async () => {
    mockMetaScrape.mockResolvedValue({ ...HEALTHY_META, activeAdsCount: 0, adTypes: [] })
    mockGoogleScrape.mockResolvedValue({ ...HEALTHY_GOOGLE, activeAdsCount: 0, adFormats: [] })
    const result = await new AdsCollector(
      makeSupabase({ ownAdRows: [{ insight_date: '2026-08-03', spend: 0, impressions: 9999 }] }),
    ).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
    expect(result.findings.find(x => x.finding_type === 'budget_inefficiency')?.severity).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// Single-platform concentration
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — single-platform', () => {
  it('emits medium budget_inefficiency when Meta-only', async () => {
    mockGoogleScrape.mockResolvedValue({ ...HEALTHY_GOOGLE, activeAdsCount: 0, adFormats: [] })
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(
      x => x.finding_type === 'budget_inefficiency' && x.title.includes('Meta only'),
    )
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('emits medium budget_inefficiency when Google-only', async () => {
    mockMetaScrape.mockResolvedValue({ ...HEALTHY_META, activeAdsCount: 0, adTypes: [] })
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(
      x => x.finding_type === 'budget_inefficiency' && x.title.includes('Google only'),
    )
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('full-platform coverage scores higher than single-platform', async () => {
    const both = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    mockGoogleScrape.mockResolvedValue({ ...HEALTHY_GOOGLE, activeAdsCount: 0, adFormats: [] })
    const metaOnly = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(both.score!).toBeGreaterThan(metaOnly.score!)
  })
})

// ---------------------------------------------------------------------------
// Low ad volume
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — low ad volume', () => {
  it('emits low-volume finding when active ads < 3 on Meta', async () => {
    mockMetaScrape.mockResolvedValue({ ...HEALTHY_META, activeAdsCount: 2 })
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.title.includes('Low ad volume on Meta'))
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })
})

// ---------------------------------------------------------------------------
// Weak creative diversity
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — creative diversity', () => {
  it('emits poor_landing_page_relevance when only one creative format on Meta', async () => {
    mockMetaScrape.mockResolvedValue({ ...HEALTHY_META, adTypes: ['image'] })
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(
      x => x.finding_type === 'poor_landing_page_relevance' && x.title.includes('Meta'),
    )
    expect(f).toBeDefined()
  })

  it('does NOT emit creative finding when ≥ 2 formats present', async () => {
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(
      result.findings.find(x => x.finding_type === 'poor_landing_page_relevance'),
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Degraded result on Apify failure
// ---------------------------------------------------------------------------

describe('AdsCollector.collect() — provider failure', () => {
  it('returns degraded { score: null, findings: [] } when BOTH provider calls throw', async () => {
    mockMetaScrape.mockRejectedValue(new Error('provider down'))
    mockGoogleScrape.mockRejectedValue(new Error('provider down'))
    const result = await new AdsCollector(makeSupabase(), 30_000).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toEqual([])
  })

  it('still scores when ONE provider succeeds', async () => {
    mockMetaScrape.mockRejectedValue(new Error('provider down'))
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).not.toBeNull()
    expect(result.meta_ads).toBeNull()
    expect(result.google_ads).not.toBeNull()
  })
})
