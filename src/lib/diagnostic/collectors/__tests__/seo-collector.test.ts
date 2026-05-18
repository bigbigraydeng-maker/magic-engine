import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before imports (hoisting requirement)
// ---------------------------------------------------------------------------

vi.mock('@/lib/semrush/client', () => ({
  getDomainMetrics: vi.fn(),
  getDomainOrganicKeywords: vi.fn(),
}))

vi.mock('@/lib/dataforseo/client', () => ({
  getBacklinkSummary: vi.fn(),
  getSerpRankings: vi.fn(),
}))

vi.mock('@/lib/diagnostic/technical-seo', () => ({
  auditTechnicalSeo: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SeoCollector } from '../seo-collector'
import { getDomainMetrics, getDomainOrganicKeywords } from '@/lib/semrush/client'
import { getBacklinkSummary, getSerpRankings } from '@/lib/dataforseo/client'
import { auditTechnicalSeo } from '@/lib/diagnostic/technical-seo'
import type { TechnicalSeoSignals } from '@/lib/diagnostic/technical-seo'

const mockMetrics = vi.mocked(getDomainMetrics)
const mockOrganicKws = vi.mocked(getDomainOrganicKeywords)
const mockBacklinks = vi.mocked(getBacklinkSummary)
const mockSerp = vi.mocked(getSerpRankings)
const mockTech = vi.mocked(auditTechnicalSeo)

const HEALTHY_BACKLINKS = {
  total_backlinks: 5000,
  referring_domains: 80,
  rank: 320,
  broken_backlinks: 5,
  fetched_at: '2026-05-18T00:00:00Z',
}
const HEALTHY_TECH: TechnicalSeoSignals = {
  titlePresent: true,
  titleLength: 55,
  h1Count: 1,
  wordCount: 500,
  internalLinkCount: 8,
  score: 80,
  issues: [],
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-abc'
const DOMAIN = 'example.co.nz'
const KEYWORDS = ['china tours nz', 'beijing tours', 'nz travel china']

function kwData(keyword: string) {
  return { keyword, volume: 200, kd: 25, cpc: 1.5, intent: 'commercial', trend: [] }
}

const HEALTHY_METRICS = { organic_keywords: 800, organic_traffic: 12000, authority_score: 45 }
const LOW_AUTHORITY_METRICS = { organic_keywords: 50, organic_traffic: 300, authority_score: 12 }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockMetrics.mockResolvedValue(HEALTHY_METRICS)
  mockOrganicKws.mockResolvedValue(KEYWORDS.map(kwData))
  mockBacklinks.mockResolvedValue(HEALTHY_BACKLINKS)
  mockSerp.mockResolvedValue(
    KEYWORDS.map(k => ({ keyword: k, position: 5, url: `https://${DOMAIN}/${k.replace(/\s/g, '-')}`, fetched_at: '2026-05-18T00:00:00Z' })),
  )
  mockTech.mockResolvedValue(HEALTHY_TECH)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SeoCollector.collect()', () => {
  it('returns score between 0 and 100', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns a findings array', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(Array.isArray(result.findings)).toBe(true)
  })

  it('returns no keyword_gap_critical when all keywords are ranked', async () => {
    mockOrganicKws.mockResolvedValue(KEYWORDS.map(kwData))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const gap = result.findings.find(f => f.finding_type === 'keyword_gap_critical')
    expect(gap).toBeUndefined()
  })

  it('produces keyword_gap_critical (critical) when coverage is zero', async () => {
    mockOrganicKws.mockResolvedValue([])  // domain ranks for none of our keywords
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const gap = result.findings.find(f => f.finding_type === 'keyword_gap_critical')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('critical')
    expect(gap?.dimension).toBe('seo')
  })

  it('score is 0 when coverage=0, authority=0, and technical=0', async () => {
    mockMetrics.mockResolvedValue({ organic_keywords: 0, organic_traffic: 0, authority_score: 0 })
    mockOrganicKws.mockResolvedValue([])
    mockTech.mockResolvedValue({ ...HEALTHY_TECH, score: 0, issues: [] })
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
  })

  it('produces low_domain_rank (high) when authority_score < 20', async () => {
    mockMetrics.mockResolvedValue(LOW_AUTHORITY_METRICS)
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const finding = result.findings.find(f => f.finding_type === 'low_domain_rank')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('high')
    expect(finding?.dimension).toBe('seo')
  })

  it('does NOT produce low_domain_rank when authority_score >= 20', async () => {
    mockMetrics.mockResolvedValue({ ...HEALTHY_METRICS, authority_score: 20 })
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const finding = result.findings.find(f => f.finding_type === 'low_domain_rank')
    expect(finding).toBeUndefined()
  })

  it('returns degraded result (score=null, findings=[]) on timeout', async () => {
    // Simulate hanging API — never-resolving promise
    mockMetrics.mockReturnValue(new Promise(() => {}))
    const collector = new SeoCollector(10)   // 10 ms timeout for fast tests
    const result = await collector.collect(CLIENT_ID, DOMAIN, KEYWORDS)
    // P8.5.19: degraded path returns null (not 0) so dimension is skipped
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })

  it('returns degraded result when external API throws', async () => {
    mockMetrics.mockRejectedValue(new Error('SEMrush 503'))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })

  it('handles empty keywords list — score=null + keywords_not_configured finding', async () => {
    // P8.5.19: no keywords configured → cannot evaluate SEO; emit guidance finding
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, [])
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].finding_type).toBe('keywords_not_configured')
    expect(result.findings[0].severity).toBe('high')
  })

  // ── P8.10.S2.1: backlink & SERP findings ─────────────────────────────────

  it('produces low_referring_domains (medium) when 3 ≤ referring_domains < 10', async () => {
    mockBacklinks.mockResolvedValue({ ...HEALTHY_BACKLINKS, referring_domains: 5 })
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.finding_type === 'low_referring_domains')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('escalates low_referring_domains to high when referring_domains < 3', async () => {
    mockBacklinks.mockResolvedValue({ ...HEALTHY_BACKLINKS, referring_domains: 1 })
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.finding_type === 'low_referring_domains')
    expect(f?.severity).toBe('high')
  })

  it('does NOT produce low_referring_domains when ≥ 10', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.findings.find(x => x.finding_type === 'low_referring_domains')).toBeUndefined()
  })

  it('does NOT crash when backlinks API fails (degraded)', async () => {
    mockBacklinks.mockRejectedValue(new Error('DataForSEO 500'))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).not.toBeNull()  // SEO score still produced
    expect(result.findings.find(x => x.finding_type === 'low_referring_domains')).toBeUndefined()
  })

  it('produces serp_invisible (high) when no target keyword ranks in top 100', async () => {
    mockSerp.mockResolvedValue(
      KEYWORDS.map(k => ({ keyword: k, position: null, url: null, fetched_at: 'now' })),
    )
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.finding_type === 'serp_invisible')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('produces serp_buried (medium) when avg position > 30', async () => {
    mockSerp.mockResolvedValue(
      KEYWORDS.map(k => ({ keyword: k, position: 55, url: 'x', fetched_at: 'now' })),
    )
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = result.findings.find(x => x.finding_type === 'serp_buried')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('does NOT produce serp_buried when avg position ≤ 30', async () => {
    // Default mock has position=5
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.findings.find(x => x.finding_type === 'serp_buried')).toBeUndefined()
  })

  it('does NOT crash when SERP API fails (degraded)', async () => {
    mockSerp.mockRejectedValue(new Error('DataForSEO 500'))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).not.toBeNull()
    expect(result.findings.find(x => x.finding_type === 'serp_invisible')).toBeUndefined()
  })

  it('all findings carry client_id and fix_type', async () => {
    mockMetrics.mockResolvedValue(LOW_AUTHORITY_METRICS)
    mockOrganicKws.mockResolvedValue([])
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    for (const f of result.findings) {
      expect(f.client_id).toBe(CLIENT_ID)
      expect(['me_auto', 'fde_manual', 'third_party']).toContain(f.fix_type)
    }
  })
})
