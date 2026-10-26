import { describe, expect, it } from 'vitest'
import { parseFirstPartyTourFeed } from '../first-party-tours'

function rawTour(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    title: 'Sample Tour Title',
    duration: '10 Days',
    price: 'From NZD $4,999 per person',
    is_active: true,
    updated_at: '2026-01-01',
    created_at: '2025-01-01',
    departure_dates: ['13 May 2027'],
    departure_pricing: { '13 May 2027': 'NZD $5,199' },
    tour_cities: ['Beijing'],
    itinerary: [
      { day: 1, title: 'Arrive', description: 'Welcome.', meals: ['Dinner'], accommodation: 'Hotel A' },
      { day: 2, title: 'Depart', description: 'Goodbye.', meals: [], festiveLabel: 'Lantern Festival', operatorLogo: { src: '/images/logo.png', alt: 'Airline' } },
    ],
    inclusions: ['Meals'],
    exclusions: ['Flights'],
    single_supplement: 'NZD $900',
    max_group_size: 16,
    short_description: 'Intro',
    highlights: ['Great Wall'],
    hero_image: '/images/hero.jpg',
    gallery: ['/images/a.jpg'],
    meta_title: 'Meta',
    meta_description: 'Meta description',
    tags: ['culture'],
    faqs: [{ question: 'Q', answer: 'A', link: { href: '/visa', label: 'Visa' } }, { question: 'Q2', answer: 'A2', link: null }],
    sold_out: false,
    single_supplement_note: null,
    rating: 4.8,
    review_count: 12,
    review_summary: null,
    related_blog_slugs: ['a-post'],
    quick_answer: null,
    ...overrides,
  }
}

function notesOf(tour: Record<string, unknown>): string[] {
  const feed = parseFirstPartyTourFeed({ source: 's', source_version: '1', products: [tour] })
  if (feed === null) throw new Error('feed unreadable')
  expect(feed.products.length).toBe(1)
  return feed.parse_notes ?? []
}

function withDay(index: number, change: Record<string, unknown> | string): Record<string, unknown> {
  const tour = rawTour()
  const days = (tour.itinerary as Array<Record<string, unknown>>).map((day) => ({ ...day }))
  if (typeof change === 'string') (days as unknown[])[index] = change
  else days[index] = { ...days[index], ...change }
  return { ...tour, itinerary: days }
}

describe('parseFirstPartyTourFeed leaves a note for everything it drops', () => {
  it('a complete, well-formed tour produces no notes and no parse_notes key', () => {
    const feed = parseFirstPartyTourFeed({ source: 's', source_version: '1', products: [rawTour()] })
    expect(feed).not.toBeNull()
    expect('parse_notes' in (feed ?? {})).toBe(false)
  })

  it('an older feed without the later fields produces no notes', () => {
    const old = rawTour()
    for (const key of ['short_description', 'highlights', 'hero_image', 'gallery', 'tags', 'faqs', 'sold_out', 'rating', 'created_at']) delete old[key]
    expect(notesOf(old)).toEqual([])
  })

  it('notes an unknown top-level field', () => {
    expect(notesOf(rawTour({ video_url: 'https://example.com/v.mp4' }))).toEqual(['unknown_field:sample-tour:video_url'])
  })

  it('notes an unknown key on an itinerary day', () => {
    expect(notesOf(withDay(1, { transport: 'Coach' }))).toEqual(['itinerary_unknown_key:sample-tour:2:transport'])
  })

  it('notes an itinerary day it cannot read, by position', () => {
    expect(notesOf(withDay(1, { title: 42 }))).toEqual(['itinerary_day_unreadable:sample-tour:2'])
    expect(notesOf(withDay(0, 'day one'))).toEqual(['itinerary_day_unreadable:sample-tour:1'])
  })

  it('notes a FAQ it cannot read, and a FAQ link it cannot read', () => {
    const faqs = [{ question: 'Q', answer: 'A', link: null }, { question: 'Q2' }, { question: 'Q3', answer: 'A3', link: 'https://x.example' }]
    expect(notesOf(rawTour({ faqs }))).toEqual(['faq_unreadable:sample-tour:2', 'faq_link_unreadable:sample-tour:3'])
  })

  it('notes blank or non-string items dropped from a list, naming the list', () => {
    expect(notesOf(rawTour({ highlights: ['Great Wall', '   '] }))).toEqual(['list_item_dropped:sample-tour:highlights'])
    expect(notesOf(rawTour({ inclusions: ['Meals', 7] }))).toEqual(['list_item_dropped:sample-tour:inclusions'])
    expect(notesOf(rawTour({ gallery: ['/images/a.jpg', null] }))).toEqual(['list_item_dropped:sample-tour:gallery'])
    expect(notesOf(withDay(0, { meals: ['Dinner', ''] }))).toEqual(['list_item_dropped:sample-tour:itinerary.1.meals'])
    expect(notesOf(rawTour({ departure_pricing: { '13 May 2027': 5199 } }))).toEqual(['list_item_dropped:sample-tour:departure_pricing'])
  })

  it('notes a value sent in a shape it does not take', () => {
    expect(notesOf(rawTour({ rating: '4.8' }))).toEqual(['field_unreadable:sample-tour:rating'])
    expect(notesOf(rawTour({ tags: 'culture' }))).toEqual(['field_unreadable:sample-tour:tags'])
    expect(notesOf(rawTour({ title: 5 }))).toEqual(['field_unreadable:sample-tour:title'])
    expect(notesOf(withDay(1, { operatorLogo: { src: '/images/logo.png' } }))).toEqual(['field_unreadable:sample-tour:itinerary.2.operatorLogo'])
    expect(notesOf(withDay(0, { accommodation: 9 }))).toEqual(['field_unreadable:sample-tour:itinerary.1.accommodation'])
  })

  it('treats an empty accommodation as absent, without a note', () => {
    const feed = parseFirstPartyTourFeed({ source: 's', source_version: '1', products: [withDay(0, { accommodation: '' })] })
    expect(feed?.parse_notes).toBeUndefined()
    expect('accommodation' in (feed?.products[0].itinerary[0] ?? {})).toBe(false)
  })

  it('never echoes markup from the feed into a note', () => {
    const notes = notesOf(rawTour({ slug: '</script><script>alert(1)', '<img src=x>': 1 }))
    expect(notes.length).toBe(1)
    expect(notes[0]).not.toMatch(/[<>"'=() ]/)
  })

  it('does not change what the other readers of the feed get', () => {
    const clean = parseFirstPartyTourFeed({ source: 's', source_version: '1', products: [rawTour()] })
    const noisy = parseFirstPartyTourFeed({ source: 's', source_version: '1', products: [rawTour({ video_url: 'x' })] })
    expect(noisy?.products).toEqual(clean?.products)
  })
})
