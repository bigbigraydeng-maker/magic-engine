/**
 * The comparison report must not come out clean when the feed reader threw something away:
 * what the reader drops never reaches the comparison, so it has to surface as a note instead.
 * Each case mutates the website feed AFTER the catalog was read in from the clean one.
 */
import { describe, expect, it } from 'vitest'
import { parseFirstPartyTourFeed, type FirstPartyTourFeed } from '@/lib/web-intelligence/first-party-tours'
import { planSeed, tourKey } from '../seed'
import { mapDepartureRow, mapTourRow } from '../store'
import { toWebsiteTours, type WebsiteTour } from '../website-output'
import { diffWebsiteVsCatalog, feedReadNotes } from '../site-diff'

const TODAY = '2026-10-10'
const STAMP = '2026-10-10T00:00:00Z'

type Raw = Record<string, unknown>

function rawTour(): Raw {
  return {
    id: 't1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    title: 'Sample Tour Title',
    duration: '3 Days',
    price: 'From NZD $4,999 per person',
    is_active: true,
    updated_at: '2026-01-01',
    departure_dates: ['13 May 2027'],
    departure_pricing: {},
    tour_cities: ['Beijing'],
    itinerary: [
      { day: 1, title: 'Arrive', description: 'Welcome.', meals: ['Dinner'], accommodation: 'Hotel A' },
      { day: 2, title: 'Explore', description: 'Walk.', meals: ['Breakfast'], accommodation: 'Hotel B' },
      { day: 3, title: 'Depart', description: 'Goodbye.', meals: [] },
    ],
    inclusions: ['Meals', 'Guide'],
    exclusions: ['Flights'],
    single_supplement: 'NZD $900',
    max_group_size: 16,
    short_description: 'Intro',
    highlights: ['Great Wall', 'Forbidden City'],
    hero_image: '/images/hero.jpg',
    gallery: ['/images/a.jpg'],
    meta_title: 'Meta',
    meta_description: 'Meta description',
    tags: ['culture'],
    faqs: [{ question: 'Q1', answer: 'A1', link: null }, { question: 'Q2', answer: 'A2', link: null }],
    sold_out: false,
    single_supplement_note: null,
    rating: null,
    review_count: null,
    review_summary: null,
    related_blog_slugs: [],
    quick_answer: null,
  }
}

function parse(tour: Raw): FirstPartyTourFeed {
  const feed = parseFirstPartyTourFeed({ source: 's', source_version: '1', products: [tour] })
  if (feed === null) throw new Error('feed unreadable')
  return feed
}

/** The catalog as it stands after reading the clean feed in, in website shape. */
function catalogFromCleanFeed(): WebsiteTour[] {
  const plan = planSeed(parse(rawTour()), new Set())
  expect(plan.notes).toEqual([])
  const ids = new Map<string, string>()
  const tours = plan.tours.map((row, index) => {
    ids.set(tourKey(row), 'tour-' + index)
    return mapTourRow({ ...row, id: 'tour-' + index, client_id: 'c', sort_order: index, updated_at: STAMP })
  })
  const departures = plan.departures.map((row, index) =>
    mapDepartureRow({ ...row, id: 'dep-' + index, client_id: 'c', tour_id: ids.get(row.tourKey), internal: {}, updated_at: STAMP }),
  )
  return toWebsiteTours(tours, departures, TODAY)
}

function report(tour: Raw): { notes: string[]; differences: string[] } {
  const feed = parse(tour)
  const diff = diffWebsiteVsCatalog(feed.products, catalogFromCleanFeed(), TODAY)
  return { notes: feedReadNotes(feed), differences: diff.differences.map((entry) => entry.fieldLabel) }
}

function days(tour: Raw): Raw[] {
  return (tour.itinerary as Raw[]).map((day) => ({ ...day }))
}

describe('comparison report: what the reader drops shows up as a note', () => {
  it('is clean for the unchanged website feed', () => {
    expect(report(rawTour())).toEqual({ notes: [], differences: [] })
  })

  it('1. a day gains a key the reader does not know', () => {
    const tour = rawTour()
    const itinerary = days(tour)
    itinerary[1].transport = 'High-speed train'
    const result = report({ ...tour, itinerary })
    expect(result.differences).toEqual([])
    expect(result.notes).toEqual(['(feed)：itinerary_unknown_key:sample-tour:2:transport'])
  })

  it('2. the tour gains a top-level field the reader does not know', () => {
    const result = report({ ...rawTour(), video_url: 'https://example.com/v.mp4' })
    expect(result.differences).toEqual([])
    expect(result.notes).toEqual(['(feed)：unknown_field:sample-tour:video_url'])
  })

  it('3. a day the reader cannot read', () => {
    const tour = rawTour()
    const itinerary = days(tour)
    itinerary[2].description = null
    const result = report({ ...tour, itinerary })
    expect(result.notes).toEqual(['(feed)：itinerary_day_unreadable:sample-tour:3'])
    expect(result.differences).toEqual(['行程 第 3 天'])
  })

  it('4. a FAQ the reader cannot read', () => {
    const tour = rawTour()
    const faqs = [...(tour.faqs as Raw[]), { question: 'Q3', answer: 42 }]
    const result = report({ ...tour, faqs })
    expect(result.differences).toEqual([])
    expect(result.notes).toEqual(['(feed)：faq_unreadable:sample-tour:3'])
  })

  it('5. a list with a blank or non-string item mixed in', () => {
    const blank = report({ ...rawTour(), highlights: ['Great Wall', 'Forbidden City', '  '] })
    expect(blank.differences).toEqual([])
    expect(blank.notes).toEqual(['(feed)：list_item_dropped:sample-tour:highlights'])
    const nonString = report({ ...rawTour(), inclusions: ['Meals', 'Guide', { text: 'Tips' }] })
    expect(nonString.differences).toEqual([])
    expect(nonString.notes).toEqual(['(feed)：list_item_dropped:sample-tour:inclusions'])
  })

  it('6. an accommodation cleared to an empty string is still reported as a difference', () => {
    const tour = rawTour()
    const itinerary = days(tour)
    itinerary[0].accommodation = ''
    const result = report({ ...tour, itinerary })
    expect(result.notes).toEqual([])
    expect(result.differences).toEqual(['行程 第 1 天'])
  })
})
