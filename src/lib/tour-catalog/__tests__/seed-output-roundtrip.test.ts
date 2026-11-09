import { describe, expect, it } from 'vitest'
import {
  parseFirstPartyTourFeed,
  firstPartyTourProducts,
  type FirstPartyTour,
  type FirstPartyTourFeed,
} from '@/lib/web-intelligence/first-party-tours'
import { planSeed, type SeedPlan, type SeedTourRow, type SeedDepartureRow } from '../seed'
import { toFirstPartyTours } from '../output'
import type { CatalogDeparture, CatalogTour } from '../types'
import { EMPTY_TOUR_CONTENT } from './content-fixture'

const CLIENT_ID = 'c1'
const UPDATED_AT = '2026-05-22T00:00:00Z'
const TODAY = '2026-10-10'

/** Build a hand-made feed modelled on real website data. */
function buildFeed(): FirstPartyTourFeed {
  const signature: FirstPartyTour = {
    id: 'sig-1',
    slug: 'grand-china-signature',
    destination: 'china',
    tier: 'signature',
    name: 'Grand China Signature',
    title: 'Grand China Signature Tour',
    duration: '18 Days',
    price: 'NZD $7,999',
    is_active: true,
    updated_at: UPDATED_AT,
    departure_dates: ['13 May 2027', '21 October 2027'],
    departure_pricing: {},
    tour_cities: ['Beijing', 'Xi\'an', 'Shanghai'],
    itinerary: [
      { day: 1, title: 'Arrive Beijing', description: 'Welcome dinner.', meals: ['dinner'] },
      { day: 2, title: 'Great Wall', description: 'Full day excursion.', meals: ['breakfast', 'lunch'] },
    ],
    inclusions: ['Accommodation', 'Daily breakfast'],
    exclusions: ['International flights'],
    single_supplement: 'NZD $1,200',
    max_group_size: 24,
  }

  const discovery: FirstPartyTour = {
    id: 'disc-1',
    slug: 'china-discovery',
    destination: 'china',
    tier: 'discovery',
    name: 'China Discovery',
    title: 'China Discovery Tour',
    duration: '10 Days',
    price: 'From NZD $4,080 per person',
    is_active: true,
    updated_at: UPDATED_AT,
    departure_dates: ['13 May 2027'],
    departure_pricing: { '13 May 2027': 'From NZD $4,080 per person' },
    tour_cities: ['Chengdu', 'Guilin'],
    itinerary: [
      { day: 1, title: 'Arrive Chengdu', description: 'Panda base visit.' },
    ],
    inclusions: ['Accommodation'],
    exclusions: ['Visas'],
    single_supplement: null,
    max_group_size: 16,
  }

  const stopover: FirstPartyTour = {
    id: 'stop-1',
    slug: 'shanghai-stopover',
    destination: 'china',
    tier: 'stopover',
    name: 'Shanghai Stopover',
    title: 'Shanghai Stopover',
    duration: '3 Days',
    price: 'NZD $899',
    is_active: true,
    updated_at: UPDATED_AT,
    departure_dates: [],
    departure_pricing: {},
    tour_cities: ['Shanghai'],
    itinerary: [],
    inclusions: ['Hotel'],
    exclusions: [],
    single_supplement: null,
    max_group_size: null,
  }

  const tbc: FirstPartyTour = {
    id: 'tbc-1',
    slug: 'china-tbc',
    destination: 'china',
    name: 'China TBC',
    title: 'China TBC Tour',
    duration: '12 Days',
    price: 'From NZD $TBC per person',
    is_active: true,
    updated_at: UPDATED_AT,
    departure_dates: [],
    departure_pricing: {},
    tour_cities: ['Beijing'],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    single_supplement: null,
    max_group_size: null,
  }

  return {
    source: 'first-party',
    source_version: '1.0.0',
    products: [signature, discovery, stopover, tbc],
  }
}

/** Convert a seed tour row into a CatalogTour as the DB would store it. */
function toCatalogTour(row: SeedTourRow, index: number): CatalogTour {
  return {
    id: 'tour-' + row.slug,
    clientId: CLIENT_ID,
    slug: row.slug,
    destination: row.destination,
    tier: row.tier,
    name: row.name,
    title: row.title,
    shortDescription: null,
    durationText: row.duration_text,
    displayPriceText: row.display_price_text,
    highlights: [],
    itinerary: row.itinerary as CatalogTour['itinerary'],
    inclusions: row.inclusions,
    exclusions: row.exclusions,
    tourCities: row.tour_cities,
    singleSupplement: row.single_supplement,
    maxGroupSize: row.max_group_size,
    isActive: row.is_active,
    managesDepartures: row.manages_departures,
    sortOrder: index,
    ...EMPTY_TOUR_CONTENT,
    updatedAt: UPDATED_AT,
  }
}

/** Convert a seed departure row into a CatalogDeparture as the DB would store it. */
function toCatalogDeparture(row: SeedDepartureRow, index: number): CatalogDeparture {
  return {
    id: 'dep-' + index,
    tourId: 'tour-' + row.tourKey.split('/').pop(),
    clientId: CLIENT_ID,
    departOn: row.depart_on,
    returnOn: row.return_on,
    priceTextOverride: row.price_text_override,
    status: row.status,
    internal: {},
    updatedAt: UPDATED_AT,
  }
}

/** Materialise a SeedPlan into catalog rows the way the DB writer would. */
function materialise(plan: SeedPlan): { tours: CatalogTour[]; departures: CatalogDeparture[] } {
  const tours = plan.tours.map((row, index) => toCatalogTour(row, index))
  const departures = plan.departures.map((row, index) => toCatalogDeparture(row, index))
  return { tours, departures }
}

/** Find an output product by slug, failing the test when missing. */
function bySlug(products: FirstPartyTour[], slug: string): FirstPartyTour {
  const found = products.find((p) => p.slug === slug)
  if (!found) throw new Error('missing product: ' + slug)
  return found
}

describe('seed -> output roundtrip', () => {
  it('preserves every website feed field through planSeed and toFirstPartyTours', () => {
    const feed = buildFeed()
    const plan = planSeed(feed, new Set())
    const { tours, departures } = materialise(plan)
    const output = toFirstPartyTours(tours, departures, TODAY)

    expect(output).toHaveLength(feed.products.length)

    for (const original of feed.products) {
      const actual = bySlug(output, original.slug)
      expect(actual.name).toBe(original.name)
      expect(actual.title).toBe(original.title)
      expect(actual.duration).toBe(original.duration)
      expect(actual.price).toBe(original.price)
      expect(actual.tier).toBe(original.tier)
      expect(actual.departure_dates).toEqual(original.departure_dates)
      expect(actual.departure_pricing).toEqual(original.departure_pricing)
      expect(actual.tour_cities).toEqual(original.tour_cities)
      expect(actual.itinerary).toEqual(original.itinerary)
      expect(actual.inclusions).toEqual(original.inclusions)
      expect(actual.exclusions).toEqual(original.exclusions)
      expect(actual.single_supplement).toBe(original.single_supplement)
      expect(actual.max_group_size).toBe(original.max_group_size)
      expect(actual.is_active).toBe(original.is_active)
      expect(actual.updated_at).toBe(original.updated_at.slice(0, 10))
    }
  })

  it('produces a feed whose firstPartyTourProducts match the original feed', () => {
    const feed = buildFeed()
    const plan = planSeed(feed, new Set())
    const { tours, departures } = materialise(plan)
    const output = toFirstPartyTours(tours, departures, TODAY)

    const rebuilt = parseFirstPartyTourFeed({
      source: feed.source,
      source_version: feed.source_version,
      products: output,
    })
    expect(rebuilt).not.toBeNull()
    if (rebuilt === null) return

    expect(firstPartyTourProducts(rebuilt)).toEqual(firstPartyTourProducts(feed))
  })

  it('marks a tour inactive when its only departure is in the past (managesDepartures rule)', () => {
    const past: FirstPartyTour = {
      id: 'past-1',
      slug: 'china-past-only',
      destination: 'china',
      tier: 'discovery',
      name: 'China Past Only',
      title: 'China Past Only Tour',
      duration: '8 Days',
      price: 'NZD $3,999',
      is_active: true,
      updated_at: UPDATED_AT,
      departure_dates: ['10 September 2026'],
      departure_pricing: {},
      tour_cities: ['Beijing'],
      itinerary: [],
      inclusions: [],
      exclusions: [],
      single_supplement: null,
      max_group_size: null,
    }
    const feed: FirstPartyTourFeed = {
      source: 'first-party',
      source_version: '1.0.0',
      products: [past],
    }

    const plan = planSeed(feed, new Set())
    const { tours, departures } = materialise(plan)
    const output = toFirstPartyTours(tours, departures, TODAY)

    const actual = bySlug(output, past.slug)
    expect(past.is_active).toBe(true)
    expect(actual.is_active).toBe(false)
    expect(actual.departure_dates).toEqual([])
  })
})
