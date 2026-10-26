import type { CatalogFaq } from './catalog-contract'
import type { CatalogDeparture, CatalogTour } from './types'
import { formatDepartureDisplay } from './dates'

export interface WebsiteItineraryDay {
  day: number
  title: string
  description: string
  meals: string[]
  accommodation?: string
  festiveLabel?: string
  operatorLogo?: { src: string; alt: string }
}

export interface WebsiteTour {
  id: string
  slug: string
  destination: string
  tier: string
  name: string
  title: string
  short_description: string
  duration: string
  price: string
  hero_image: string
  meta_title: string
  meta_description: string
  is_active: boolean
  sold_out: boolean
  updated_at: string
  departure_dates: string[]
  departure_pricing: Record<string, string>
  tour_cities: string[]
  highlights: string[]
  itinerary: WebsiteItineraryDay[]
  inclusions: string[]
  exclusions: string[]
  gallery: string[]
  tags: string[]
  faqs: CatalogFaq[]
  single_supplement: string | null
  single_supplement_note: string | null
  max_group_size: number | null
  rating: number | null
  review_count: number | null
  review_summary: string | null
  related_blog_slugs: string[]
  quick_answer: string | null
}

/** Statuses that make a departure visible in the outward-facing feed. */
const VISIBLE_STATUSES: ReadonlySet<CatalogDeparture['status']> = new Set(['open', 'limited'])

/** Sort tours by sortOrder ascending, then by name ascending. */
function sortTours(tours: readonly CatalogTour[]): CatalogTour[] {
  return [...tours].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.name.localeCompare(b.name)
  })
}

/** Departures of a tour that are on/after `today`, visible, sorted ascending by departOn. */
function visibleDepartures(
  tourId: string,
  departures: readonly CatalogDeparture[],
  today: string,
): CatalogDeparture[] {
  return departures
    .filter((d) => d.tourId === tourId && d.departOn >= today && VISIBLE_STATUSES.has(d.status))
    .sort((a, b) => (a.departOn < b.departOn ? -1 : a.departOn > b.departOn ? 1 : 0))
}

/** Map formatted departure dates to non-empty price overrides. */
function buildDeparturePricing(visible: readonly CatalogDeparture[]): Record<string, string> {
  const pricing: Record<string, string> = {}
  for (const departure of visible) {
    const override = departure.priceTextOverride
    if (override !== null && override.trim().length > 0) {
      pricing[formatDepartureDisplay(departure.departOn)] = override
    }
  }
  return pricing
}

/** Copy one itinerary day, keeping optional fields only when present. */
function copyItineraryDay(day: CatalogTour['itinerary'][number]): WebsiteItineraryDay {
  const copy: WebsiteItineraryDay = {
    day: day.day,
    title: day.title,
    description: day.description,
    meals: day.meals === undefined ? [] : [...day.meals],
  }
  if (day.accommodation !== undefined) copy.accommodation = day.accommodation
  if (day.festiveLabel !== undefined) copy.festiveLabel = day.festiveLabel
  if (day.operatorLogo !== undefined) {
    copy.operatorLogo = { src: day.operatorLogo.src, alt: day.operatorLogo.alt }
  }
  return copy
}

/** Copy one FAQ, keeping the link shape. */
function copyFaq(faq: CatalogFaq): CatalogFaq {
  return {
    question: faq.question,
    answer: faq.answer,
    link: faq.link === null ? null : { href: faq.link.href, label: faq.link.label },
  }
}

/** Read related_blog_slugs from siteExtras, keeping only string items. */
function relatedBlogSlugs(tour: CatalogTour): string[] {
  const value = tour.siteExtras.related_blog_slugs
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** Map a single catalog tour (plus its departures) to the website shape. */
function toWebsiteTour(
  tour: CatalogTour,
  departures: readonly CatalogDeparture[],
  today: string,
): WebsiteTour {
  const visible = visibleDepartures(tour.id, departures, today)
  return {
    id: tour.id,
    slug: tour.slug,
    destination: tour.destination,
    tier: tour.tier,
    name: tour.name,
    title: tour.title ?? '',
    short_description: tour.shortDescription ?? '',
    duration: tour.durationText ?? '',
    price: tour.displayPriceText ?? '',
    hero_image: tour.heroImage ?? '',
    meta_title: tour.metaTitle ?? '',
    meta_description: tour.metaDescription ?? '',
    is_active: tour.isActive,
    sold_out: tour.soldOut,
    updated_at: tour.updatedAt.slice(0, 10),
    departure_dates: visible.map((d) => formatDepartureDisplay(d.departOn)),
    departure_pricing: buildDeparturePricing(visible),
    tour_cities: [...tour.tourCities],
    highlights: [...tour.highlights],
    itinerary: tour.itinerary.map(copyItineraryDay),
    inclusions: [...tour.inclusions],
    exclusions: [...tour.exclusions],
    gallery: [...tour.gallery],
    tags: [...tour.tags],
    faqs: tour.faqs.map(copyFaq),
    single_supplement: tour.singleSupplement,
    single_supplement_note: tour.singleSupplementNote,
    max_group_size: tour.maxGroupSize,
    rating: tour.rating,
    review_count: tour.reviewCount,
    review_summary: tour.reviewSummary,
    related_blog_slugs: relatedBlogSlugs(tour),
    quick_answer: tour.quickAnswer,
  }
}

/**
 * Project catalog tours and departures into the website feed shape.
 * `internal` departure data is never included in the output.
 */
export function toWebsiteTours(
  tours: readonly CatalogTour[],
  departures: readonly CatalogDeparture[],
  today: string,
): WebsiteTour[] {
  return sortTours(tours).map((tour) => toWebsiteTour(tour, departures, today))
}
