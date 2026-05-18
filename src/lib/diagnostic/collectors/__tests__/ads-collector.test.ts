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

vi.mock('@/lib/apify/google-ads-transparency', () => ({
  scrapeGoogleAdsTransparency: mockGoogleScrape,
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

function makeSupabase(overrides: { name?: string | null; semrush_db?: string | null } = {}): SupabaseClient {
  const { name = 'Example Brand', semrush_db = 'nz' } = overrides
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { name, semrush_db },
            error: null,
          }),
        }),
      }),
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
    expect(mockGoogleScrape).toHaveBeenCalledWith('Big Brand Co', expect.any(String))
  })

  it('passes NZ market when client semrush_db = nz', async () => {
    await new AdsCollector(makeSupabase({ semrush_db: 'nz' })).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockMetaScrape).toHaveBeenCalledWith(expect.any(String), 'NZ')
    expect(mockGoogleScrape).toHaveBeenCalledWith(expect.any(String), 'NZ')
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

describe('AdsCollector.collect() — Apify failure', () => {
  it('returns degraded { score: null, findings: [] } when BOTH Apify calls throw', async () => {
    mockMetaScrape.mockRejectedValue(new Error('Apify down'))
    mockGoogleScrape.mockRejectedValue(new Error('Apify down'))
    const result = await new AdsCollector(makeSupabase(), 30_000).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toEqual([])
  })

  it('still scores when ONE provider succeeds', async () => {
    mockMetaScrape.mockRejectedValue(new Error('Apify down'))
    const result = await new AdsCollector(makeSupabase()).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).not.toBeNull()
    expect(result.meta_ads).toBeNull()
    expect(result.google_ads).not.toBeNull()
  })
})
