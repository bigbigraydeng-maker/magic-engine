/**
 * Unit tests for the pure parts of the CTS meta executor (22.E.S17):
 * the narrow-lane source editor, the content-built slug index, and the
 * GSC candidate picker.
 */

import { describe, it, expect } from 'vitest'
import {
  replaceMetaForSlug,
  readMetaForSlug,
  buildSlugIndex,
  pickCandidates,
} from '../cts-meta-pr'
import type { MetaFieldStyle } from '../cts-meta-pr'

const HUB_SOURCE = `// SEO Pages Data
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

/** Real shape of blogs-longtail-batch1.ts: many posts inside ONE export. */
const BATCH_SOURCE = `import type { BlogPost } from '@/lib/types/blog-post';

export const longtailBatch1Posts: BlogPost[] = [
  {
    id: 'lt-a1',
    slug: 'beijing-xian-itinerary-10-days',
    title: '10-Day Beijing & Xi\\'an Itinerary for NZ Travellers',
    excerpt: 'A practical day-by-day guide to 10 days in Beijing and Xi\\'an.',
    author: 'Baker Gu',
  },
  {
    id: 'lt-a3',
    slug: 'beijing-to-xian-high-speed-train',
    title: 'Beijing to Xi\\'an High-Speed Train: NZ Travel Guide',
    excerpt: 'The high-speed train between Beijing and Xi\\'an is one of the best.',
    author: 'Baker Gu',
  },
];
`

/** Destination guides (guides.ts): metaTitle/metaDescription + section titles. */
const GUIDES_SOURCE = `export const beijingGuide: DestinationGuide = {
  id: 'guide-beijing',
  slug: 'beijing-travel-guide',
  destinationName: 'Beijing',
  metaTitle: 'Beijing Travel Guide | CTS Tours NZ',
  metaDescription: 'Old beijing desc.',
  sections: [
    { title: 'Forbidden City', id: 'forbidden-city', content: ['a'] },
  ],
  relatedGuideSlugs: ['chongqing-travel-guide'],
};

export const chongqingGuide: DestinationGuide = {
  id: 'guide-chongqing',
  slug: 'chongqing-travel-guide',
  destinationName: 'Chongqing',
  metaTitle: 'Old Chongqing Title | CTS Tours NZ',
  metaDescription: 'Old chongqing desc.',
  sections: [
    { title: 'Liziba Station', id: 'liziba-station', content: ['b'] },
  ],
};

export const noMetaGuide: DestinationGuide = {
  id: 'guide-nowhere',
  slug: 'no-meta-guide',
  destinationName: 'Nowhere',
  sections: [
    { title: 'Only a section title', id: 'x', content: ['c'] },
  ],
};
`

describe('replaceMetaForSlug — narrow lane', () => {
  it('replaces only the target entry, neighbours untouched (hub file)', () => {
    const result = replaceMetaForSlug(HUB_SOURCE, 'beijing-tours', 'New Beijing Title | CTS', 'New beijing desc.')
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("title: 'New Beijing Title | CTS'")
    expect(result!.updated).toContain("description: 'New beijing desc.'")
    expect(result!.updated).toContain("title: 'China Tours from New Zealand 2026-27 · 4 Itineraries | CTS'")
    expect(result!.oldTitle).toBe('Beijing Tours | CTS')
    expect(result!.oldDesc).toBe('Old beijing description.')
  })

  it('handles escaped quotes in old values and escapes them in new values', () => {
    const result = replaceMetaForSlug(HUB_SOURCE, 'china-tours', "NZ's Best China Tours | CTS", "Kiwi's choice.")
    expect(result).not.toBeNull()
    expect(result!.oldDesc).toBe("Compare 4 China tours from NZ. New Zealand's dedicated specialist.")
    expect(result!.updated).toContain("title: 'NZ\\'s Best China Tours | CTS'")
    expect(result!.updated).toContain("'Kiwi\\'s choice.'")
  })

  it('returns null for slugs the file does not contain (skip, never guess)', () => {
    expect(replaceMetaForSlug(HUB_SOURCE, 'not-a-page', 'x', 'y')).toBeNull()
  })

  it('batch file: edits the right post and auto-detects the excerpt field', () => {
    const result = replaceMetaForSlug(
      BATCH_SOURCE, 'beijing-to-xian-high-speed-train', 'New Train Title | CTS', 'New train excerpt.',
    )
    expect(result).not.toBeNull()
    expect(result!.oldTitle).toBe("Beijing to Xi'an High-Speed Train: NZ Travel Guide")
    expect(result!.updated).toContain("title: 'New Train Title | CTS'")
    expect(result!.updated).toContain("excerpt: 'New train excerpt.'")
    // the sibling post inside the SAME export is byte-identical
    expect(result!.updated).toContain("title: '10-Day Beijing & Xi\\'an Itinerary for NZ Travellers'")
    expect(result!.updated).toContain("excerpt: 'A practical day-by-day guide to 10 days in Beijing and Xi\\'an.'")
  })

  it('batch file: a post missing its excerpt does NOT steal the next post\'s (neighbour corruption guard)', () => {
    const missingExcerpt = `export const posts: BlogPost[] = [
  {
    slug: 'no-excerpt-post',
    title: 'No Excerpt Post',
  },
  {
    slug: 'healthy-post',
    title: 'Healthy Post',
    excerpt: 'Do not touch me.',
  },
];
`
    expect(replaceMetaForSlug(missingExcerpt, 'no-excerpt-post', 'a', 'b')).toBeNull()
  })

  it('default style still works when the style argument is omitted (back-compat)', () => {
    const result = replaceMetaForSlug(HUB_SOURCE, 'beijing-tours', 'Compat Title | CTS', 'Compat desc.')
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("title: 'Compat Title | CTS'")
    expect(result!.updated).toContain("description: 'Compat desc.'")
  })
})

describe('replaceMetaForSlug — guide style', () => {
  it('replaces ONLY metaTitle and metaDescription of the requested guide', () => {
    const result = replaceMetaForSlug(
      GUIDES_SOURCE,
      'chongqing-travel-guide',
      'New Chongqing Title | CTS Tours NZ',
      'New chongqing desc.',
      'guide',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("metaTitle: 'New Chongqing Title | CTS Tours NZ'")
    expect(result!.updated).toContain("metaDescription: 'New chongqing desc.'")
    // section titles are untouched
    expect(result!.updated).toContain("title: 'Liziba Station'")
    expect(result!.updated).toContain("title: 'Forbidden City'")
    // neighbouring guide's meta is untouched
    expect(result!.updated).toContain("metaTitle: 'Beijing Travel Guide | CTS Tours NZ'")
    expect(result!.oldTitle).toBe('Old Chongqing Title | CTS Tours NZ')
    expect(result!.oldDesc).toBe('Old chongqing desc.')
  })

  it('escapes a single quote in the new title', () => {
    const result = replaceMetaForSlug(
      GUIDES_SOURCE,
      'chongqing-travel-guide',
      "NZ's Best Chongqing Guide | CTS",
      'New desc.',
      'guide',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("metaTitle: 'NZ\\'s Best Chongqing Guide | CTS'")
  })

  it('returns null for a guide with no metaTitle/metaDescription (source untouched)', () => {
    const result = replaceMetaForSlug(GUIDES_SOURCE, 'no-meta-guide', 'a', 'b', 'guide')
    expect(result).toBeNull()
  })

  it('a nested slug mention never edits the wrong guide', () => {
    // relatedSlugs mentions 'chongqing-travel-guide' inside the beijing guide,
    // but the top-level anchor is what matters.
    const result = replaceMetaForSlug(
      GUIDES_SOURCE,
      'chongqing-travel-guide',
      'New Chongqing Title | CTS Tours NZ',
      'New chongqing desc.',
      'guide',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("metaTitle: 'Beijing Travel Guide | CTS Tours NZ'")
    expect(result!.updated).toContain("metaTitle: 'New Chongqing Title | CTS Tours NZ'")
  })

  it('a slug that only appears nested returns null in guide style', () => {
    // 'chongqing-travel-guide' appears nested in relatedSlugs; a slug that
    // appears ONLY nested (not as a top-level key) must not match.
    const nestedOnly = `export const guides = [
  {
    slug: 'beijing-travel-guide',
    metaTitle: 'Beijing Travel Guide | CTS Tours NZ',
    metaDescription: 'Old beijing desc.',
    relatedSlugs: ['chongqing-travel-guide'],
  },
]
`
    expect(replaceMetaForSlug(nestedOnly, 'chongqing-travel-guide', 'a', 'b', 'guide')).toBeNull()
  })
})

describe('readMetaForSlug — guide style', () => {
  it('returns the metaTitle / metaDescription of the requested guide', () => {
    const meta = readMetaForSlug(GUIDES_SOURCE, 'chongqing-travel-guide', 'guide')
    expect(meta).not.toBeNull()
    expect(meta!.title).toBe('Old Chongqing Title | CTS Tours NZ')
    expect(meta!.desc).toBe('Old chongqing desc.')
  })

  it('returns null for a guide with no meta fields', () => {
    expect(readMetaForSlug(GUIDES_SOURCE, 'no-meta-guide', 'guide')).toBeNull()
  })

  it('default style is unchanged when style is omitted', () => {
    const meta = readMetaForSlug(HUB_SOURCE, 'beijing-tours')
    expect(meta).not.toBeNull()
    expect(meta!.title).toBe('Beijing Tours | CTS')
    expect(meta!.desc).toBe('Old beijing description.')
  })
})

describe('buildSlugIndex', () => {
  it('maps every slug to its containing file, including batch files', () => {
    const index = buildSlugIndex([
      { path: 'src/lib/data/seo-pages.ts', source: HUB_SOURCE },
      { path: 'src/lib/data/blogs-longtail-batch1.ts', source: BATCH_SOURCE },
    ])
    expect(index.get('china-tours')).toBe('src/lib/data/seo-pages.ts')
    // filename says "batch1", URL slug says "beijing-to-xian…" — the whole point
    expect(index.get('beijing-to-xian-high-speed-train')).toBe('src/lib/data/blogs-longtail-batch1.ts')
    expect(index.get('beijing-xian-itinerary-10-days')).toBe('src/lib/data/blogs-longtail-batch1.ts')
    expect(index.get('nope')).toBeUndefined()
  })

  it('first file wins on duplicate slugs (deterministic)', () => {
    const a = { path: 'a.ts', source: "slug: 'dup'" }
    const b = { path: 'b.ts', source: "slug: 'dup'" }
    expect(buildSlugIndex([a, b]).get('dup')).toBe('a.ts')
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
