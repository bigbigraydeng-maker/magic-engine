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
  itinerary: Array<{ day: number; title: string; description: string; meals?: string[] }>
  inclusions: string[]
  exclusions: string[]
  single_supplement?: string | null
  max_group_size?: number | null
}

export type FirstPartyTourFeed = {
  source: string
  source_version: string
  products: FirstPartyTour[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function parseTour(value: unknown): FirstPartyTour | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.destination !== 'string') return null
  if (typeof value.updated_at !== 'string' || typeof value.is_active !== 'boolean') return null
  const itinerary = Array.isArray(value.itinerary) ? value.itinerary.flatMap(item => {
    if (!isRecord(item) || typeof item.day !== 'number' || typeof item.title !== 'string' || typeof item.description !== 'string') return []
    return [{ day: item.day, title: item.title, description: item.description, meals: stringArray(item.meals) }]
  }) : []
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
  }
}

export function parseFirstPartyTourFeed(value: unknown): FirstPartyTourFeed | null {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.source_version !== 'string' || !Array.isArray(value.products)) return null
  return { source: value.source, source_version: value.source_version, products: value.products.flatMap(item => {
    const tour = parseTour(item)
    return tour ? [tour] : []
  }) }
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
