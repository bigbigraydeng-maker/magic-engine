import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOPIC_MAP_OPTIONS,
  buildTopicMap,
} from '../topic-map'
import type { KeywordMember, PageAggRow, SitePageRow } from '../candidates'

const kw = (
  keyword: string,
  position: number,
  volume: number,
): KeywordMember => ({ keyword, position, volume, kd: 20, intent: 'informational' })

const page = (
  url: string,
  title: string,
  h1: string,
  path: string,
): SitePageRow => ({ url, path, title, h1, word_count: 800 })

const agg = (
  url: string,
  impressions: number,
  clicks: number,
  position: number,
): PageAggRow => ({ url, clicks, impressions, position })

describe('buildTopicMap', () => {
  it('flags overlap when two pages both carry a real share, hub is the larger page', () => {
    const keywords: KeywordMember[] = [kw('nz visa', 6, 500)]
    const sitePages: SitePageRow[] = [
      page('https://example.com/nz-visa', 'NZ visa guide', 'NZ visa', '/nz-visa'),
      page('https://example.com/visa-nz', 'Visa for NZ', 'Visa NZ', '/visa-nz'),
    ]
    const pageAgg: PageAggRow[] = [
      agg('https://example.com/nz-visa', 600, 40, 6),
      agg('https://example.com/visa-nz', 400, 20, 8),
    ]

    const entries = buildTopicMap(keywords, sitePages, pageAgg)
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.overlap).toBe(true)
    expect(entry.hubUrl).toBe('https://example.com/nz-visa')
    expect(entry.pages[0].share).toBe(0.6)
    expect(entry.pages[1].share).toBe(0.4)
    expect(entry.confidence).toBe('很可能')
  })

  it('does not flag overlap when one page dominates', () => {
    const keywords: KeywordMember[] = [kw('nz visa', 6, 500)]
    const sitePages: SitePageRow[] = [
      page('https://example.com/nz-visa', 'NZ visa guide', 'NZ visa', '/nz-visa'),
      page('https://example.com/visa-nz', 'Visa for NZ', 'Visa NZ', '/visa-nz'),
    ]
    const pageAgg: PageAggRow[] = [
      agg('https://example.com/nz-visa', 900, 60, 6),
      agg('https://example.com/visa-nz', 100, 5, 9),
    ]

    const entries = buildTopicMap(keywords, sitePages, pageAgg)
    expect(entries).toHaveLength(1)
    expect(entries[0].overlap).toBe(false)
    expect(entries[0].pages[1].share).toBe(0.1)
  })

  it('drops pages below minPageImpressions', () => {
    const keywords: KeywordMember[] = [kw('nz visa', 6, 500)]
    const sitePages: SitePageRow[] = [
      page('https://example.com/nz-visa', 'NZ visa guide', 'NZ visa', '/nz-visa'),
      page('https://example.com/visa-nz', 'Visa for NZ', 'Visa NZ', '/visa-nz'),
    ]
    const pageAgg: PageAggRow[] = [
      agg('https://example.com/nz-visa', 600, 40, 6),
      agg('https://example.com/visa-nz', 10, 1, 9),
    ]

    const entries = buildTopicMap(keywords, sitePages, pageAgg)
    expect(entries).toHaveLength(1)
    expect(entries[0].pages).toHaveLength(1)
    expect(entries[0].pages[0].url).toBe('https://example.com/nz-visa')
    expect(entries[0].overlap).toBe(false)
  })

  it('produces no entry when no page matches the keyword', () => {
    const keywords: KeywordMember[] = [kw('nz visa', 6, 500)]
    const sitePages: SitePageRow[] = [
      page('https://example.com/about', 'About us', 'About', '/about'),
    ]
    const pageAgg: PageAggRow[] = [agg('https://example.com/about', 500, 30, 5)]

    const entries = buildTopicMap(keywords, sitePages, pageAgg)
    expect(entries).toEqual([])
  })

  it('collapses two keywords with the same tokenKey into one entry', () => {
    const keywords: KeywordMember[] = [
      kw('nz visa', 6, 500),
      kw('visa nz', 7, 300),
    ]
    const sitePages: SitePageRow[] = [
      page('https://example.com/nz-visa', 'NZ visa guide', 'NZ visa', '/nz-visa'),
    ]
    const pageAgg: PageAggRow[] = [agg('https://example.com/nz-visa', 600, 40, 6)]

    const entries = buildTopicMap(keywords, sitePages, pageAgg)
    expect(entries).toHaveLength(1)
    expect(entries[0].keyword).toBe('nz visa')
    expect(entries[0].volume).toBe(500)
  })

  it('sorts overlap entries first', () => {
    const keywords: KeywordMember[] = [
      kw('nz visa', 6, 500),
      kw('au visa', 6, 400),
    ]
    const sitePages: SitePageRow[] = [
      page('https://example.com/nz-visa', 'NZ visa guide', 'NZ visa', '/nz-visa'),
      page('https://example.com/visa-nz', 'Visa for NZ', 'Visa NZ', '/visa-nz'),
      page('https://example.com/au-visa', 'AU visa guide', 'AU visa', '/au-visa'),
    ]
    const pageAgg: PageAggRow[] = [
      agg('https://example.com/nz-visa', 600, 40, 6),
      agg('https://example.com/visa-nz', 400, 20, 8),
      agg('https://example.com/au-visa', 900, 60, 5),
    ]

    const entries = buildTopicMap(keywords, sitePages, pageAgg)
    expect(entries).toHaveLength(2)
    expect(entries[0].keyword).toBe('nz visa')
    expect(entries[0].overlap).toBe(true)
    expect(entries[1].keyword).toBe('au visa')
    expect(entries[1].overlap).toBe(false)
  })

  it('returns [] for empty inputs', () => {
    expect(buildTopicMap([], [], [])).toEqual([])
    expect(buildTopicMap([], [], [], DEFAULT_TOPIC_MAP_OPTIONS)).toEqual([])
  })
})
