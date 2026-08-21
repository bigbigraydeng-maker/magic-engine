/**
 * Unit tests for the pure parts of the CTS meta executor (22.E.S17):
 * the narrow-lane source editor, the content-built slug index, and the
 * GSC candidate picker.
 */

import { describe, it, expect } from 'vitest'
import { pickCandidates } from '../cts-meta-pr'
import {
  buildSlugIndex,
  inspectCtsIntentForSlug,
  inspectCtsMetaForSlug,
  replaceIntentForSlug,
  replaceMetaForSlug,
} from '../cts-meta-source'

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

describe('replaceMetaForSlug — narrow lane', () => {
  it('reads and replaces the exact title, description and H1 intent fields', () => {
    expect(inspectCtsIntentForSlug(HUB_SOURCE, 'china-tours')).toMatchObject({
      h1: 'China Tours from New Zealand',
    })
    const result = replaceIntentForSlug(
      HUB_SOURCE,
      'china-tours',
      'China Tours & Holiday Packages | CTS',
      'Explore the complete CTS China tours collection.',
      'Explore All China Tours',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("title: 'China Tours & Holiday Packages | CTS'")
    expect(result!.updated).toContain("'Explore the complete CTS China tours collection.'")
    expect(result!.updated).toContain("h1: 'Explore All China Tours'")
    expect(result!.oldH1).toBe('China Tours from New Zealand')
  })

  it('fails closed when the target H1 is missing or ambiguous', () => {
    const missing = HUB_SOURCE.replace("  h1: 'China Tours from New Zealand',\n", '')
    const duplicate = HUB_SOURCE.replace(
      "  h1: 'China Tours from New Zealand',",
      "  h1: 'One',\n  h1: 'Two',",
    )
    expect(replaceIntentForSlug(missing, 'china-tours', 'Title', 'Description', 'H1')).toBeNull()
    expect(replaceIntentForSlug(duplicate, 'china-tours', 'Title', 'Description', 'H1')).toBeNull()
  })

  it('edits the target H1, never an earlier nested lookalike', () => {
    const nested = `export const page = {\n  slug: 'safe',\n  nested: {\n    title: 'Nested title',\n    description: 'Nested description',\n    h1: 'Nested H1',\n  },\n  title: 'Target title',\n  description: 'Target description',\n  h1: 'Target H1',\n};\n`
    const result = replaceIntentForSlug(
      nested,
      'safe',
      'New target',
      'New target description',
      'New target H1',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("    h1: 'Nested H1'")
    expect(result!.updated).toContain("  h1: 'New target H1'")
  })

  it('inspects the exact entry without loading the legacy executor', () => {
    expect(inspectCtsMetaForSlug(HUB_SOURCE, 'beijing-tours')).toEqual({
      slug: 'beijing-tours',
      title: 'Beijing Tours | CTS',
      description: 'Old beijing description.',
      descriptionField: 'description',
    })
  })

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

  it('rejects a slug that appears in more than one real entry in the same source', () => {
    const duplicate = `${HUB_SOURCE}\nexport const duplicate = {\n  slug: 'beijing-tours',\n  title: 'Duplicate',\n  description: 'Duplicate.',\n};\n`
    expect(inspectCtsMetaForSlug(duplicate, 'beijing-tours')).toBeNull()
    expect(replaceMetaForSlug(duplicate, 'beijing-tours', 'x', 'y')).toBeNull()
  })

  it('ignores comment text that merely looks like a slug field', () => {
    const commented = `// slug: 'beijing-tours'\n${HUB_SOURCE}`
    expect(inspectCtsMetaForSlug(commented, 'beijing-tours')?.title).toBe('Beijing Tours | CTS')
  })

  it('ignores block-comment and template-literal pseudo entries', () => {
    const pseudo = `/*\n  slug: 'ghost',\n  title: 'Comment title',\n  description: 'Comment description',\n+*/\nconst fixture = \`\n  slug: 'template-ghost',\n  title: 'Template title',\n  description: 'Template description',\n\`;\n${HUB_SOURCE}`
    expect(inspectCtsMetaForSlug(pseudo, 'ghost')).toBeNull()
    expect(inspectCtsMetaForSlug(pseudo, 'template-ghost')).toBeNull()
    expect(buildSlugIndex([{ path: 'source.ts', source: pseudo }]).has('ghost')).toBe(false)
    expect(buildSlugIndex([{ path: 'source.ts', source: pseudo }]).has('template-ghost')).toBe(false)
    expect(inspectCtsMetaForSlug(pseudo, 'beijing-tours')?.title).toBe('Beijing Tours | CTS')
  })

  it('rejects ambiguous target fields and nested lookalikes', () => {
    const bothDescriptions = `export const page = {\n  slug: 'ambiguous',\n  title: 'Top',\n  description: 'One',\n  excerpt: 'Two',\n};\n`
    const duplicateTitle = `export const page = {\n  slug: 'ambiguous',\n  title: 'One',\n  title: 'Two',\n  description: 'Description',\n};\n`
    const nestedOnly = `export const page = {\n  slug: 'ambiguous',\n  nested: {\n    title: 'Nested',\n    description: 'Nested',\n  },\n};\n`
    expect(inspectCtsMetaForSlug(bothDescriptions, 'ambiguous')).toBeNull()
    expect(inspectCtsMetaForSlug(duplicateTitle, 'ambiguous')).toBeNull()
    expect(inspectCtsMetaForSlug(nestedOnly, 'ambiguous')).toBeNull()
  })

  it('edits the target-level fields, never an earlier nested lookalike', () => {
    const nestedBefore = `export const page = {\n  slug: 'safe',\n  nested: {\n    title: 'Nested title',\n    description: 'Nested description',\n  },\n  title: 'Target title',\n  description: 'Target description',\n};\n`
    const result = replaceMetaForSlug(nestedBefore, 'safe', 'New target', 'New target description')
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("    title: 'Nested title'")
    expect(result!.updated).toContain("    description: 'Nested description'")
    expect(result!.updated).toContain("  title: 'New target'")
    expect(result!.updated).toContain("  description: 'New target description'")
  })

  it('treats replacement tokens literally and escapes line separators', () => {
    const result = replaceMetaForSlug(
      HUB_SOURCE,
      'beijing-tours',
      "Price $& $$ $1 $` $'\nNext",
      'Line one\r\nLine two\u2028Line three\u2029End',
    )
    expect(result).not.toBeNull()
    expect(result!.updated).toContain("title: 'Price $& $$ $1 $` $\\'\\nNext'")
    expect(result!.updated).toContain("description: 'Line one\\r\\nLine two\\u2028Line three\\u2029End'")
    expect(result!.updated).not.toContain("title: 'Price title:")
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

  it('removes duplicate slugs instead of selecting an arbitrary file', () => {
    const a = { path: 'a.ts', source: "slug: 'dup'" }
    const b = { path: 'b.ts', source: "slug: 'dup'" }
    expect(buildSlugIndex([a, b]).get('dup')).toBeUndefined()
  })

  it('removes a slug duplicated inside one file', () => {
    const duplicate = {
      path: 'one.ts',
      source: "  slug: 'dup',\n  slug: 'dup',\n",
    }
    expect(buildSlugIndex([duplicate]).get('dup')).toBeUndefined()
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
