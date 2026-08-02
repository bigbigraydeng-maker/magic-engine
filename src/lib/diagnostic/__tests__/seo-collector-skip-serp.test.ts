/**
 * SeoCollector skipSerp — PM 2026-07-31「每周省到底」
 *
 * SERP is the most expensive call this collector makes: 10 keywords at
 * depth=100 ≈ US$0.20/domain, roughly 75% of the per-domain cost. It feeds ONLY
 * the informational "buried position" findings and is absent from the score
 * formula (raw = coverage + authority + technical).
 *
 * Two things must hold, and both are money-or-correctness claims:
 *   1. skipSerp:true issues no SERP request at all (the saving is real).
 *   2. The score is byte-identical with and without it (the saving is free).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSerpRankings, mockGetKeywordsForSite, mockGetBacklinkSummary, mockAuditTechnicalSeo } =
  vi.hoisted(() => ({
    mockGetSerpRankings: vi.fn(),
    mockGetKeywordsForSite: vi.fn(),
    mockGetBacklinkSummary: vi.fn(),
    mockAuditTechnicalSeo: vi.fn(),
  }))

vi.mock('@/lib/dataforseo/labs', () => ({ getKeywordsForSite: mockGetKeywordsForSite }))
vi.mock('@/lib/dataforseo/client', () => ({
  getBacklinkSummary: mockGetBacklinkSummary,
  getSerpRankings: mockGetSerpRankings,
  // Real one, not a stub — omitting it makes fetchAndScore throw and the
  // collector silently degrade to score:null, which would hide the bug.
  locationCodeFor: (db: string) => (db === 'nz' ? 2554 : 2036),
}))
vi.mock('@/lib/diagnostic/technical-seo', () => ({ auditTechnicalSeo: mockAuditTechnicalSeo }))

const KEYWORDS = ['flooring brisbane', 'tiles brisbane', 'timber flooring brisbane']

describe('SeoCollector — skipSerp cost gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKeywordsForSite.mockResolvedValue([
      { keyword: 'flooring brisbane' },
      { keyword: 'tiles brisbane' },
    ])
    mockGetBacklinkSummary.mockResolvedValue({ rank: 320 })
    // Full TechnicalSeoSignals shape — buildResult iterates `issues`, and a
    // partial stub makes the collector throw and degrade to score:null.
    mockAuditTechnicalSeo.mockResolvedValue({
      titlePresent: true,
      titleLength: 55,
      h1Count: 1,
      wordCount: 800,
      internalLinkCount: 20,
      score: 60,
      issues: [],
    })
    mockGetSerpRankings.mockResolvedValue([
      { keyword: 'flooring brisbane', position: 47 },
    ])
  })

  it('issues no SERP request when skipSerp is true', async () => {
    const { SeoCollector } = await import('../collectors/seo-collector')

    await new SeoCollector(60_000).collect('c1', 'oztop.com.au', KEYWORDS, [], 'au', { skipSerp: true })

    // The money assertion.
    expect(mockGetSerpRankings).not.toHaveBeenCalled()
    // The other three are still bought — they DO feed the score.
    expect(mockGetKeywordsForSite).toHaveBeenCalled()
    expect(mockGetBacklinkSummary).toHaveBeenCalled()
  })

  it('still issues the SERP request by default (client diagnostics keep it)', async () => {
    const { SeoCollector } = await import('../collectors/seo-collector')

    await new SeoCollector(60_000).collect('c1', 'oztop.com.au', KEYWORDS, [], 'au')

    expect(mockGetSerpRankings).toHaveBeenCalled()
  })

  it('produces an identical score with and without SERP — the saving costs nothing', async () => {
    const { SeoCollector } = await import('../collectors/seo-collector')
    const collector = new SeoCollector(60_000)

    const withSerp = await collector.collect('c1', 'oztop.com.au', KEYWORDS, [], 'au')
    const withoutSerp = await collector.collect('c1', 'oztop.com.au', KEYWORDS, [], 'au', { skipSerp: true })

    expect(withoutSerp.score).toBe(withSerp.score)
    expect(withoutSerp.score).not.toBeNull()
  })
})
