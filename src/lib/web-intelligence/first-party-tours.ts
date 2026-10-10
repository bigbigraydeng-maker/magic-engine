export type FirstPartyTour = {
  id: string
  slug: string
  destination: string
  tier?: string
  name: string
  title?: string
  duration?: string
  price?: string
  is_active: boolean
  updated_at: string
  departure_dates: string[]
  departure_pricing: Record<string, string>
  tour_cities: string[]
  itinerary: FirstPartyItineraryDay[]
  inclusions: string[]
  exclusions: string[]
  single_supplement?: string | null
  max_group_size?: number | null
  created_at?: string
  short_description?: string
  highlights?: string[]
  hero_image?: string
  gallery?: string[]
  meta_title?: string
  meta_description?: string
  tags?: string[]
  faqs?: FirstPartyFaq[]
  sold_out?: boolean
  single_supplement_note?: string | null
  rating?: number | null
  review_count?: number | null
  review_summary?: string | null
  related_blog_slugs?: string[]
  quick_answer?: string | null
}

export type FirstPartyItineraryDay = {
  day: number
  title: string
  description: string
  meals?: string[]
  accommodation?: string
  festiveLabel?: string
  operatorLogo?: { src: string; alt: string }
}

export type FirstPartyFaq = { question: string; answer: string; link: { href: string; label: string } | null }

export type FirstPartyTourFeed = {
  source: string
  source_version: string
  products: FirstPartyTour[]
  /** Present (and > 0) only when some products could not be read and were left out. */
  skipped_products?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function optString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optNullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

function optNullableNumber(value: unknown): number | null | undefined {
  return value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined
}

function optStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? stringArray(value) : undefined
}

function parseFaqs(value: unknown): FirstPartyFaq[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.question !== 'string' || typeof item.answer !== 'string') return []
    const link = isRecord(item.link) && typeof item.link.href === 'string' && typeof item.link.label === 'string'
      ? { href: item.link.href, label: item.link.label }
      : null
    return [{ question: item.question, answer: item.answer, link }]
  })
}

function parseItineraryDay(item: unknown): FirstPartyItineraryDay[] {
  if (!isRecord(item) || typeof item.day !== 'number' || typeof item.title !== 'string' || typeof item.description !== 'string') return []
  const day: FirstPartyItineraryDay = { day: item.day, title: item.title, description: item.description, meals: stringArray(item.meals) }
  if (typeof item.accommodation === 'string' && item.accommodation !== '') day.accommodation = item.accommodation
  if (typeof item.festiveLabel === 'string' && item.festiveLabel !== '') day.festiveLabel = item.festiveLabel
  const logo = item.operatorLogo
  if (isRecord(logo) && typeof logo.src === 'string' && logo.src !== '' && typeof logo.alt === 'string') {
    day.operatorLogo = { src: logo.src, alt: logo.alt }
  }
  return [day]
}

/** Fields added to the feed later; each stays undefined when the feed does not send it (older feeds). */
function parseContentFields(value: Record<string, unknown>): Partial<FirstPartyTour> {
  const out: Partial<FirstPartyTour> = {
    created_at: optString(value.created_at),
    short_description: optString(value.short_description),
    highlights: optStringArray(value.highlights),
    hero_image: optString(value.hero_image),
    gallery: optStringArray(value.gallery),
    meta_title: optString(value.meta_title),
    meta_description: optString(value.meta_description),
    tags: optStringArray(value.tags),
    faqs: parseFaqs(value.faqs),
    sold_out: typeof value.sold_out === 'boolean' ? value.sold_out : undefined,
    single_supplement_note: optNullableString(value.single_supplement_note),
    rating: optNullableNumber(value.rating),
    review_count: optNullableNumber(value.review_count),
    review_summary: optNullableString(value.review_summary),
    related_blog_slugs: optStringArray(value.related_blog_slugs),
    quick_answer: optNullableString(value.quick_answer),
  }
  for (const key of Object.keys(out) as Array<keyof FirstPartyTour>) {
    if (out[key] === undefined) delete out[key]
  }
  return out
}

function parseTour(value: unknown): FirstPartyTour | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.destination !== 'string') return null
  if (typeof value.updated_at !== 'string' || typeof value.is_active !== 'boolean') return null
  const itinerary = Array.isArray(value.itinerary) ? value.itinerary.flatMap(parseItineraryDay) : []
  const departurePricing = isRecord(value.departure_pricing)
    ? Object.fromEntries(Object.entries(value.departure_pricing).filter(([, item]) => typeof item === 'string')) as Record<string, string>
    : {}
  return {
    id: value.id,
    slug: typeof value.slug === 'string' ? value.slug : value.id,
    destination: value.destination,
    tier: typeof value.tier === 'string' ? value.tier : undefined,
    name: value.name,
    title: typeof value.title === 'string' ? value.title : undefined,
    duration: typeof value.duration === 'string' ? value.duration : undefined,
    price: typeof value.price === 'string' ? value.price : undefined,
    is_active: value.is_active,
    updated_at: value.updated_at,
    departure_dates: stringArray(value.departure_dates),
    departure_pricing: departurePricing,
    tour_cities: stringArray(value.tour_cities),
    itinerary,
    inclusions: stringArray(value.inclusions),
    exclusions: stringArray(value.exclusions),
    single_supplement: typeof value.single_supplement === 'string' ? value.single_supplement : null,
    max_group_size: typeof value.max_group_size === 'number' ? value.max_group_size : null,
    ...parseContentFields(value),
  }
}

export function parseFirstPartyTourFeed(value: unknown): FirstPartyTourFeed | null {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.source_version !== 'string' || !Array.isArray(value.products)) return null
  const products = value.products.flatMap(item => {
    const tour = parseTour(item)
    return tour ? [tour] : []
  })
  const skipped = value.products.length - products.length
  return { source: value.source, source_version: value.source_version, products, ...(skipped > 0 ? { skipped_products: skipped } : {}) }
}

function sourceMap(): Record<string, string> {
  try {
    const raw = process.env.WEB_INTELLIGENCE_FIRST_PARTY_TOUR_SOURCES
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string> : {}
  } catch {
    return {}
  }
}

export function firstPartyTourSourceUrl(domain: string | null): string | null {
  if (!domain) return null
  const url = sourceMap()[domain]
  if (!url || !/^https:\/\/[^\s]+$/i.test(url)) return null
  return url
}

function durationDays(duration: string | undefined): number | undefined {
  const value = Number(duration?.match(/\d+/)?.[0])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function firstPartyTourProducts(feed: FirstPartyTourFeed): Array<{ name: string; destination?: string; route?: string; duration_days?: number; price?: string; departure_window?: string; includes?: string; positioning?: string }> {
  return feed.products.filter(product => product.is_active).map(product => ({
    name: product.title || product.name,
    destination: product.destination,
    route: product.tour_cities.length ? product.tour_cities.join(' → ') : undefined,
    duration_days: durationDays(product.duration),
    price: product.price,
    departure_window: product.departure_dates.length ? product.departure_dates.join('；') : undefined,
    includes: product.inclusions.length ? product.inclusions.join('；') : undefined,
    positioning: product.tier,
  }))
}

export async function loadFirstPartyTourProducts(domain: string | null): Promise<Array<{ name: string; destination?: string; route?: string; duration_days?: number; price?: string; departure_window?: string; includes?: string; positioning?: string }>> {
  const url = firstPartyTourSourceUrl(domain)
  if (!url) return []
  try {
    const response = await fetch(url, { next: { revalidate: 3600 } })
    if (!response.ok) return []
    const feed = parseFirstPartyTourFeed(await response.json() as unknown)
    return feed ? firstPartyTourProducts(feed) : []
  } catch {
    return []
  }
}
