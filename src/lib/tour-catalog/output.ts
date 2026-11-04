import type { FirstPartyTour } from '@/lib/web-intelligence/first-party-tours'
import type { CatalogDeparture, CatalogTour } from './types'
import { formatDepartureDisplay } from './dates'

/** Statuses that make a departure visible in the outward-facing feed. */
const VISIBLE_STATUSES: ReadonlySet<CatalogDeparture['status']> = new Set(['open', 'limited'])

/** Sort tours by sortOrder ascending, then by name ascending. */
function sortTours(tours: CatalogTour[]): CatalogTour[] {
  return [...tours].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.name.localeCompare(b.name)
  })
}

/** Departures of a tour that are on/after `today`, visible, sorted ascending by departOn. */
export function visibleDepartures(
  tourId: string,
  departures: CatalogDeparture[],
  today: string,
): CatalogDeparture[] {
  return departures
    .filter((d) => d.tourId === tourId && d.departOn >= today && VISIBLE_STATUSES.has(d.status))
    .sort((a, b) => (a.departOn < b.departOn ? -1 : a.departOn > b.departOn ? 1 : 0))
}

/** Map formatted departure dates to non-empty price overrides. */
function buildDeparturePricing(visible: CatalogDeparture[]): Record<string, string> {
  const pricing: Record<string, string> = {}
  for (const departure of visible) {
    const override = departure.priceTextOverride
    if (override !== null && override.trim().length > 0) {
      pricing[formatDepartureDisplay(departure.departOn)] = override
    }
  }
  return pricing
}

/** Copy itinerary days, preserving meals only when present. */
function copyItinerary(tour: CatalogTour): FirstPartyTour['itinerary'] {
  return tour.itinerary.map((day) => {
    const copy: FirstPartyTour['itinerary'][number] = {
      day: day.day,
      title: day.title,
      description: day.description,
    }
    if (day.meals !== undefined) copy.meals = [...day.meals]
    return copy
  })
}

/** Map a single catalog tour (plus its departures) to a first-party tour. */
function toFirstPartyTour(
  tour: CatalogTour,
  departures: CatalogDeparture[],
  today: string,
): FirstPartyTour {
  const visible = visibleDepartures(tour.id, departures, today)
  const departureDates = visible.map((d) => formatDepartureDisplay(d.departOn))
  const hasVisible = visible.length > 0
  const isActive = tour.isActive && (!tour.managesDepartures || hasVisible)

  return {
    id: tour.id,
    slug: tour.slug,
    destination: tour.destination,
    tier: tour.tier === 'unknown' ? undefined : tour.tier,
    name: tour.name,
    title: tour.title ?? undefined,
    duration: tour.durationText ?? undefined,
    price: tour.displayPriceText ?? undefined,
    is_active: isActive,
    updated_at: tour.updatedAt.slice(0, 10),
    departure_dates: departureDates,
    departure_pricing: buildDeparturePricing(visible),
    tour_cities: [...tour.tourCities],
    itinerary: copyItinerary(tour),
    inclusions: [...tour.inclusions],
    exclusions: [...tour.exclusions],
    single_supplement: tour.singleSupplement,
    max_group_size: tour.maxGroupSize,
  }
}

/**
 * Project catalog tours and departures into the first-party feed shape.
 * `internal` departure data is never included in the output.
 */
export function toFirstPartyTours(
  tours: CatalogTour[],
  departures: CatalogDeparture[],
  today: string,
): FirstPartyTour[] {
  return sortTours(tours).map((tour) => toFirstPartyTour(tour, departures, today))
}
