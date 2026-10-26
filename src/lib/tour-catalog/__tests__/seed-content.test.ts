import { describe, expect, it } from 'vitest'
import { planSeed } from '../seed'
import type { FirstPartyTour, FirstPartyTourFeed } from '@/lib/web-intelligence/first-party-tours'

function baseProduct(overrides: Partial<FirstPartyTour> = {}): FirstPartyTour {
  return {
    id: 'p1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    title: 'Sample Tour Title',
    duration: '10 days',
    price: 'From NZD $4,999 per person',
    is_active: true,
    updated_at: '2026-01-01T00:00:00Z',
    departure_dates: [],
    departure_pricing: {},
    tour_cities: ['Beijing'],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    single_supplement: null,
    max_group_size: null,
    ...overrides,
  }
}

function feed(products: FirstPartyTour[]): FirstPartyTourFeed {
  return { source: 'example', source_version: '1', products }
}

describe('planSeed content columns', () => {
  it('copies new-shape content fields into the tour row', () => {
    const product = baseProduct({
      short_description: 'A short description',
      highlights: ['Great wall'],
      hero_image: '/images/hero.jpg',
      gallery: ['/images/a.jpg'],
      meta_title: 'Meta title',
      meta_description: 'Meta description',
      tags: ['culture'],
      faqs: [{ question: 'Q1', answer: 'A1', link: null }],
      sold_out: true,
      single_supplement_note: 'Limited rooms',
      rating: 4.8,
      review_count: 12,
      review_summary: 'Lovely trip',
      quick_answer: 'A quick answer',
      related_blog_slugs: ['blog-one'],
      itinerary: [
        {
          day: 1,
          title: 'Arrive',
          description: 'Welcome',
          accommodation: 'Hotel One',
          festiveLabel: 'Lantern Festival',
          operatorLogo: { src: '/images/air.png', alt: 'Sample Air' },
        },
      ],
    })
    const plan = planSeed(feed([product]), new Set())
    expect(plan.notes).toEqual([])
    const row = plan.tours[0]
    expect(row.short_description).toBe('A short description')
    expect(row.highlights).toEqual(['Great wall'])
    expect(row.hero_image).toBe('/images/hero.jpg')
    expect(row.gallery).toEqual(['/images/a.jpg'])
    expect(row.meta_title).toBe('Meta title')
    expect(row.meta_description).toBe('Meta description')
    expect(row.tags).toEqual(['culture'])
    expect(row.faqs).toEqual([{ question: 'Q1', answer: 'A1', link: null }])
    expect(row.sold_out).toBe(true)
    expect(row.single_supplement_note).toBe('Limited rooms')
    expect(row.rating).toBe(4.8)
    expect(row.review_count).toBe(12)
    expect(row.review_summary).toBe('Lovely trip')
    expect(row.quick_answer).toBe('A quick answer')
    expect(row.site_extras).toEqual({ related_blog_slugs: ['blog-one'] })
    expect(row.itinerary).toEqual([
      {
        day: 1,
        title: 'Arrive',
        description: 'Welcome',
        accommodation: 'Hotel One',
        festiveLabel: 'Lantern Festival',
        operatorLogo: { src: '/images/air.png', alt: 'Sample Air' },
      },
    ])
  })

  it('fills empty defaults for an old-shape product', () => {
    const plan = planSeed(feed([baseProduct()]), new Set())
    const row = plan.tours[0]
    expect(row.short_description).toBeNull()
    expect(row.highlights).toEqual([])
    expect(row.hero_image).toBeNull()
    expect(row.gallery).toEqual([])
    expect(row.meta_title).toBeNull()
    expect(row.meta_description).toBeNull()
    expect(row.tags).toEqual([])
    expect(row.faqs).toEqual([])
    expect(row.sold_out).toBe(false)
    expect(row.single_supplement_note).toBeNull()
    expect(row.rating).toBeNull()
    expect(row.review_count).toBeNull()
    expect(row.review_summary).toBeNull()
    expect(row.quick_answer).toBeNull()
    expect(row.site_extras).toEqual({})
  })

  it('accepts only site paths and https hero images', () => {
    const empty = planSeed(feed([baseProduct({ hero_image: '' })]), new Set())
    expect(empty.tours[0].hero_image).toBeNull()
    expect(empty.notes).toEqual([])

    const http = planSeed(feed([baseProduct({ hero_image: 'http://img.example.com/a.jpg' })]), new Set())
    expect(http.tours[0].hero_image).toBeNull()
    expect(http.notes.length).toBe(1)
    expect(http.notes[0].note.startsWith('hero_image_rejected:')).toBe(true)

    const long = 'https://img.example.com/' + 'a'.repeat(501)
    const tooLong = planSeed(feed([baseProduct({ hero_image: long })]), new Set())
    expect(tooLong.tours[0].hero_image).toBeNull()
    expect(tooLong.notes.length).toBe(1)
    expect(tooLong.notes[0].note.startsWith('hero_image_rejected:')).toBe(true)

    const sitePath = planSeed(feed([baseProduct({ hero_image: '/images/a.jpg' })]), new Set())
    expect(sitePath.tours[0].hero_image).toBe('/images/a.jpg')

    const https = planSeed(feed([baseProduct({ hero_image: 'https://img.example.com/a.jpg' })]), new Set())
    expect(https.tours[0].hero_image).toBe('https://img.example.com/a.jpg')
  })

  it('accepts gallery images on any host at read-in', () => {
    const product = baseProduct({
      gallery: [
        'https://one.example.com/a.jpg',
        'https://two.example.com/b.jpg',
        'https://three.example.com/c.jpg',
      ],
    })
    const plan = planSeed(feed([product]), new Set())
    expect(plan.tours[0].gallery).toEqual([
      'https://one.example.com/a.jpg',
      'https://two.example.com/b.jpg',
      'https://three.example.com/c.jpg',
    ])
  })
})
