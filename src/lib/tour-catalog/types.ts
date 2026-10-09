/**
 * Tour catalog — shared types (L2 travel-industry capability, client data lives in DB rows).
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md
 *
 * Display-layer catalog only: no orders, payments, seat counts or formal quotes.
 */

export type DepartureStatus = 'open' | 'limited' | 'sold_out' | 'closed' | 'cancelled'

export const DEPARTURE_STATUSES: readonly DepartureStatus[] = [
  'open',
  'limited',
  'sold_out',
  'closed',
  'cancelled',
]

export interface CatalogItineraryDay {
  day: number
  title: string
  description: string
  meals?: string[]
}

export interface CatalogTour {
  id: string
  clientId: string
  slug: string
  destination: string
  tier: string
  name: string
  title: string | null
  shortDescription: string | null
  /** Kept as a string like "10 days" — the first-party feed contract parses the digits. */
  durationText: string | null
  /** Display string only, e.g. "From NZD $4,999 per person". Never used for arithmetic. */
  displayPriceText: string | null
  highlights: string[]
  itinerary: CatalogItineraryDay[]
  inclusions: string[]
  exclusions: string[]
  tourCities: string[]
  singleSupplement: string | null
  maxGroupSize: number | null
  isActive: boolean
  /** True when departures are managed in the catalog; false for tours without fixed departures. */
  managesDepartures: boolean
  sortOrder: number
  updatedAt: string
}

export interface CatalogDepartureInternal {
  airline?: string
  capacity?: number
  outboundRoute?: string
  inboundRoute?: string
}

export interface CatalogDeparture {
  id: string
  tourId: string
  clientId: string
  /** Calendar day, YYYY-MM-DD, no timezone. */
  departOn: string
  returnOn: string | null
  priceTextOverride: string | null
  status: DepartureStatus
  /** Operational facts. Must never appear in any outward-facing output. */
  internal: CatalogDepartureInternal
  updatedAt: string
}

export interface CatalogAlias {
  aliasNorm: string
  tourId: string
}
