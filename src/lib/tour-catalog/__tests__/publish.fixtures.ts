/**
 * Shared builders for the publish.ts tests (split to stay under the 800-line limit).
 */
import type { CatalogContent } from '../publish'
import type { CatalogDeparture, CatalogItineraryDay, CatalogTour } from '../types'
import { EMPTY_TOUR_CONTENT } from './content-fixture'

export const today = '2026-10-10'

export function tour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 't1',
    clientId: 'c1',
    slug: 's1',
    destination: 'china',
    tier: 'discovery',
    name: 'Golden China',
    title: null,
    shortDescription: null,
    durationText: '10 days',
    displayPriceText: 'From NZD $4,999 per person',
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    singleSupplement: null,
    maxGroupSize: null,
    isActive: true,
    managesDepartures: true,
    sortOrder: 1,
    ...EMPTY_TOUR_CONTENT,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function departure(overrides: Partial<CatalogDeparture> = {}): CatalogDeparture {
  return {
    id: 'd1',
    tourId: 't1',
    clientId: 'c1',
    departOn: '2027-03-11',
    returnOn: '2027-03-25',
    priceTextOverride: null,
    status: 'open',
    internal: {},
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

export function toSnapshot(content: CatalogContent): Record<string, unknown> {
  return {
    schema_version: 1,
    tours: content.tours.map((t) => ({
      id: t.id,
      client_id: t.clientId,
      slug: t.slug,
      destination: t.destination,
      tier: t.tier,
      name: t.name,
      title: t.title,
      short_description: t.shortDescription,
      duration_text: t.durationText,
      display_price_text: t.displayPriceText,
      highlights: t.highlights,
      itinerary: t.itinerary,
      inclusions: t.inclusions,
      exclusions: t.exclusions,
      tour_cities: t.tourCities,
      single_supplement: t.singleSupplement,
      max_group_size: t.maxGroupSize,
      is_active: t.isActive,
      manages_departures: t.managesDepartures,
      sort_order: t.sortOrder,
      updated_at: t.updatedAt,
    })),
    departures: content.departures.map((d) => ({
      id: d.id,
      tour_id: d.tourId,
      client_id: d.clientId,
      depart_on: d.departOn,
      return_on: d.returnOn,
      price_text_override: d.priceTextOverride,
      status: d.status,
      updated_at: d.updatedAt,
    })),
  }
}

export function day(overrides: Partial<CatalogItineraryDay> = {}): CatalogItineraryDay {
  return { day: 1, title: 'Arrive', description: 'Welcome', ...overrides }
}

export function richDraft(): CatalogContent {
  return {
    tours: [
      tour({
        id: 't1',
        name: 'Golden China',
        itinerary: [day({ day: 1, title: 'Arrive', description: 'Welcome', meals: ['dinner'] })],
      }),
      tour({ id: 't2', name: 'Silk Road', sortOrder: 2 }),
    ],
    departures: [
      departure({ id: 'd1', tourId: 't1', departOn: '2027-03-11', internal: { airline: 'CA' } }),
      departure({ id: 'd2', tourId: 't1', departOn: '2027-04-11' }),
      departure({ id: 'd3', tourId: 't2', departOn: '2027-05-11' }),
    ],
  }
}
