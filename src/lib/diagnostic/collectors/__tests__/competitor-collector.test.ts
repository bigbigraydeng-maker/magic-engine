import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available at factory time
// ---------------------------------------------------------------------------

const { mockGetCompetitorDomains, mockGetDomainMetrics, mockScrapeCompetitorMetaAds, mockAnalyzeSite } =
  vi.hoisted(() => ({
    mockGetCompetitorDomains: vi.fn(),
    mockGetDomainMetrics: vi.fn(),
    mockScrapeCompetitorMetaAds: vi.fn(),
    mockAnalyzeSite: vi.fn(),
  }))

vi.mock('@/lib/dataforseo/client', () => ({
  getCompetitorDomains: mockGetCompetitorDomains,
}))

vi.mock('@/lib/semrush/client', () => ({
  getDomainMetrics: mockGetDomainMetrics,
}))

vi.mock('@/lib/apify/ad-library', () => ({
  scrapeCompetitorMetaAds: mockScrapeCompetitorMetaAds,
}))

vi.mock('@/lib/diagnostic/competitor-site-analyzer', () => ({
  analyzeCompetitorSite: mockAnalyzeSite,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { CompetitorCollector } from '../competitor-collector'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-comp-test'
const DOMAIN = 'client.co.nz'
const KEYWORDS: string[] = ['plumber auckland', 'emergency plumber']

const COMPETITOR_DOMAINS = [
  { domain: 'comp-a.co.nz', overlap_score: 0.8, organic_traffic: 5000, authority_score: 35 },
  { domain: 'comp-b.co.nz', overlap_score: 0.6, organic_traffic: 3000, authority_score: 28 },
  { domain: 'comp-c.co.nz', overlap_score: 0.5, organic_traffic: 4000, authority_score: 30 },
  { domain: 'comp-d.co.nz', overlap_score: 0.4, organic_traffic: 2000, authority_score: 22 },
  { domain: 'comp-e.co.nz', overlap_score: 0.3, organic_traffic: 1000, authority_score: 18 },
]

const DEFAULT_COMPETITOR_METRICS = {
  organic_keywords: 500,
  organic_traffic: 3000,
  authority_score: 27,
}

const DEFAULT_AD_DATA = {
  domain: 'comp-a.co.nz',
  activeAdsCount: 5,
  adTypes: ['image', 'video'],
  estimatedSpend: 'medium' as const,
  topAdCopy: ['Best Plumber in Auckland', 'Fast Emergency Service'],
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCompetitorDomains.mockResolvedValue(COMPETITOR_DOMAINS)
  mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
  mockScrapeCompetitorMetaAds.mockResolvedValue(DEFAULT_AD_DATA)
  mockAnalyzeSite.mockResolvedValue(null)  // default: site analysis off
})

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — return shape', () => {
  it('returns { score, findings, competitorList }', async () => {
    // Client traffic = 300 (avg competitors ~3000 → ratio=0.1, score≈10)
    mockGetDomainMetrics
      .mockResolvedValueOnce({ organic_keywords: 50, organic_traffic: 300, authority_score: 15 }) // client
      .mockResolvedValue(DEFAULT_COMPETITOR_METRICS) // competitors

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result).toHaveProperty('score')
    expect(result).toHaveProperty('findings')
    expect(result).toHaveProperty('competitorList')
    expect(typeof result.score).toBe('number')
    expect(Array.isArray(result.findings)).toBe(true)
    expect(Array.isArray(result.competitorList)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// competitorList ordering and limit
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — competitorList', () => {
  it('returns at most 5 competitors sorted by overlap_score descending', async () => {
    mockGetDomainMetrics.mockResolvedValue({ organic_keywords: 200, organic_traffic: 3000, authority_score: 25 })

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.competitorList.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < result.competitorList.length; i++) {
      expect(result.competitorList[i - 1].overlap_score).toBeGreaterThanOrEqual(
        result.competitorList[i].overlap_score,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Scoring — large traffic gap
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — large traffic gap', () => {
  it('score < 20 and emits traffic_gap_large (critical) when client/avg < 0.1', async () => {
    // client traffic=100, avg competitor=3000 → ratio=0.033
    mockGetDomainMetrics
      .mockResolvedValueOnce({ organic_keywords: 20, organic_traffic: 100, authority_score: 10 })
      .mockResolvedValue(DEFAULT_COMPETITOR_METRICS)

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeLessThan(20)
    const f = result.findings.find(x => x.finding_type === 'traffic_gap_large')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
  })

  it('findings include evidence_json with competitor traffic comparison', async () => {
    mockGetDomainMetrics
      .mockResolvedValueOnce({ organic_keywords: 20, organic_traffic: 100, authority_score: 10 })
      .mockResolvedValue(DEFAULT_COMPETITOR_METRICS)

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.finding_type === 'traffic_gap_large')
    expect(f?.evidence).toBeDefined()
    expect(f?.evidence).toMatchObject({
      parsed: {
        client_traffic: expect.any(Number),
        avg_competitor_traffic: expect.any(Number),
        ratio: expect.any(Number),
      },
      collected_at: expect.any(String),
    })
  })
})

// ---------------------------------------------------------------------------
// Scoring — competitive
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — competitive', () => {
  it('score >= 80 and no traffic_gap_large when client/avg >= 0.8', async () => {
    // client traffic=2800, avg competitor=3000 → ratio≈0.93
    mockGetDomainMetrics
      .mockResolvedValueOnce({ organic_keywords: 400, organic_traffic: 2800, authority_score: 30 })
      .mockResolvedValue(DEFAULT_COMPETITOR_METRICS)

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.findings.find(x => x.finding_type === 'traffic_gap_large')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// No competitor data
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — insufficient competitor data', () => {
  it('score=null and emits competitor_data_insufficient (high) when DataForSEO returns empty', async () => {
    // P8.5.21: 0 competitors → cannot evaluate competitive position; score=null
    mockGetCompetitorDomains.mockResolvedValue([])

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    const f = result.findings.find(x => x.finding_type === 'competitor_data_insufficient')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('score=null when only 2 competitors found (below minimum 3)', async () => {
    mockGetCompetitorDomains.mockResolvedValue([
      { domain: 'a.co.nz', overlap_score: 0.5, organic_traffic: 1000, authority_score: 20 },
      { domain: 'b.co.nz', overlap_score: 0.4, organic_traffic: 800, authority_score: 18 },
    ])
    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings[0].finding_type).toBe('competitor_data_insufficient')
  })

  it('competitorList is empty when no competitors found', async () => {
    mockGetCompetitorDomains.mockResolvedValue([])
    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.competitorList).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// SEMrush failure — graceful degradation
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — SEMrush failure', () => {
  it('does not crash and returns a result when getDomainMetrics throws', async () => {
    mockGetDomainMetrics.mockRejectedValue(new Error('SEMrush down'))
    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(typeof result.score).toBe('number')
    expect(Array.isArray(result.findings)).toBe(true)
  })

  it('falls back to DataForSEO organic_traffic when SEMrush fails', async () => {
    mockGetDomainMetrics.mockRejectedValue(new Error('SEMrush down'))
    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    // competitorList still populated from DataForSEO
    expect(result.competitorList.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Apify ad scraping — serial, top 3 only
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — Meta Ads scraping', () => {
  it('calls scrapeCompetitorMetaAds for at most top 3 competitors', async () => {
    mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
    await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    // At most 3 calls (top 3 by overlap_score)
    expect(mockScrapeCompetitorMetaAds.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('does not crash when Apify throws for a competitor', async () => {
    mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
    mockScrapeCompetitorMetaAds.mockRejectedValue(new Error('Apify error'))
    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(typeof result.score).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// P8.10.S2.2 — Jina site signal analysis + content gap finding
// ---------------------------------------------------------------------------

describe('CompetitorCollector.collect() — site signals (P8.10.S2.2)', () => {
  const sig = (domain: string, cta_count: number) => ({
    domain,
    fetched_at: '2026-05-18T00:00:00Z',
    usp_candidates: ['Premium', 'Curated tours'],
    cta_count,
    cta_examples: Array.from({ length: Math.min(cta_count, 5) }, (_, i) => `CTA${i}`),
    landing_page_type: 'homepage' as const,
    category_depth: 8,
    word_count: 600,
  })

  it('attaches site_signals to top 3 competitors when analyzer succeeds', async () => {
    mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
    mockAnalyzeSite
      .mockResolvedValueOnce(sig(DOMAIN, 4))            // client
      .mockResolvedValueOnce(sig('comp-a.co.nz', 10))
      .mockResolvedValueOnce(sig('comp-b.co.nz', 12))
      .mockResolvedValueOnce(sig('comp-c.co.nz', 11))

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const top3 = result.competitorList.slice(0, 3)
    expect(top3.every(c => c.site_signals !== undefined)).toBe(true)
  })

  it('emits competitor_content_gap when avg competitor CTA ≥ 2x client', async () => {
    mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
    mockAnalyzeSite
      .mockResolvedValueOnce(sig(DOMAIN, 2))            // client: 2 CTAs
      .mockResolvedValueOnce(sig('comp-a.co.nz', 10))
      .mockResolvedValueOnce(sig('comp-b.co.nz', 12))
      .mockResolvedValueOnce(sig('comp-c.co.nz', 11))   // avg comp = 11 ≥ 2 × 2

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.finding_type === 'competitor_content_gap')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('does NOT emit competitor_content_gap when client matches or exceeds competitors', async () => {
    mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
    mockAnalyzeSite
      .mockResolvedValueOnce(sig(DOMAIN, 10))           // client: rich CTAs
      .mockResolvedValueOnce(sig('comp-a.co.nz', 4))
      .mockResolvedValueOnce(sig('comp-b.co.nz', 5))
      .mockResolvedValueOnce(sig('comp-c.co.nz', 3))

    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.findings.find(x => x.finding_type === 'competitor_content_gap')).toBeUndefined()
  })

  it('does NOT crash when site analyzer returns null for all', async () => {
    mockGetDomainMetrics.mockResolvedValue(DEFAULT_COMPETITOR_METRICS)
    mockAnalyzeSite.mockResolvedValue(null)
    const result = await new CompetitorCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(typeof result.score).toBe('number')
    expect(result.findings.find(x => x.finding_type === 'competitor_content_gap')).toBeUndefined()
  })
})
