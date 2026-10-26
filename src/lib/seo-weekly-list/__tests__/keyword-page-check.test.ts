import { describe, expect, it } from 'vitest'
import { checkKeywordPages, type KeywordPageInput } from '../keyword-page-check'
import type { PageQueryRow } from '../ctr-diagnosis'

function row(query: string, clicks: number, impressions: number, position: number): PageQueryRow {
  return { query, clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position }
}

describe('checkKeywordPages', () => {
  it('proceeds when exactly one page has impressions for the keyword, matching across word order', () => {
    const pages: KeywordPageInput[] = [
      {
        url: 'https://example.com/a',
        queries: [
          row('visa for china nz', 3, 120, 6.4),
          row('unrelated query', 1, 50, 9),
        ],
      },
      {
        url: 'https://example.com/b',
        queries: [row('something else', 2, 80, 4)],
      },
    ]
    const result = checkKeywordPages('nz china visa', pages)
    expect(result.verdict).toBe('proceed')
    expect(result.readablePages).toBe(2)
    expect(result.unreadableUrls).toEqual([])
    expect(result.split).toBe(false)
    expect(result.ranking).toHaveLength(1)
    expect(result.ranking[0].url).toBe('https://example.com/a')
    expect(result.ranking[0].impressions).toBe(120)
    expect(result.ranking[0].clicks).toBe(3)
    expect(result.ranking[0].position).toBe(6.4)
    expect(result.reasons).toEqual(['谷歌记录显示只有一个自家页在这个词上有曝光，可以直接按这页处理'])
  })

  it('flags a split when two pages both have impressions for the keyword', () => {
    const pages: KeywordPageInput[] = [
      { url: 'https://example.com/a', queries: [row('nz china visa', 1, 40, 7)] },
      { url: 'https://example.com/b', queries: [row('visa china nz', 2, 90, 5)] },
    ]
    const result = checkKeywordPages('nz china visa', pages)
    expect(result.verdict).toBe('human_review')
    expect(result.split).toBe(true)
    expect(result.ranking).toHaveLength(2)
    expect(result.ranking[0].url).toBe('https://example.com/b')
    expect(result.reasons.some(r => r.includes('2 个自家页'))).toBe(true)
  })

  it('flags human review when a page could not be read', () => {
    const pages: KeywordPageInput[] = [
      { url: 'https://example.com/a', queries: [row('nz china visa', 1, 40, 7)] },
      { url: 'https://example.com/b', queries: null },
    ]
    const result = checkKeywordPages('nz china visa', pages)
    expect(result.verdict).toBe('human_review')
    expect(result.readablePages).toBe(1)
    expect(result.unreadableUrls).toEqual(['https://example.com/b'])
    expect(result.reasons.some(r => r.includes('1 个页面的搜索词没读到'))).toBe(true)
  })

  it('flags human review when all pages are readable but none match the keyword', () => {
    const pages: KeywordPageInput[] = [
      { url: 'https://example.com/a', queries: [row('other query', 1, 40, 7)] },
      { url: 'https://example.com/b', queries: [row('another query', 2, 90, 5)] },
    ]
    const result = checkKeywordPages('nz china visa', pages)
    expect(result.verdict).toBe('human_review')
    expect(result.ranking).toHaveLength(0)
    expect(result.reasons.some(r => r.includes('不能证明站内没有'))).toBe(true)
  })

  it('flags human review for an empty pages array', () => {
    const result = checkKeywordPages('nz china visa', [])
    expect(result.verdict).toBe('human_review')
    expect(result.readablePages).toBe(0)
    expect(result.ranking).toHaveLength(0)
    expect(result.reasons).toEqual(['没能读到任何页面的搜索词，无法确认哪个自家页在排这个词，需要人看'])
  })

  it('sums impressions and clicks across multiple matching rows of the same page', () => {
    const pages: KeywordPageInput[] = [
      {
        url: 'https://example.com/a',
        queries: [
          row('nz china visa', 2, 60, 4),
          row('visa for china nz', 3, 40, 8),
          row('unrelated', 9, 900, 1),
        ],
      },
    ]
    const result = checkKeywordPages('nz china visa', pages)
    expect(result.ranking).toHaveLength(1)
    expect(result.ranking[0].impressions).toBe(100)
    expect(result.ranking[0].clicks).toBe(5)
    // impression-weighted average of 4 (60 imp) and 8 (40 imp) = 5.6
    expect(result.ranking[0].position).toBe(5.6)
    expect(result.verdict).toBe('proceed')
  })
})
