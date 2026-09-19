import { describe, expect, it } from 'vitest'
import {
  fromGapKeywords,
  fromGscPages,
  fromPatrolFindings,
  mergeCandidates,
  normaliseCandidateUrl,
} from '../candidates'

describe('normaliseCandidateUrl', () => {
  it('strips trailing slash', () => {
    expect(normaliseCandidateUrl('https://example.com/blog/foo/')).toBe('https://example.com/blog/foo')
  })

  it('lowercases the host but not the path', () => {
    expect(normaliseCandidateUrl('https://EXAMPLE.com/Blog/Foo')).toBe('https://example.com/Blog/Foo')
  })

  it('treats bare-domain and root-slash as the same URL', () => {
    expect(normaliseCandidateUrl('https://example.com')).toBe(normaliseCandidateUrl('https://example.com/'))
  })

  it('drops the hash fragment', () => {
    expect(normaliseCandidateUrl('https://example.com/blog/foo#section')).toBe('https://example.com/blog/foo')
  })

  it('falls back to trimmed lowercase for a non-URL string without throwing', () => {
    expect(normaliseCandidateUrl('  NOT-A-URL/  ')).toBe('not-a-url')
  })
})

describe('mergeCandidates — dedup across sources (魏征 finding #9)', () => {
  it('collapses the same page discovered by both patrol and GSC into one candidate, preferring patrol', () => {
    const patrol = fromPatrolFindings([
      { url: 'https://example.com/blog/foo', keyword: 'foo keyword', position: 8, searchVolume: 500, keywordDifficulty: 30 },
    ])
    const gsc = fromGscPages(
      [{ page: 'https://example.com/blog/foo/', impressions: 100, position: 9 }],
      [{ query: 'foo keyword', impressions: 100 }],
    )
    const merged = mergeCandidates({ patrol, gsc, gap: [] }, new Set(), new Set(), 10)
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe('patrol')
  })

  it('does NOT collapse a trailing-slash-only duplicate into two candidates (the case the dedup bug would multiply spend on)', () => {
    const gsc1 = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const gsc2 = fromGscPages([{ page: 'https://example.com/blog/foo/', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates({ patrol: [], gsc: [...gsc1, ...gsc2], gap: [] }, new Set(), new Set(), 10)
    expect(merged).toHaveLength(1)
  })

  it('does NOT collapse a case-only duplicate host into two candidates', () => {
    const gsc1 = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const gsc2 = fromGscPages([{ page: 'https://EXAMPLE.com/blog/foo', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates({ patrol: [], gsc: [...gsc1, ...gsc2], gap: [] }, new Set(), new Set(), 10)
    expect(merged).toHaveLength(1)
  })

  it('keeps gap keywords (no page) separate from page-scoped candidates', () => {
    const gsc = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const gap = fromGapKeywords([{ keyword: 'unrelated gap term', search_volume: 800, keyword_difficulty: 40 }])
    const merged = mergeCandidates({ patrol: [], gsc, gap }, new Set(), new Set(), 10)
    expect(merged).toHaveLength(2)
  })

  it('excludes cooldown slugs', () => {
    const gsc = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates({ patrol: [], gsc, gap: [] }, new Set(['foo']), new Set(), 10)
    expect(merged).toHaveLength(0)
  })

  it('excludes slugs already checked this cycle (revert candidates from step 1)', () => {
    const gsc = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates({ patrol: [], gsc, gap: [] }, new Set(), new Set(['foo']), 10)
    expect(merged).toHaveLength(0)
  })

  it('caps to max and sorts by impressions desc', () => {
    const gsc = fromGscPages(
      [
        { page: 'https://example.com/a', impressions: 50, position: 5 },
        { page: 'https://example.com/b', impressions: 200, position: 5 },
        { page: 'https://example.com/c', impressions: 100, position: 5 },
      ],
      [],
    )
    const merged = mergeCandidates({ patrol: [], gsc, gap: [] }, new Set(), new Set(), 2)
    expect(merged).toHaveLength(2)
    expect(merged.map((c) => c.pageUrl)).toEqual(['https://example.com/b', 'https://example.com/c'])
  })

  it('does not treat two genuinely different pages sharing a token as duplicates', () => {
    const gsc = fromGscPages(
      [
        { page: 'https://example.com/blog/rotorua-tours', impressions: 50, position: 5 },
        { page: 'https://example.com/blog/rotorua-hotels', impressions: 50, position: 5 },
      ],
      [],
    )
    const merged = mergeCandidates({ patrol: [], gsc, gap: [] }, new Set(), new Set(), 10)
    expect(merged).toHaveLength(2)
  })
})

describe('fromGscPages filtering', () => {
  it('drops pages outside the position 4-20 window', () => {
    const merged = fromGscPages(
      [
        { page: 'https://example.com/a', impressions: 100, position: 1 },
        { page: 'https://example.com/b', impressions: 100, position: 25 },
        { page: 'https://example.com/c', impressions: 100, position: 10 },
      ],
      [],
    )
    expect(merged.map((c) => c.slug)).toEqual(['c'])
  })

  it('drops pages under the impressions floor', () => {
    const merged = fromGscPages([{ page: 'https://example.com/a', impressions: 5, position: 10 }], [])
    expect(merged).toHaveLength(0)
  })

  it('drops the homepage (no usable slug) instead of yielding the hostname as a slug', () => {
    const merged = fromGscPages([{ page: 'https://example.com/', impressions: 100, position: 10 }], [])
    expect(merged).toHaveLength(0)
  })
})
