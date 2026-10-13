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
  /**
   * Present only when the reader dropped or did not recognise something inside a product it kept:
   * `<code>:<tour slug>:<field…>`. Anything here means the products are NOT the whole feed.
   */
  parse_notes?: string[]
}

/** What the reader is working on, so a dropped value can be reported instead of vanishing. */
type ParseContext = { label: string; notes: string[] }

const TOUR_KEYS: ReadonlySet<string> = new Set([
  'id', 'slug', 'destination', 'tier', 'name', 'title', 'duration', 'price', 'is_active', 'updated_at',
  'departure_dates', 'departure_pricing', 'tour_cities', 'itinerary', 'inclusions', 'exclusions',
  'single_supplement', 'max_group_size', 'created_at', 'short_description', 'highlights', 'hero_image',
  'gallery', 'meta_title', 'meta_description', 'tags', 'faqs', 'sold_out', 'single_supplement_note',
  'rating', 'review_count', 'review_summary', 'related_blog_slugs', 'quick_answer',
])
const DAY_KEYS: ReadonlySet<string> = new Set(['day', 'title', 'description', 'meals', 'accommodation', 'festiveLabel', 'operatorLogo'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Feed-supplied text that goes into a note: short, and letters, digits, '_', '.' and '-' only. */
function noteLabel(value: unknown): string {
  return String(value).slice(0, 60).replace(/[^A-Za-z0-9_.-]/g, '?')
}

function note(ctx: ParseContext | undefined, code: string, ...parts: unknown[]): void {
  if (ctx) ctx.notes.push([code, ctx.label, ...parts.map(noteLabel)].join(':'))
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

function stringArray(value: unknown, ctx?: ParseContext, field?: string): string[] {
  if (!Array.isArray(value)) {
    if (!isAbsent(value)) note(ctx, 'field_unreadable', field)
    return []
  }
  const kept = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (kept.length < value.length) note(ctx, 'list_item_dropped', field)
  return kept
}

/** A scalar the feed sent in a shape the reader does not take: reported, then read as "not there". */
function readScalar<T>(value: unknown, accepts: (v: unknown) => v is T, ctx: ParseContext, field: string): T | undefined {
  if (accepts(value)) return value
  if (!isAbsent(value)) note(ctx, 'field_unreadable', field)
  return undefined
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isNullableNumber = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v))
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function optStringArray(value: unknown, ctx: ParseContext, field: string): string[] | undefined {
  if (Array.isArray(value)) return stringArray(value, ctx, field)
  if (!isAbsent(value)) note(ctx, 'field_unreadable', field)
  return undefined
}

function parseFaqLink(value: unknown, ctx: ParseContext, position: number): FirstPartyFaq['link'] {
  if (isRecord(value) && typeof value.href === 'string' && typeof value.label === 'string') {
    return { href: value.href, label: value.label }
  }
  if (!isAbsent(value)) note(ctx, 'faq_link_unreadable', position)
  return null
}

function parseFaqs(value: unknown, ctx: ParseContext): FirstPartyFaq[] | undefined {
  if (!Array.isArray(value)) {
    if (!isAbsent(value)) note(ctx, 'field_unreadable', 'faqs')
    return undefined
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item) || typeof item.question !== 'string' || typeof item.answer !== 'string') {
      note(ctx, 'faq_unreadable', index + 1)
      return []
    }
    return [{ question: item.question, answer: item.answer, link: parseFaqLink(item.link, ctx, index + 1) }]
  })
}

/** The optional per-day keys; a value in the wrong shape is reported and left out. */
function readDayExtras(item: Record<string, unknown>, day: FirstPartyItineraryDay, ctx: ParseContext): void {
  for (const key of ['accommodation', 'festiveLabel'] as const) {
    const value = readScalar(item[key], isString, ctx, `itinerary.${item.day}.${key}`)
    if (value !== undefined && value !== '') day[key] = value
  }
  const logo = item.operatorLogo
  if (isRecord(logo) && typeof logo.src === 'string' && logo.src !== '' && typeof logo.alt === 'string') {
    day.operatorLogo = { src: logo.src, alt: logo.alt }
  } else if (!isAbsent(logo)) {
    note(ctx, 'field_unreadable', `itinerary.${item.day}.operatorLogo`)
  }
}

function parseItineraryDay(item: unknown, index: number, ctx: ParseContext): FirstPartyItineraryDay[] {
  if (!isRecord(item) || typeof item.day !== 'number' || typeof item.title !== 'string' || typeof item.description !== 'string') {
    note(ctx, 'itinerary_day_unreadable', index + 1)
    return []
  }
  for (const key of Object.keys(item)) {
    if (!DAY_KEYS.has(key)) note(ctx, 'itinerary_unknown_key', item.day, key)
  }
  const day: FirstPartyItineraryDay = {
    day: item.day,
    title: item.title,
    description: item.description,
    meals: stringArray(item.meals, ctx, `itinerary.${item.day}.meals`),
  }
  readDayExtras(item, day, ctx)
  return [day]
}

function parseItinerary(value: unknown, ctx: ParseContext): FirstPartyItineraryDay[] {
  if (!Array.isArray(value)) {
    if (!isAbsent(value)) note(ctx, 'field_unreadable', 'itinerary')
    return []
  }
  return value.flatMap((item, index) => parseItineraryDay(item, index, ctx))
}

function parseDeparturePricing(value: unknown, ctx: ParseContext): Record<string, string> {
  if (!isRecord(value)) {
    if (!isAbsent(value)) note(ctx, 'field_unreadable', 'departure_pricing')
    return {}
  }
  const entries = Object.entries(value)
  const kept = entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  if (kept.length < entries.length) note(ctx, 'list_item_dropped', 'departure_pricing')
  return Object.fromEntries(kept)
}

/** Fields added to the feed later; each stays undefined when the feed does not send it (older feeds). */
function parseContentFields(value: Record<string, unknown>, ctx: ParseContext): Partial<FirstPartyTour> {
  const out: Partial<FirstPartyTour> = {
    created_at: readScalar(value.created_at, isString, ctx, 'created_at'),
    short_description: readScalar(value.short_description, isString, ctx, 'short_description'),
    highlights: optStringArray(value.highlights, ctx, 'highlights'),
    hero_image: readScalar(value.hero_image, isString, ctx, 'hero_image'),
    gallery: optStringArray(value.gallery, ctx, 'gallery'),
    meta_title: readScalar(value.meta_title, isString, ctx, 'meta_title'),
    meta_description: readScalar(value.meta_description, isString, ctx, 'meta_description'),
    tags: optStringArray(value.tags, ctx, 'tags'),
    faqs: parseFaqs(value.faqs, ctx),
    sold_out: readScalar(value.sold_out, isBoolean, ctx, 'sold_out'),
    single_supplement_note: readScalar(value.single_supplement_note, isNullableString, ctx, 'single_supplement_note'),
    rating: readScalar(value.rating, isNullableNumber, ctx, 'rating'),
    review_count: readScalar(value.review_count, isNullableNumber, ctx, 'review_count'),
    review_summary: readScalar(value.review_summary, isNullableString, ctx, 'review_summary'),
    related_blog_slugs: optStringArray(value.related_blog_slugs, ctx, 'related_blog_slugs'),
    quick_answer: readScalar(value.quick_answer, isNullableString, ctx, 'quick_answer'),
  }
  for (const key of Object.keys(out) as Array<keyof FirstPartyTour>) {
    if (out[key] === undefined) delete out[key]
  }
  return out
}

function parseTour(value: unknown, notes: string[]): FirstPartyTour | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.destination !== 'string') return null
  if (typeof value.updated_at !== 'string' || typeof value.is_active !== 'boolean') return null
  const ctx: ParseContext = { label: noteLabel(typeof value.slug === 'string' ? value.slug : value.id), notes }
  for (const key of Object.keys(value)) {
    if (!TOUR_KEYS.has(key)) note(ctx, 'unknown_field', key)
  }
  return {
    id: value.id,
    slug: readScalar(value.slug, isString, ctx, 'slug') ?? value.id,
    destination: value.destination,
    tier: readScalar(value.tier, isString, ctx, 'tier'),
    name: value.name,
    title: readScalar(value.title, isString, ctx, 'title'),
    duration: readScalar(value.duration, isString, ctx, 'duration'),
    price: readScalar(value.price, isString, ctx, 'price'),
    is_active: value.is_active,
    updated_at: value.updated_at,
    departure_dates: stringArray(value.departure_dates, ctx, 'departure_dates'),
    departure_pricing: parseDeparturePricing(value.departure_pricing, ctx),
    tour_cities: stringArray(value.tour_cities, ctx, 'tour_cities'),
    itinerary: parseItinerary(value.itinerary, ctx),
    inclusions: stringArray(value.inclusions, ctx, 'inclusions'),
    exclusions: stringArray(value.exclusions, ctx, 'exclusions'),
    single_supplement: readScalar(value.single_supplement, isString, ctx, 'single_supplement') ?? null,
    max_group_size: readScalar(value.max_group_size, isFiniteNumber, ctx, 'max_group_size') ?? null,
    ...parseContentFields(value, ctx),
  }
}

export function parseFirstPartyTourFeed(value: unknown): FirstPartyTourFeed | null {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.source_version !== 'string' || !Array.isArray(value.products)) return null
  const notes: string[] = []
  const products = value.products.flatMap(item => {
    const tour = parseTour(item, notes)
    return tour ? [tour] : []
  })
  const skipped = value.products.length - products.length
  return {
    source: value.source,
    source_version: value.source_version,
    products,
    ...(skipped > 0 ? { skipped_products: skipped } : {}),
    ...(notes.length > 0 ? { parse_notes: notes } : {}),
  }
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
