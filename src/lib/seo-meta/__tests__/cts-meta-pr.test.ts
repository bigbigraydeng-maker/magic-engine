/**
 * Unit tests for the pure parts of the CTS meta executor (22.E.S17):
 * the narrow-lane source editor and the GSC candidate picker.
 */

import { describe, it, expect } from 'vitest'
import { replaceMetaForSlug, pickCandidates } from '../cts-meta-pr'

const SOURCE = `// SEO Pages Data
export const chinaToursMeta: SeoPageMeta = {
  slug: 'china-tours',
  title: 'China Tours from New Zealand 2026-27 · 4 Itineraries | CTS',
  description:
    'Compare 4 China tours from NZ. New Zealand\\'s dedicated specialist.',
  h1: 'China Tours from New Zealand',
};

export const beijingToursMeta: CityHubMeta = {
  slug: 'beijing-tours',
  title: 'Beijing Tours | CTS',
  description: 'Old beijing description.',
  h1: 'Beijing Tours',
};
`

describe('replaceMetaForSlug — narrow lane', () => {
  it('replaces only the target slug object, neighbours untouched', () => {
    const result = replaceMetaForSlug(SOURCE, 'beijing-tours', 'New Beijing Title | CTS', 'New beijing desc.')
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("title: 'New Beijing Title | CTS'")
    expect(result!.updated).toContain("description: 'New beijing desc.'")
    // china-tours object stays byte-identical
    expect(result!.updated).toContain("title: 'China Tours from New Zealand 2026-27 · 4 Itineraries | CTS'")
    expect(result!.oldTitle).toBe('Beijing Tours | CTS')
    expect(result!.oldDesc).toBe('Old beijing description.')
  })

  it('handles escaped quotes in old values and escapes them in new values', () => {
    const result = replaceMetaForSlug(SOURCE, 'china-tours', "NZ's Best China Tours | CTS", "Kiwi's choice.")
    expect(result).not.toBeNull()
    expect(result!.oldDesc).toBe("Compare 4 China tours from NZ. New Zealand's dedicated specialist.")
    expect(result!.updated).toContain("title: 'NZ\\'s Best China Tours | CTS'")
    expect(result!.updated).toContain("'Kiwi\\'s choice.'")
  })

  it('returns null for slugs the meta file does not manage (skip, never guess)', () => {
    expect(replaceMetaForSlug(SOURCE, 'not-a-page', 'x', 'y')).toBeNull()
  })

  it('blog lane: edits title + excerpt in a per-post data file', () => {
    const blogSource = `export const chongqingVsChengduPost: BlogPost = {
  id: 'lt-1',
  slug: 'chongqing-vs-chengdu',
  title: 'Chongqing vs Chengdu: Which Should NZ Travellers Visit in 2026?',
  excerpt:
    'Hotpot capital vs panda capital — old excerpt.',
  author: 'Baker Gu',
};
`
    const result = replaceMetaForSlug(
      blogSource, 'chongqing-vs-chengdu', 'New CQ Title | CTS', 'New excerpt with CTA.', 'excerpt',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("title: 'New CQ Title | CTS'")
    expect(result!.updated).toContain("'New excerpt with CTA.'")
    expect(result!.oldDesc).toBe('Hotpot capital vs panda capital — old excerpt.')
    // author line untouched
    expect(result!.updated).toContain("author: 'Baker Gu'")
  })

  it('blog lane: returns null when the post has no excerpt field', () => {
    const noExcerpt = `export const xPost: BlogPost = { slug: 'x-post', title: 'T', author: 'A' };`
    expect(replaceMetaForSlug(noExcerpt, 'x-post', 'a', 'b', 'excerpt')).toBeNull()
  })
})

describe('pickCandidates', () => {
  const pages = [
    { page: 'https://www.ctstours.co.nz/beijing-tours', impressions: 500, position: 6 },
    { page: 'https://www.ctstours.co.nz/china-tours/', impressions: 900, position: 12 },
    { page: 'https://www.ctstours.co.nz/', impressions: 2000, position: 2 }, // pos<4 → out
    { page: 'https://www.ctstours.co.nz/silk-road', impressions: 5, position: 8 }, // impressions<10 → out
  ]
  const queries = [
    { query: 'beijing tours from nz', impressions: 300 },
    { query: 'china tours new zealand', impressions: 800 },
  ]

  it('filters by position band + impressions, sorts by impressions, matches keywords', () => {
    const out = pickCandidates(pages, queries, new Set())
    expect(out.map((c) => c.slug)).toEqual(['china-tours', 'beijing-tours'])
    expect(out[0].keyword).toBe('china tours new zealand')
    expect(out[1].keyword).toBe('beijing tours from nz')
  })

  it('cooldown slugs are skipped', () => {
    const out = pickCandidates(pages, queries, new Set(['china-tours']))
    expect(out.map((c) => c.slug)).toEqual(['beijing-tours'])
  })

  it('caps at max', () => {
    expect(pickCandidates(pages, queries, new Set(), 1)).toHaveLength(1)
  })

  it('homepage URL never yields the hostname as a garbage slug (首跑事故回归)', () => {
    const withHome = [
      { page: 'https://www.ctstours.co.nz/', impressions: 3593, position: 7.9 },
      { page: 'https://www.ctstours.co.nz/beijing-tours', impressions: 500, position: 6 },
    ]
    const out = pickCandidates(withHome, queries, new Set())
    expect(out.map((c) => c.slug)).toEqual(['beijing-tours'])
  })
})
