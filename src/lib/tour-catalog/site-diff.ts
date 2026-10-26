import type { FirstPartyTour, FirstPartyTourFeed } from '@/lib/web-intelligence/first-party-tours'
import type { SiteDiffEntry } from './catalog-contract'
import type { WebsiteTour } from './website-output'
import { parseDepartureDisplay } from './dates'
import { planSeed } from './seed'

export interface SiteDiffResult {
  onlyOnWebsite: string[]
  onlyInCatalog: string[]
  differences: SiteDiffEntry[]
}

export const SITE_DIFF_FIELD_LABELS: Readonly<Record<string, string>> = {
  slug: '网址标识',
  destination: '目的地',
  tier: '档位',
  name: '团名',
  title: '对外标题',
  short_description: '行程简介',
  duration: '天数',
  price: '展示价',
  hero_image: '主图',
  meta_title: '搜索标题',
  meta_description: '搜索描述',
  is_active: '是否在售',
  sold_out: '整团售罄',
  departure_dates: '出发日期',
  departure_pricing: '班期单独价',
  tour_cities: '途经城市',
  highlights: '亮点',
  itinerary: '行程',
  inclusions: '包含项目',
  exclusions: '不含项目',
  gallery: '图集',
  tags: '标签',
  faqs: '常见问题',
  single_supplement: '单房差',
  single_supplement_note: '单房差说明',
  max_group_size: '每团人数上限',
  rating: '评分',
  review_count: '评价数',
  review_summary: '评价摘要',
  related_blog_slugs: '推荐阅读',
  quick_answer: '快速回答',
}

/** Fields compared field by field, in this order. */
const COMPARED_FIELDS: readonly string[] = [
  'slug',
  'destination',
  'tier',
  'name',
  'title',
  'short_description',
  'duration',
  'price',
  'hero_image',
  'meta_title',
  'meta_description',
  'is_active',
  'sold_out',
  'departure_dates',
  'departure_pricing',
  'tour_cities',
  'highlights',
  'itinerary',
  'inclusions',
  'exclusions',
  'gallery',
  'tags',
  'faqs',
  'single_supplement',
  'single_supplement_note',
  'max_group_size',
  'rating',
  'review_count',
  'review_summary',
  'related_blog_slugs',
  'quick_answer',
]

const MAX_RENDER = 300
const CONTEXT_BEFORE = 40
const ELLIPSIS = '…'

/** Stable identity for a tour across feeds and DB rows. */
function tourKey(destination: string, tier: string | undefined, slug: string): string {
  return `${destination}/${tier ?? 'unknown'}/${slug}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Deep equality where object key order does not matter and array order does. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined)
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!deepEqual(a[key], b[key])) return false
    }
    return true
  }
  return false
}

/** Render a value as a comparable string, or null when there is nothing to show. */
function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return JSON.stringify(value)
  if (isPlainObject(value)) return JSON.stringify(sortKeys(value))
  return null
}

/** Recursively sort object keys so both sides print alike. */
function sortKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    out[key] = isPlainObject(item) ? sortKeys(item) : item
  }
  return out
}

function firstDifference(a: string, b: string): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) return i
  }
  return shared
}

function windowAt(value: string, start: number): string {
  const end = start + MAX_RENDER
  const body = value.slice(start, end)
  return `${start > 0 ? ELLIPSIS : ''}${body}${end < value.length ? ELLIPSIS : ''}`
}

/** Cut long values to a window around the first difference, so both sides never look alike. */
function renderPair(before: string | null, after: string | null): { before: string | null; after: string | null } {
  const beforeLength = before === null ? 0 : before.length
  const afterLength = after === null ? 0 : after.length
  if (beforeLength <= MAX_RENDER && afterLength <= MAX_RENDER) {
    return { before, after }
  }
  const diffAt = before === null || after === null ? 0 : firstDifference(before, after)
  const start = Math.max(0, diffAt - CONTEXT_BEFORE)
  return {
    before: before === null ? null : windowAt(before, start),
    after: after === null ? null : windowAt(after, start),
  }
}

/** Drop expired departure dates from the website side; unparseable entries are kept. */
function filterExpiredDates(dates: readonly string[], today: string): string[] {
  return dates.filter((entry) => {
    const iso = parseDepartureDisplay(entry)
    return iso === null || iso >= today
  })
}

/** Drop expired departure_pricing keys from the website side; unparseable keys are kept. */
function filterExpiredPricing(pricing: Record<string, string>, today: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(pricing)) {
    const iso = parseDepartureDisplay(key)
    if (iso === null || iso >= today) out[key] = pricing[key]
  }
  return out
}

/** Normalise one itinerary day from the website feed. */
function normaliseWebsiteDay(day: unknown): unknown {
  if (!isPlainObject(day)) return day
  const out: Record<string, unknown> = { ...day }
  if (out.meals === undefined) out.meals = []
  return out
}

/** Normalise the website feed product into the comparable shape. */
function normaliseWebsiteTour(product: FirstPartyTour, today: string): Record<string, unknown> {
  const itinerary = Array.isArray(product.itinerary) ? product.itinerary.map(normaliseWebsiteDay) : []
  return {
    slug: product.slug,
    destination: product.destination,
    tier: product.tier ?? 'unknown',
    name: product.name,
    title: product.title ?? '',
    short_description: product.short_description ?? '',
    duration: product.duration ?? '',
    price: product.price ?? '',
    hero_image: product.hero_image ?? '',
    meta_title: product.meta_title ?? '',
    meta_description: product.meta_description ?? '',
    is_active: product.is_active,
    sold_out: product.sold_out ?? false,
    departure_dates: filterExpiredDates(product.departure_dates, today),
    departure_pricing: filterExpiredPricing(product.departure_pricing, today),
    tour_cities: product.tour_cities,
    highlights: product.highlights ?? [],
    itinerary,
    inclusions: product.inclusions,
    exclusions: product.exclusions,
    gallery: product.gallery ?? [],
    tags: product.tags ?? [],
    faqs: product.faqs ?? [],
    single_supplement: product.single_supplement ?? null,
    single_supplement_note: product.single_supplement_note ?? null,
    max_group_size: product.max_group_size ?? null,
    rating: product.rating ?? null,
    review_count: product.review_count ?? null,
    review_summary: product.review_summary ?? null,
    related_blog_slugs: product.related_blog_slugs ?? [],
    quick_answer: product.quick_answer ?? null,
  }
}

/** Normalise the catalog tour into the comparable shape. */
function normaliseCatalogTour(tour: WebsiteTour): Record<string, unknown> {
  return { ...tour }
}

/** Build one difference entry for a scalar field. */
function fieldEntry(tourName: string, field: string, website: unknown, catalog: unknown): SiteDiffEntry {
  const rendered = renderPair(renderValue(website), renderValue(catalog))
  return {
    tourName,
    fieldLabel: SITE_DIFF_FIELD_LABELS[field] ?? field,
    website: rendered.before,
    catalog: rendered.after,
  }
}

/** Compare itinerary day by day, reporting each differing day. */
function itineraryEntries(tourName: string, website: unknown, catalog: unknown): SiteDiffEntry[] {
  const websiteDays = Array.isArray(website) ? website : []
  const catalogDays = Array.isArray(catalog) ? catalog : []
  const length = Math.max(websiteDays.length, catalogDays.length)
  const entries: SiteDiffEntry[] = []
  for (let i = 0; i < length; i += 1) {
    const before = websiteDays[i]
    const after = catalogDays[i]
    if (deepEqual(before, after)) continue
    const rendered = renderPair(renderValue(before), renderValue(after))
    entries.push({
      tourName,
      fieldLabel: `行程 第 ${i + 1} 天`,
      website: rendered.before,
      catalog: rendered.after,
    })
  }
  return entries
}

/** Compare one matched pair field by field. */
function comparePair(website: Record<string, unknown>, catalog: Record<string, unknown>, tourName: string): SiteDiffEntry[] {
  const entries: SiteDiffEntry[] = []
  for (const field of COMPARED_FIELDS) {
    const before = website[field]
    const after = catalog[field]
    if (deepEqual(before, after)) continue
    if (field === 'itinerary') {
      entries.push(...itineraryEntries(tourName, before, after))
      continue
    }
    entries.push(fieldEntry(tourName, field, before, after))
  }
  return entries
}

/** Index website products by key, keeping the first of each key and listing later duplicates. */
function indexWebsite(products: readonly FirstPartyTour[]): { byKey: Map<string, FirstPartyTour>; duplicates: string[] } {
  const byKey = new Map<string, FirstPartyTour>()
  const duplicates: string[] = []
  for (const product of products) {
    const key = tourKey(product.destination, product.tier, product.slug)
    if (byKey.has(key)) {
      duplicates.push(`${product.name}（官网重复）`)
      continue
    }
    byKey.set(key, product)
  }
  return { byKey, duplicates }
}

/** Compare the website feed against the catalog and describe every difference. */
export function diffWebsiteVsCatalog(
  feedProducts: readonly FirstPartyTour[],
  catalogTours: readonly WebsiteTour[],
  today: string,
): SiteDiffResult {
  const { byKey, duplicates } = indexWebsite(feedProducts)
  const catalogByKey = new Map<string, WebsiteTour>()
  for (const tour of catalogTours) {
    const key = tourKey(tour.destination, tour.tier, tour.slug)
    if (!catalogByKey.has(key)) catalogByKey.set(key, tour)
  }

  const onlyOnWebsite: string[] = [...duplicates]
  const onlyInCatalog: string[] = []
  const differences: SiteDiffEntry[] = []

  for (const product of feedProducts) {
    const key = tourKey(product.destination, product.tier, product.slug)
    const catalog = catalogByKey.get(key)
    if (catalog === undefined) {
      if (!byKey.has(key) || byKey.get(key) === product) {
        onlyOnWebsite.push(product.name)
      }
      continue
    }
    if (byKey.get(key) !== product) continue
    const website = normaliseWebsiteTour(product, today)
    differences.push(...comparePair(website, normaliseCatalogTour(catalog), catalog.name))
  }

  for (const tour of catalogTours) {
    const key = tourKey(tour.destination, tour.tier, tour.slug)
    if (!byKey.has(key)) onlyInCatalog.push(tour.name)
  }

  return { onlyOnWebsite, onlyInCatalog, differences }
}

/** Human-readable notes about anything in the feed the reader could not take in. */
export function feedReadNotes(feed: FirstPartyTourFeed): string[] {
  const notes: string[] = []
  const skipped = feed.skipped_products
  if (typeof skipped === 'number' && skipped > 0) {
    notes.push(`有 ${skipped} 个团读不出来，已跳过`)
  }
  for (const note of planSeed(feed, new Set<string>()).notes) {
    notes.push(`${note.tourKey}：${note.note}`)
  }
  return notes
}
