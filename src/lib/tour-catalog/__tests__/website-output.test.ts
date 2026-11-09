import { describe, expect, it } from 'vitest'
import type { CatalogDeparture, CatalogTour } from '../types'
import { toWebsiteTours } from '../website-output'

function makeTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-1',
    clientId: 'client-1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample Tour',
    title: null,
    shortDescription: null,
    durationText: null,
    displayPriceText: null,
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    singleSupplement: null,
    maxGroupSize: null,
    isActive: true,
    managesDepartures: false,
    sortOrder: 0,
    updatedAt: '2027-01-02T03:04:05.000Z',
    heroImage: null,
    gallery: [],
    metaTitle: null,
    metaDescription: null,
    tags: [],
    faqs: [],
    soldOut: false,
    singleSupplementNote: null,
    rating: null,
    reviewCount: null,
    reviewSummary: null,
    quickAnswer: null,
    siteExtras: {},
    ...overrides,
  }
}

function makeDeparture(overrides: Partial<CatalogDeparture> = {}): CatalogDeparture {
  return {
    id: 'dep-1',
    tourId: 'tour-1',
    clientId: 'client-1',
    departOn: '2027-03-05',
    returnOn: null,
    priceTextOverride: null,
    status: 'open',
    internal: {},
    updatedAt: '2027-01-02T03:04:05.000Z',
    ...overrides,
  }
}

describe('toWebsiteTours', () => {
  it('uses empty strings for the seven required strings when null', () => {
    const [tour] = toWebsiteTours([makeTour()], [], '2027-01-01')
    expect(tour.title).toBe('')
    expect(tour.short_description).toBe('')
    expect(tour.duration).toBe('')
    expect(tour.price).toBe('')
    expect(tour.hero_image).toBe('')
    expect(tour.meta_title).toBe('')
    expect(tour.meta_description).toBe('')
  })

  it('keeps is_active and sold_out as stored even with no upcoming departures', () => {
    const tour = makeTour({ isActive: true, soldOut: true, managesDepartures: true })
    const [out] = toWebsiteTours([tour], [], '2027-01-01')
    expect(out.is_active).toBe(true)
    expect(out.sold_out).toBe(true)
  })

  it('leaves out past, sold_out, closed and cancelled departures', () => {
    const departures = [
      makeDeparture({ id: 'past', departOn: '2026-12-31' }),
      makeDeparture({ id: 'sold', departOn: '2027-03-01', status: 'sold_out' }),
      makeDeparture({ id: 'closed', departOn: '2027-03-02', status: 'closed' }),
      makeDeparture({ id: 'cancelled', departOn: '2027-03-03', status: 'cancelled' }),
      makeDeparture({ id: 'open', departOn: '2027-03-04', status: 'open' }),
    ]
    const [out] = toWebsiteTours([makeTour()], departures, '2027-01-01')
    expect(out.departure_dates).toEqual(['4 March 2027'])
  })

  it('formats and sorts departure dates ascending', () => {
    const departures = [
      makeDeparture({ id: 'b', departOn: '2027-03-20' }),
      makeDeparture({ id: 'a', departOn: '2027-03-05' }),
    ]
    const [out] = toWebsiteTours([makeTour()], departures, '2027-01-01')
    expect(out.departure_dates).toEqual(['5 March 2027', '20 March 2027'])
  })

  it('builds departure_pricing only for non-empty overrides', () => {
    const departures = [
      makeDeparture({ id: 'a', departOn: '2027-03-05', priceTextOverride: 'NZD $5,000' }),
      makeDeparture({ id: 'b', departOn: '2027-03-06', priceTextOverride: '   ' }),
      makeDeparture({ id: 'c', departOn: '2027-03-07', priceTextOverride: null }),
    ]
    const [out] = toWebsiteTours([makeTour()], departures, '2027-01-01')
    expect(out.departure_pricing).toEqual({ '5 March 2027': 'NZD $5,000' })
  })

  it('keeps itinerary optional fields only when present and always has meals', () => {
    const tour = makeTour({
      itinerary: [
        { day: 1, title: 'Arrive', description: 'Land' },
        {
          day: 2,
          title: 'Explore',
          description: 'Walk',
          meals: ['breakfast'],
          accommodation: 'Hotel A',
          festiveLabel: 'Festival',
          operatorLogo: { src: '/logo.png', alt: 'Logo' },
        },
      ],
    })
    const [out] = toWebsiteTours([tour], [], '2027-01-01')
    expect(out.itinerary[0]).toEqual({ day: 1, title: 'Arrive', description: 'Land', meals: [] })
    expect(out.itinerary[1]).toEqual({
      day: 2,
      title: 'Explore',
      description: 'Walk',
      meals: ['breakfast'],
      accommodation: 'Hotel A',
      festiveLabel: 'Festival',
      operatorLogo: { src: '/logo.png', alt: 'Logo' },
    })
  })

  it('reads related_blog_slugs from siteExtras and defaults to []', () => {
    const withSlugs = makeTour({ siteExtras: { related_blog_slugs: ['a', 'b', 3] } })
    const withoutSlugs = makeTour({ siteExtras: {} })
    const notArray = makeTour({ siteExtras: { related_blog_slugs: 'nope' } })
    expect(toWebsiteTours([withSlugs], [], '2027-01-01')[0].related_blog_slugs).toEqual(['a', 'b'])
    expect(toWebsiteTours([withoutSlugs], [], '2027-01-01')[0].related_blog_slugs).toEqual([])
    expect(toWebsiteTours([notArray], [], '2027-01-01')[0].related_blog_slugs).toEqual([])
  })

  it('never outputs departure internal data', () => {
    const departures = [
      makeDeparture({ id: 'a', departOn: '2027-03-05', internal: { airline: 'Secret Air', capacity: 20 } }),
    ]
    const [out] = toWebsiteTours([makeTour()], departures, '2027-01-01')
    const json = JSON.stringify(out)
    expect(json).not.toContain('Secret Air')
    expect(json).not.toContain('internal')
  })

  it('sorts tours by sortOrder then name', () => {
    const tours = [
      makeTour({ id: 'b', name: 'Beta', sortOrder: 1 }),
      makeTour({ id: 'a', name: 'Alpha', sortOrder: 0 }),
      makeTour({ id: 'c', name: 'Aardvark', sortOrder: 1 }),
    ]
    const out = toWebsiteTours(tours, [], '2027-01-01')
    expect(out.map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })
})
