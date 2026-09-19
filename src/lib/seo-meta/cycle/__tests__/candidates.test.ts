import { describe, expect, it } from 'vitest'
import { fromGscPages, mergeCandidates, normaliseCandidateUrl } from '../candidates'

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

describe('mergeCandidates — dedup (魏征 finding #9; GSC-only source per 复审 2026-09-20 item A.1)', () => {
  it('does NOT collapse a trailing-slash-only duplicate into two candidates (the case the dedup bug would multiply spend on)', () => {
    const gsc1 = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const gsc2 = fromGscPages([{ page: 'https://example.com/blog/foo/', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates([...gsc1, ...gsc2], new Set(), 10)
    expect(merged).toHaveLength(1)
  })

  it('does NOT collapse a case-only duplicate host into two candidates', () => {
    const gsc1 = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const gsc2 = fromGscPages([{ page: 'https://EXAMPLE.com/blog/foo', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates([...gsc1, ...gsc2], new Set(), 10)
    expect(merged).toHaveLength(1)
  })

  it('excludes cooldown slugs', () => {
    const gsc = fromGscPages([{ page: 'https://example.com/blog/foo', impressions: 100, position: 9 }], [])
    const merged = mergeCandidates(gsc, new Set(['foo']), 10)
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
    const merged = mergeCandidates(gsc, new Set(), 2)
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
    const merged = mergeCandidates(gsc, new Set(), 10)
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

  it('carries the real GSC ctr field through as a 0-1 decimal fraction, paired with the same page\'s impressions (no cross-source unit mismatch possible now that GSC is the only source)', () => {
    const [candidate] = fromGscPages([{ page: 'https://example.com/a', impressions: 100, position: 10, ctr: 0.032 }], [])
    expect(candidate.ctr).toBe(0.032)
    expect(candidate.impressions).toBe(100)
  })
})
