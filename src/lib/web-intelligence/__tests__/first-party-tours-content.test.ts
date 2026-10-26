import { describe, expect, it } from 'vitest'
import { parseFirstPartyTourFeed } from '../first-party-tours'

const OLD_PRODUCT = {
  id: 'p-old',
  slug: 'old-tour',
  destination: 'china',
  tier: 'classic',
  name: 'Old Tour',
  title: 'Old Tour Title',
  duration: '10 days',
  price: 'From NZD $4,999 per person',
  is_active: true,
  updated_at: '2026-01-01T00:00:00Z',
  departure_dates: ['2027-03-11'],
  departure_pricing: { '2027-03-11': 'From NZD $5,111 per person' },
  tour_cities: ['Beijing', 'Xian'],
  itinerary: [{ day: 1, title: 'Arrive', description: 'Welcome', meals: ['dinner'] }],
  inclusions: ['Hotels'],
  exclusions: ['Flights'],
  single_supplement: 'From NZD $900',
  max_group_size: 20,
}

const CONTENT_KEYS = [
  'created_at',
  'short_description',
  'highlights',
  'hero_image',
  'gallery',
  'meta_title',
  'meta_description',
  'tags',
  'faqs',
  'sold_out',
  'single_supplement_note',
  'rating',
  'review_count',
  'review_summary',
  'related_blog_slugs',
  'quick_answer',
] as const

function feedWith(products: unknown[]): unknown {
  return { source: 'example', source_version: '1', products }
}

describe('parseFirstPartyTourFeed content fields', () => {
  it('parses an old-shape product without any content keys', () => {
    const feed = parseFirstPartyTourFeed(feedWith([OLD_PRODUCT]))
    expect(feed).not.toBeNull()
    const product = feed!.products[0]
    expect(product.id).toBe('p-old')
    expect(product.name).toBe('Old Tour')
    for (const key of CONTENT_KEYS) {
      expect(key in product).toBe(false)
    }
    expect(feed!.skipped_products).toBeUndefined()
  })

  it('carries every new-shape content field through unchanged', () => {
    const product = {
      ...OLD_PRODUCT,
      created_at: '2026-02-02T00:00:00Z',
      short_description: 'A short description',
      highlights: ['Great wall', 'Terracotta army'],
      hero_image: '/images/hero.jpg',
      gallery: ['/images/a.jpg', '/images/b.jpg'],
      meta_title: 'Meta title',
      meta_description: 'Meta description',
      tags: ['culture', 'history'],
      faqs: [
        { question: 'Q1', answer: 'A1', link: { href: '/faq', label: 'More' } },
        { question: 'Q2', answer: 'A2', link: null },
      ],
      sold_out: true,
      single_supplement_note: null,
      rating: 4.8,
      review_count: 12,
      review_summary: 'Lovely trip',
      related_blog_slugs: ['blog-one'],
      quick_answer: null,
    }
    const feed = parseFirstPartyTourFeed(feedWith([product]))
    expect(feed).not.toBeNull()
    const parsed = feed!.products[0]
    expect(parsed.created_at).toBe('2026-02-02T00:00:00Z')
    expect(parsed.short_description).toBe('A short description')
    expect(parsed.highlights).toEqual(['Great wall', 'Terracotta army'])
    expect(parsed.hero_image).toBe('/images/hero.jpg')
    expect(parsed.gallery).toEqual(['/images/a.jpg', '/images/b.jpg'])
    expect(parsed.meta_title).toBe('Meta title')
    expect(parsed.meta_description).toBe('Meta description')
    expect(parsed.tags).toEqual(['culture', 'history'])
    expect(parsed.faqs).toEqual([
      { question: 'Q1', answer: 'A1', link: { href: '/faq', label: 'More' } },
      { question: 'Q2', answer: 'A2', link: null },
    ])
    expect(parsed.sold_out).toBe(true)
    expect(parsed.single_supplement_note).toBeNull()
    expect(parsed.rating).toBe(4.8)
    expect(parsed.review_count).toBe(12)
    expect(parsed.review_summary).toBe('Lovely trip')
    expect(parsed.related_blog_slugs).toEqual(['blog-one'])
    expect(parsed.quick_answer).toBeNull()
  })

  it('keeps itinerary extras and drops malformed ones', () => {
    const product = {
      ...OLD_PRODUCT,
      itinerary: [
        {
          day: 1,
          title: 'Arrive',
          description: 'Welcome',
          meals: ['dinner'],
          accommodation: 'Hotel One',
          festiveLabel: 'Lantern Festival',
          operatorLogo: { src: '/images/air.png', alt: 'Sample Air' },
        },
        {
          day: 2,
          title: 'Wall',
          description: 'Climb',
          accommodation: '',
          festiveLabel: 5,
          operatorLogo: { alt: 'No src' },
        },
        {
          day: 3,
          title: 'Fly home',
          description: 'Bye',
          operatorLogo: { src: '/images/air.png', alt: 7 },
        },
      ],
    }
    const feed = parseFirstPartyTourFeed(feedWith([product]))
    expect(feed).not.toBeNull()
    const days = feed!.products[0].itinerary
    expect(days[0].accommodation).toBe('Hotel One')
    expect(days[0].festiveLabel).toBe('Lantern Festival')
    expect(days[0].operatorLogo).toEqual({ src: '/images/air.png', alt: 'Sample Air' })
    expect(days[0].meals).toEqual(['dinner'])
    expect('accommodation' in days[1]).toBe(false)
    expect('festiveLabel' in days[1]).toBe(false)
    expect('operatorLogo' in days[1]).toBe(false)
    expect('operatorLogo' in days[2]).toBe(false)
    expect(Array.isArray(days[2].meals)).toBe(true)
  })

  it('treats wrong types as absent', () => {
    const product = {
      ...OLD_PRODUCT,
      hero_image: 5,
      gallery: 'x',
      tags: null,
      sold_out: 'yes',
      rating: '4.8',
      faqs: 'x',
    }
    const feed = parseFirstPartyTourFeed(feedWith([product]))
    expect(feed).not.toBeNull()
    const parsed = feed!.products[0]
    expect('hero_image' in parsed).toBe(false)
    expect('gallery' in parsed).toBe(false)
    expect('tags' in parsed).toBe(false)
    expect('sold_out' in parsed).toBe(false)
    expect('rating' in parsed).toBe(false)
    expect('faqs' in parsed).toBe(false)
  })

  it('drops faq items without a string answer and nulls malformed links', () => {
    const product = {
      ...OLD_PRODUCT,
      faqs: [
        { question: 'Q1', answer: 'A1', link: { href: '/faq' } },
        { question: 'Q2', link: null },
        { question: 'Q3', answer: 'A3', link: { href: '/faq', label: 'More' } },
      ],
    }
    const feed = parseFirstPartyTourFeed(feedWith([product]))
    expect(feed).not.toBeNull()
    expect(feed!.products[0].faqs).toEqual([
      { question: 'Q1', answer: 'A1', link: null },
      { question: 'Q3', answer: 'A3', link: { href: '/faq', label: 'More' } },
    ])
  })

  it('drops non-string items inside gallery, tags and highlights', () => {
    const product = {
      ...OLD_PRODUCT,
      gallery: ['/images/a.jpg', 5, '', '/images/b.jpg'],
      tags: ['culture', null, 'history'],
      highlights: ['One', 7, 'Two'],
    }
    const feed = parseFirstPartyTourFeed(feedWith([product]))
    expect(feed).not.toBeNull()
    const parsed = feed!.products[0]
    expect(parsed.gallery).toEqual(['/images/a.jpg', '/images/b.jpg'])
    expect(parsed.tags).toEqual(['culture', 'history'])
    expect(parsed.highlights).toEqual(['One', 'Two'])
  })

  it('skips an invalid product and counts it', () => {
    const invalid = { ...OLD_PRODUCT, id: 'p-bad', name: undefined }
    const feed = parseFirstPartyTourFeed(feedWith([OLD_PRODUCT, invalid]))
    expect(feed).not.toBeNull()
    expect(feed!.products.length).toBe(1)
    expect(feed!.skipped_products).toBe(1)
  })
})
