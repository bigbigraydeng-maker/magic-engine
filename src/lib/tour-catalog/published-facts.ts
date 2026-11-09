/**
 * Email-facing projection of the PUBLISHED catalog snapshot (never the draft).
 *
 * Visibility is the same as the website feed (output.ts): past departures and sold_out / closed / cancelled
 * departures are dropped, and a tour that manages departures is only sellable while at least one departure
 * is visible. Unlike the feed it also carries highlights and the whole-tour sold-out flag.
 * `internal` departure data never appears here.
 */

import { formatDepartureDisplay } from './dates'
import { visibleDepartures } from './output'
import type { PublishedTourFact, PublishedTourFactDeparture } from './publish-contract'
import type { CatalogDeparture, CatalogTour } from './types'

function sortTours(tours: CatalogTour[]): CatalogTour[] {
  return [...tours].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.name.localeCompare(b.name)
  })
}

function toFactDeparture(departure: CatalogDeparture): PublishedTourFactDeparture {
  const override = departure.priceTextOverride
  return {
    departOn: departure.departOn,
    displayDate: formatDepartureDisplay(departure.departOn),
    status: departure.status === 'limited' ? 'limited' : 'open',
    priceTextOverride: override !== null && override.trim().length > 0 ? override : null,
  }
}

function toPublishedTourFact(
  tour: CatalogTour,
  departures: CatalogDeparture[],
  today: string,
): PublishedTourFact {
  const visible = visibleDepartures(tour.id, departures, today)
  return {
    id: tour.id,
    slug: tour.slug,
    destination: tour.destination,
    tier: tour.tier,
    name: tour.name,
    title: tour.title,
    durationText: tour.durationText,
    displayPriceText: tour.displayPriceText,
    highlights: [...tour.highlights],
    inclusions: [...tour.inclusions],
    exclusions: [...tour.exclusions],
    singleSupplement: tour.singleSupplement,
    soldOut: tour.soldOut,
    managesDepartures: tour.managesDepartures,
    isActive: tour.isActive && (!tour.managesDepartures || visible.length > 0),
    departures: visible.map(toFactDeparture),
  }
}

export function toPublishedTourFacts(
  tours: CatalogTour[],
  departures: CatalogDeparture[],
  today: string,
): PublishedTourFact[] {
  return sortTours(tours).map((tour) => toPublishedTourFact(tour, departures, today))
}
