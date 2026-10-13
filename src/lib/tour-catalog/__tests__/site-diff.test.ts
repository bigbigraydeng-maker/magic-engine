import { describe, expect, it } from 'vitest'
import type { FirstPartyTour, FirstPartyTourFeed } from '@/lib/web-intelligence/first-party-tours'
import { diffWebsiteVsCatalog, feedReadNotes } from '../site-diff'
import type { WebsiteTour } from '../website-output'

function makeWebsiteTour(overrides: Partial<WebsiteTour> = {}): WebsiteTour {
  return {
    id: 'tour-1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    title: '',
    short_description: '',
    duration: '',
    price: '',
    hero_image: '',
    meta_title: '',
    meta_description: '',
    is_active: true,
    sold_out: false,
    updated_at: '2027-01-02',
    departure_dates: [],
    departure_pricing: {},
    tour_cities: [],
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    gallery: [],
    tags: [],
    faqs: [],
    single_supplement: null,
    single_supplement_note: null,
    max_group_size: null,
    rating: null,
    review_count: null,
    review_summary: null,
    related_blog_slugs: [],
    quick_answer: null,
    ...overrides,
  }
}

function makeFeedProduct(overrides: Partial<FirstPartyTour> = {}): FirstPartyTour {
  return {
    id: 'tour-1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    is_active: true,
    updated_at: '2027-01-02',
    departure_dates: [],
    departure_pricing: {},
    tour_cities: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    single_supplement: null,
    max_group_size: null,
    ...overrides,
  }
}

const TODAY = '2027-01-01'

describe('diffWebsiteVsCatalog', () => {
  it('reports zero differences for a matching pair', () => {
    const product = makeFeedProduct()
    const catalog = makeWebsiteTour()
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toEqual([])
    expect(result.onlyOnWebsite).toEqual([])
    expect(result.onlyInCatalog).toEqual([])
  })

  it('treats missing optional feed fields as catalog defaults', () => {
    const product = makeFeedProduct()
    const catalog = makeWebsiteTour()
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toEqual([])
  })

  it('ignores id, created_at and updated_at differences', () => {
    const product = makeFeedProduct({ id: 'other', updated_at: '2099-01-01' })
    const catalog = makeWebsiteTour({ id: 'tour-1', updated_at: '2027-01-02' })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toEqual([])
  })

  it('ignores expired website dates but reports a future one missing from the catalog', () => {
    const product = makeFeedProduct({
      departure_dates: ['1 January 2026', '5 March 2027'],
      departure_pricing: { '1 January 2026': 'NZD $1', '5 March 2027': 'NZD $2' },
    })
    const catalog = makeWebsiteTour({ departure_dates: [], departure_pricing: {} })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    const labels = result.differences.map((d) => d.fieldLabel)
    expect(labels).toContain('出发日期')
    expect(labels).toContain('班期单独价')
    const dates = result.differences.find((d) => d.fieldLabel === '出发日期')
    expect(dates?.website).toContain('5 March 2027')
    expect(dates?.website).not.toContain('1 January 2026')
  })

  it('reports an unparseable website date', () => {
    const product = makeFeedProduct({ departure_dates: ['not a date'] })
    const catalog = makeWebsiteTour({ departure_dates: [] })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    const dates = result.differences.find((d) => d.fieldLabel === '出发日期')
    expect(dates?.website).toContain('not a date')
  })

  it('does not care about object key order', () => {
    const product = makeFeedProduct({
      faqs: [{ question: 'Q', answer: 'A', link: { label: 'L', href: '/x' } }],
    })
    const catalog = makeWebsiteTour({
      faqs: [{ question: 'Q', answer: 'A', link: { href: '/x', label: 'L' } }],
    })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toEqual([])
  })

  it('cares about array order', () => {
    const product = makeFeedProduct({ gallery: ['/a.jpg', '/b.jpg'] })
    const catalog = makeWebsiteTour({ gallery: ['/b.jpg', '/a.jpg'] })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toHaveLength(1)
    expect(result.differences[0].fieldLabel).toBe('图集')
  })

  it('reports itinerary differences per day', () => {
    const product = makeFeedProduct({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Land' },
        { day: 2, title: 'Explore', description: 'Walk' },
      ],
    })
    const catalog = makeWebsiteTour({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Land', meals: [] },
        { day: 2, title: 'Explore', description: 'Walk', meals: [], accommodation: 'Hotel A' },
      ],
    })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toHaveLength(1)
    expect(result.differences[0].fieldLabel).toBe('行程 第 2 天')
  })

  it('reports a day present on one side only', () => {
    const product = makeFeedProduct({
      itinerary: [{ day: 1, title: 'Arrive', description: 'Land' }],
    })
    const catalog = makeWebsiteTour({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Land', meals: [] },
        { day: 2, title: 'Explore', description: 'Walk', meals: [] },
      ],
    })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.differences).toHaveLength(1)
    expect(result.differences[0].fieldLabel).toBe('行程 第 2 天')
  })

  it('lists tours only on one side', () => {
    const product = makeFeedProduct({ slug: 'web-only', name: 'Web Only' })
    const catalog = makeWebsiteTour({ slug: 'cat-only', name: 'Cat Only' })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    expect(result.onlyOnWebsite).toEqual(['Web Only'])
    expect(result.onlyInCatalog).toEqual(['Cat Only'])
  })

  it('flags a duplicated website key', () => {
    const first = makeFeedProduct({ name: 'Sample Tour' })
    const second = makeFeedProduct({ name: 'Sample Tour' })
    const catalog = makeWebsiteTour()
    const result = diffWebsiteVsCatalog([first, second], [catalog], TODAY)
    expect(result.onlyOnWebsite).toContain('Sample Tour（官网重复）')
  })

  it('cuts long values around the first difference', () => {
    const longA = 'x'.repeat(400) + 'A' + 'y'.repeat(400)
    const longB = 'x'.repeat(400) + 'B' + 'y'.repeat(400)
    const product = makeFeedProduct({ short_description: longA })
    const catalog = makeWebsiteTour({ short_description: longB })
    const result = diffWebsiteVsCatalog([product], [catalog], TODAY)
    const entry = result.differences.find((d) => d.fieldLabel === '行程简介')
    expect(entry).toBeDefined()
    expect(entry?.website).not.toBe(entry?.catalog)
    expect((entry?.website ?? '').length).toBeLessThanOrEqual(302)
    expect((entry?.catalog ?? '').length).toBeLessThanOrEqual(302)
  })
})

describe('feedReadNotes', () => {
  function makeFeed(overrides: Partial<FirstPartyTourFeed> = {}): FirstPartyTourFeed {
    return {
      source: 'test',
      source_version: '1',
      products: [],
      ...overrides,
    }
  }

  it('returns [] for a clean feed', () => {
    expect(feedReadNotes(makeFeed())).toEqual([])
  })

  it('mentions skipped products first', () => {
    const notes = feedReadNotes(makeFeed({ skipped_products: 2 }))
    expect(notes[0]).toContain('2')
  })

  it('notes an unparseable departure date', () => {
    const product = makeFeedProduct({ departure_dates: ['not a date'] })
    const notes = feedReadNotes(makeFeed({ products: [product] }))
    expect(notes.some((n) => n.includes('departure_unparseable'))).toBe(true)
  })

  it('notes a rejected price', () => {
    const product = makeFeedProduct({ price: 'free' })
    const notes = feedReadNotes(makeFeed({ products: [product] }))
    expect(notes.some((n) => n.includes('price_rejected'))).toBe(true)
  })
})
