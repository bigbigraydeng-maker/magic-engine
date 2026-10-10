import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetaCycleCandidate } from '../types'

/**
 * 2026-09-28 CTS incident replay. The retired cts-seo-optimizer route (no
 * gate at all) auto-merged chinatravel#213 with the three (page, keyword,
 * new copy) triples below. This file feeds those EXACT triples — values
 * copied from seo_meta_log rows 338f84d0 / 2447dbab / 499b3762 — through
 * the Inngest meta-cycle's gate as it stands after #2172, and asserts each
 * one is stopped before anything reaches the client site.
 *
 * GSC is mocked as the worst case: the bad keyword is this page's ONLY and
 * highest-impression query, so the keyword gate has nothing else to fall
 * back on.
 */

const mockFetchGscQueriesForPage = vi.fn()
vi.mock('@/lib/gsc/client', () => ({
  fetchGscQueriesForPage: (...args: unknown[]) => mockFetchGscQueriesForPage(...args),
}))
vi.mock('@/lib/dataforseo/serp', () => ({ getSerpPage: vi.fn() }))
vi.mock('@/lib/dataforseo/labs', () => ({ bulkKeywordVolume: vi.fn(), getDomainMetrics: vi.fn() }))

const SITE = 'https://www.ctstours.co.nz/'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function candidate(slug: string, path: string): MetaCycleCandidate {
  return {
    pageUrl: `https://www.ctstours.co.nz/${path}`,
    slug,
    keyword: '',
    source: 'gsc',
    position: 8,
    impressions: 500,
    ctr: 0.01,
    searchVolume: null,
    keywordDifficulty: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('2026-09-28 incident replay — gate blocks all three auto-merged changes', () => {
  it('liziba-monorail-chongqing-guide: refuses "how many days in chongqing" (only shares the city word)', async () => {
    const { deriveTopicMatchedKeyword, GATE_REASON } = await import('../gate')
    mockFetchGscQueriesForPage.mockResolvedValue([{ query: 'how many days in chongqing', impressions: 500, clicks: 5, position: 8 }])
    const result = await deriveTopicMatchedKeyword(SITE, candidate('liziba-monorail-chongqing-guide', 'blog/liziba-monorail-chongqing-guide'), CLIENT)
    expect('failure' in result && result.failure.reason).toBe(GATE_REASON.NO_PAGE_SCOPED_KEYWORD)
  })

  it('chongqing-night-city-lights: refuses "the forbidden city" (only shares "city")', async () => {
    const { deriveTopicMatchedKeyword, GATE_REASON } = await import('../gate')
    mockFetchGscQueriesForPage.mockResolvedValue([{ query: 'the forbidden city', impressions: 500, clicks: 5, position: 8 }])
    const result = await deriveTopicMatchedKeyword(SITE, candidate('chongqing-night-city-lights', 'blog/chongqing-night-city-lights'), CLIENT)
    expect('failure' in result && result.failure.reason).toBe(GATE_REASON.NO_PAGE_SCOPED_KEYWORD)
  })

  it('chongqing-night-city-lights: known gap — the title-on-topic floor alone would NOT catch the Forbidden City copy', async () => {
    // "city" is one of this slug's words and appears in "The Forbidden City",
    // so checkTitleOnTopic passes. The keyword gate above is what stops this
    // page; recorded here so nobody relies on checkTitleOnTopic for it.
    const { checkTitleOnTopic } = await import('../gate')
    const r = checkTitleOnTopic(
      'chongqing-night-city-lights',
      "The Forbidden City & China's Best Cities | CTS",
      "Explore the Forbidden City and China's iconic destinations. NZ travellers discover Beijing's treasures with CTS Tours. Book your China adventure today.",
    )
    expect(r.onTopic).toBe(true)
  })

  it('china-tours-from-new-zealand: keyword is on-topic, but the hard fact check blocks the copy that dropped all four tour prices', async () => {
    const { deriveTopicMatchedKeyword } = await import('../gate')
    const { checkHardFactsPreserved } = await import('../hard-fact-check')
    mockFetchGscQueriesForPage.mockResolvedValue([{ query: 'china tours from new zealand', impressions: 500, clicks: 5, position: 8 }])
    const kw = await deriveTopicMatchedKeyword(SITE, candidate('china-tours-from-new-zealand', 'china-tours-from-new-zealand'), CLIENT)
    expect(kw).toEqual({ keyword: 'china tours from new zealand', impressions: 500 })

    const r = checkHardFactsPreserved(
      'China Tours from NZ 2026-27 · 4 Tours from NZD $3,399 | CTS',
      'Compare 4 China tours from New Zealand 2026-27: Tale of Two Cities ($3,480) · Best of China ($3,880) · Shanghai & Surroundings ($3,399) · Silk Road ($7,999). All include Auckland return flights. Backed by CTS — global brand founded in 1928; CTS Tours NZ team in Auckland for 25 years. Visa-free for Kiwi passports.',
      'China Tours from New Zealand | CTS',
      'Discover authentic China tours from New Zealand. Expert itineraries for Kiwi travellers. Book your unforgettable Chinese adventure with CTS today.',
    )
    expect(r.consistent).toBe(false)
    expect(r.droppedFacts).toEqual(expect.arrayContaining(['$3,480', '$3,880', '$7,999', 'Auckland']))
  })
})
