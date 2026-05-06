/**
 * Tests for analyzer.crossSignals (Phase 8.D.1.2)
 *
 * Pure function: given the three signals (AI weak spots / site pages /
 * keyword opportunities), produce a flat list of strategy candidates.
 *
 * Each candidate carries enough context for the scorer + downstream UI:
 *   - action_type: upgrade_page | new_blog | social_content
 *   - content_mode: unified | geo_only | seo_only
 *   - source linkage (page id / query id / keyword)
 *   - rationale string for human-readable display
 */

import { describe, it, expect } from 'vitest'
import { crossSignals } from './analyzer'
import type {
  AnalyzerInput,
  WeakQuery,
  KeywordOpportunity,
  SitePageRef,
} from './analyzer'

const weak = (overrides: Partial<WeakQuery> = {}): WeakQuery => ({
  query_id: 'q1',
  question: 'best china tour operator in new zealand',
  weakness_score: 0.9,
  best_engine_rank: null,
  topics: ['china-tours', 'nz-travellers'],
  ...overrides,
})

const kw = (overrides: Partial<KeywordOpportunity> = {}): KeywordOpportunity => ({
  keyword: 'china tour nz',
  volume: 320,
  kd: 28,
  intent: 'informational',
  topics: ['china-tours'],
  ...overrides,
})

const page = (overrides: Partial<SitePageRef> = {}): SitePageRef => ({
  id: 'page-1',
  url: 'https://example.com/services/china-tours',
  page_type: 'service',
  topics: ['china-tours'],
  primary_keyword: 'china tours',
  word_count: 1200,
  has_geo_block: true,
  ...overrides,
})

function input(o: Partial<AnalyzerInput>): AnalyzerInput {
  return {
    weak_queries: o.weak_queries ?? [],
    site_pages: o.site_pages ?? [],
    keywords: o.keywords ?? [],
  }
}

describe('crossSignals', () => {
  it('emits unified new_blog when AI weak spot + low-KD keyword (same topic) + no matching page', () => {
    const out = crossSignals(
      input({
        weak_queries: [weak({ topics: ['china-tours'] })],
        keywords: [
          kw({ keyword: 'china tour nz', kd: 25, topics: ['china-tours'] }),
        ],
        site_pages: [page({ topics: ['unrelated'] })],
      })
    )
    const unified = out.find((c) => c.content_mode === 'unified')
    expect(unified).toBeDefined()
    expect(unified?.action_type).toBe('new_blog')
    expect(unified?.source_query_id).toBe('q1')
    expect(unified?.source_keyword).toBe('china tour nz')
  })

  it('emits geo_only new_blog when AI weak spot has no SEO-valuable keyword', () => {
    const out = crossSignals(
      input({
        weak_queries: [weak()],
        keywords: [], // no SEO opportunity
        site_pages: [],
      })
    )
    const geoOnly = out.find((c) => c.content_mode === 'geo_only')
    expect(geoOnly).toBeDefined()
    expect(geoOnly?.action_type).toBe('new_blog')
    expect(geoOnly?.source_query_id).toBe('q1')
    expect(geoOnly?.source_keyword).toBeUndefined()
  })

  it('emits upgrade_page when an existing page covers the weak topic but is thin or missing GEO', () => {
    const out = crossSignals(
      input({
        weak_queries: [weak({ topics: ['china-tours'] })],
        keywords: [kw()],
        site_pages: [
          page({
            id: 'thin-page',
            topics: ['china-tours'],
            word_count: 400,
            has_geo_block: false,
          }),
        ],
      })
    )
    const upgrade = out.find((c) => c.action_type === 'upgrade_page')
    expect(upgrade).toBeDefined()
    expect(upgrade?.source_page_id).toBe('thin-page')
  })

  it('does not emit a redundant new_blog when a strong, GEO-equipped page already covers the topic', () => {
    const out = crossSignals(
      input({
        weak_queries: [weak({ topics: ['china-tours'] })],
        keywords: [kw()],
        site_pages: [
          page({
            id: 'strong-page',
            topics: ['china-tours'],
            word_count: 1500,
            has_geo_block: true,
          }),
        ],
      })
    )
    expect(out.find((c) => c.action_type === 'new_blog')).toBeUndefined()
  })

  it('emits seo_only new_blog when a low-KD keyword has no AI weak spot AND no existing page', () => {
    const out = crossSignals(
      input({
        weak_queries: [],
        keywords: [
          kw({ keyword: 'small group tours china', kd: 25, topics: ['small-group'] }),
        ],
        site_pages: [],
      })
    )
    const seoOnly = out.find((c) => c.content_mode === 'seo_only')
    expect(seoOnly).toBeDefined()
    expect(seoOnly?.action_type).toBe('new_blog')
    expect(seoOnly?.source_keyword).toBe('small group tours china')
  })

  it('skips seo_only when a strong page already targets the keyword', () => {
    const out = crossSignals(
      input({
        weak_queries: [],
        keywords: [kw({ keyword: 'china tours' })],
        site_pages: [
          page({
            primary_keyword: 'china tours',
            word_count: 1500,
            has_geo_block: true,
          }),
        ],
      })
    )
    expect(out.find((c) => c.content_mode === 'seo_only')).toBeUndefined()
  })

  it('drops keywords with KD too high to be worth pursuing for SEO', () => {
    const out = crossSignals(
      input({
        weak_queries: [],
        keywords: [kw({ keyword: 'china', kd: 95 })],
        site_pages: [],
      })
    )
    expect(out.find((c) => c.content_mode === 'seo_only')).toBeUndefined()
  })

  it('produces at most one candidate per (weak query, keyword) pair', () => {
    const out = crossSignals(
      input({
        weak_queries: [weak({ topics: ['china-tours'] })],
        keywords: [kw({ keyword: 'china tour nz', topics: ['china-tours'] })],
        site_pages: [],
      })
    )
    const sameSrc = out.filter(
      (c) => c.source_query_id === 'q1' && c.source_keyword === 'china tour nz'
    )
    expect(sameSrc.length).toBe(1)
  })
})
