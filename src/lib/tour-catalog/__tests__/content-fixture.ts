import type { TourPatchContext } from '../content-validation'
import type { CatalogTour } from '../types'

/** The content columns of design §6.11.1 in their "nothing filled in" state. */
export const EMPTY_TOUR_CONTENT = {
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
} satisfies Partial<CatalogTour>

export function blankTour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 'tour-blank',
    clientId: 'client-1',
    slug: 'sample-tour',
    destination: 'china',
    tier: 'classic',
    name: 'Sample tour',
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
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...EMPTY_TOUR_CONTENT,
    ...overrides,
  }
}

/** A global admin saving a blank tour of a client with no domain and no extra image hosts. */
export function patchContext(overrides: Partial<TourPatchContext> = {}): TourPatchContext {
  return {
    canEditSite: true,
    imagePool: new Set<string>(),
    imageHosts: [],
    clientDomain: null,
    existingTour: blankTour(),
    ...overrides,
  }
}
