import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before imports (hoisting requirement)
// ---------------------------------------------------------------------------

vi.mock('@/lib/dataforseo/labs', () => ({
  getKeywordsForSite: vi.fn(),
}))

vi.mock('@/lib/dataforseo/client', () => ({
  getBacklinkSummary: vi.fn(),
  getSerpRankings: vi.fn(),
  // Keep the real mapping — the market-routing tests below assert on it.
  locationCodeFor: (db?: string | null) => (({ au: 2036, nz: 2554 })[db ?? 'au'] ?? 2036),
}))

vi.mock('@/lib/diagnostic/technical-seo', () => ({
  auditTechnicalSeo: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SeoCollector } from '../seo-collector'
import { getKeywordsForSite } from '@/lib/dataforseo/labs'
import { getBacklinkSummary, getSerpRankings } from '@/lib/dataforseo/client'
import { auditTechnicalSeo } from '@/lib/diagnostic/technical-seo'
import type { TechnicalSeoSignals } from '@/lib/diagnostic/technical-seo'

const mockKeywordsForSite = vi.mocked(getKeywordsForSite)
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
  return { keyword, search_volume: 200, keyword_difficulty: 25, cpc: 1.5, competition: 0.3, intent: 'commercial', position: null }
}

// authority_score is now derived from backlinks.rank / 10.
// HEALTHY_BACKLINKS.rank = 320 → authority_score = 32 (above LOW_AUTHORITY_THRESHOLD=20)
// LOW_AUTHORITY_BACKLINKS.rank = 150 → authority_score = 15 (below threshold)
const LOW_AUTHORITY_BACKLINKS = { ...HEALTHY_BACKLINKS, rank: 150 }

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockKeywordsForSite.mockResolvedValue(KEYWORDS.map(kwData))
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
    mockKeywordsForSite.mockResolvedValue(KEYWORDS.map(kwData))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const gap = result.findings.find(f => f.finding_type === 'keyword_gap_critical')
    expect(gap).toBeUndefined()
  })

  it('produces keyword_gap_critical (critical) when coverage is zero', async () => {
    mockKeywordsForSite.mockResolvedValue([])  // domain ranks for none of our keywords
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const gap = result.findings.find(f => f.finding_type === 'keyword_gap_critical')
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('critical')
    expect(gap?.dimension).toBe('seo')
  })

  it('score is 0 when coverage=0, authority=0, and technical=0', async () => {
    mockBacklinks.mockResolvedValue({ ...HEALTHY_BACKLINKS, rank: 0 })
    mockKeywordsForSite.mockResolvedValue([])
    mockTech.mockResolvedValue({ ...HEALTHY_TECH, score: 0, issues: [] })
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
  })

  it('produces low_domain_rank (high) when authority_score < 20', async () => {
    mockBacklinks.mockResolvedValue(LOW_AUTHORITY_BACKLINKS)
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const finding = result.findings.find(f => f.finding_type === 'low_domain_rank')
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('high')
    expect(finding?.dimension).toBe('seo')
  })

  it('does NOT produce low_domain_rank when authority_score >= 20', async () => {
    mockBacklinks.mockResolvedValue({ ...HEALTHY_BACKLINKS, rank: 200 })  // 200/10 = 20 exactly
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const finding = result.findings.find(f => f.finding_type === 'low_domain_rank')
    expect(finding).toBeUndefined()
  })

  it('returns degraded result (score=null, findings=[]) on timeout', async () => {
    // Simulate hanging API — never-resolving promise
    mockKeywordsForSite.mockReturnValue(new Promise(() => {}))
    const collector = new SeoCollector(10)   // 10 ms timeout for fast tests
    const result = await collector.collect(CLIENT_ID, DOMAIN, KEYWORDS)
    // P8.5.19: degraded path returns null (not 0) so dimension is skipped
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })

  it('returns degraded result when external API throws', async () => {
    mockKeywordsForSite.mockRejectedValue(new Error('DataForSEO 503'))
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
    mockBacklinks.mockResolvedValue(LOW_AUTHORITY_BACKLINKS)
    mockKeywordsForSite.mockResolvedValue([])
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    for (const f of result.findings) {
      expect(f.client_id).toBe(CLIENT_ID)
      expect(['me_auto', 'fde_manual', 'third_party']).toContain(f.fix_type)
    }
  })

  // ── GSC fallback ──────────────────────────────────────────────────────────

  it('uses gscQueries as fallback when no target keywords configured', async () => {
    const GSC_QUERIES = ['cts tours nz', 'china travel nz', 'beijing tours auckland']
    mockKeywordsForSite.mockResolvedValue(GSC_QUERIES.map(kwData))
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, [], GSC_QUERIES)
    expect(result.score).not.toBeNull()
    expect(result.findings.find(f => f.finding_type === 'keywords_not_configured')).toBeUndefined()
  })

  it('returns score=null when both keywords and gscQueries are empty', async () => {
    const result = await new SeoCollector().collect(CLIENT_ID, DOMAIN, [], [])
    expect(result.score).toBeNull()
    expect(result.findings[0].finding_type).toBe('keywords_not_configured')
  })
})

// ── Market routing (AU=2036, NZ=2554) ───────────────────────────────────────
//
// Regression guard: fetchAndScore read the global `process.env.SEMRUSH_DB`, so
// every client got the deploy default — an NZ client was scored against the AU
// keyword set and AU SERP. The market must come from the caller (clients.semrush_db).
describe('SeoCollector.collect() — market routing', () => {
  it('sends the NZ location code and db for an NZ client', async () => {
    await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, [], 'nz')
    expect(mockKeywordsForSite).toHaveBeenCalledWith(DOMAIN, 2554, expect.any(Number))
    expect(mockSerp).toHaveBeenCalledWith(DOMAIN, expect.any(Array), 'nz')
  })

  it('sends the AU location code and db for an AU client', async () => {
    await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, [], 'au')
    expect(mockKeywordsForSite).toHaveBeenCalledWith(DOMAIN, 2036, expect.any(Number))
    expect(mockSerp).toHaveBeenCalledWith(DOMAIN, expect.any(Array), 'au')
  })

  it('ignores the global SEMRUSH_DB env — the client market wins', async () => {
    vi.stubEnv('SEMRUSH_DB', 'au')
    await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, [], 'nz')
    expect(mockKeywordsForSite).toHaveBeenCalledWith(DOMAIN, 2554, expect.any(Number))
    vi.unstubAllEnvs()
  })

  it('defaults to AU when the caller omits the market', async () => {
    await new SeoCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockKeywordsForSite).toHaveBeenCalledWith(DOMAIN, 2036, expect.any(Number))
    expect(mockSerp).toHaveBeenCalledWith(DOMAIN, expect.any(Array), 'au')
  })
})
