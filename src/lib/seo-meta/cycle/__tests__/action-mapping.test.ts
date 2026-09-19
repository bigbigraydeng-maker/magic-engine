import { describe, expect, it } from 'vitest'
import { deriveMetaCycleAction } from '../action-mapping'
import type { MetaCycleCandidate } from '../types'

function candidate(overrides: Partial<MetaCycleCandidate> = {}): MetaCycleCandidate {
  return {
    pageUrl: 'https://example.com/blog/foo',
    slug: 'foo',
    keyword: 'foo keyword',
    source: 'gsc',
    position: 8,
    impressions: 100,
    searchVolume: 500,
    keywordDifficulty: 30,
    ctr: 5,
    discoveredNotIndexed: false,
    ...overrides,
  }
}

describe('deriveMetaCycleAction', () => {
  it('auto-executes title_rewrite for a ranking 4-20 page with real impressions', () => {
    const result = deriveMetaCycleAction({ candidate: candidate({ position: 8 }), top3CompetitorDomains: [], top3CompetitorTitles: [] })
    expect(result.actionType).toBe('title_rewrite')
    expect(result.auto).toBe(true)
  })

  it('auto-executes index_request when the page is not indexed, regardless of position', () => {
    const result = deriveMetaCycleAction({
      candidate: candidate({ discoveredNotIndexed: true, position: null }),
      top3CompetitorDomains: [], top3CompetitorTitles: [],
    })
    expect(result.actionType).toBe('index_request')
    expect(result.auto).toBe(true)
  })

  it('routes gap keywords (no page) to new_page, manual', () => {
    const result = deriveMetaCycleAction({
      candidate: candidate({ pageUrl: null, slug: null, source: 'gap', position: null }),
      top3CompetitorDomains: [], top3CompetitorTitles: [],
    })
    expect(result.actionType).toBe('new_page')
    expect(result.auto).toBe(false)
  })

  it('routes deep-ranked pages (position > 20) to content_refresh, manual', () => {
    const result = deriveMetaCycleAction({ candidate: candidate({ position: 35 }), top3CompetitorDomains: [], top3CompetitorTitles: [] })
    expect(result.actionType).toBe('content_refresh')
    expect(result.auto).toBe(false)
  })

  it('routes already-top-3 pages to internal_link rather than risking the title', () => {
    const result = deriveMetaCycleAction({ candidate: candidate({ position: 2 }), top3CompetitorDomains: [], top3CompetitorTitles: [] })
    expect(result.actionType).toBe('internal_link')
    expect(result.auto).toBe(false)
  })

  it('skips high-difficulty keywords where an established site holds the top 3', () => {
    const result = deriveMetaCycleAction({
      candidate: candidate({ keywordDifficulty: 85 }),
      top3CompetitorDomains: ['en.wikipedia.org', 'somesite.com', 'booking.com'], top3CompetitorTitles: [],
    })
    expect(result.actionType).toBe('skip')
    expect(result.auto).toBe(false)
  })

  it('does NOT skip high difficulty when no established site is in the top 3', () => {
    const result = deriveMetaCycleAction({
      candidate: candidate({ keywordDifficulty: 85, position: 8 }),
      top3CompetitorDomains: ['smallblog.example', 'anothersmallsite.example'], top3CompetitorTitles: [],
    })
    expect(result.actionType).toBe('title_rewrite')
  })

  it('the skip check runs before the no-page check (order-sensitive, matches deriveActionType discipline)', () => {
    const result = deriveMetaCycleAction({
      candidate: candidate({ pageUrl: null, slug: null, keywordDifficulty: 90 }),
      top3CompetitorDomains: ['wikipedia.org'], top3CompetitorTitles: [],
    })
    expect(result.actionType).toBe('skip')
  })
})
