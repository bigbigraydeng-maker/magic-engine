/**
 * Tour catalog seeding — pure planning plus a thin Supabase writer.
 *
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md
 * The planner is pure; the writer takes an injected Supabase client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseFirstPartyTourFeed,
  type FirstPartyTour,
  type FirstPartyTourFeed,
} from '@/lib/web-intelligence/first-party-tours'
import { parseDepartureDisplay } from './dates'
import { validatePriceText } from './price'
import { safeNoteText, sanitizeSeedProduct } from './seed-sanitize'

/** `tourKey` of the notes that are about the feed as a whole, not about one tour. */
export const FEED_NOTE_KEY = '(feed)'

export interface SeedTourRow {
  slug: string
  destination: string
  tier: string
  name: string
  title: string | null
  duration_text: string | null
  display_price_text: string | null
  itinerary: unknown[]
  inclusions: string[]
  exclusions: string[]
  tour_cities: string[]
  single_supplement: string | null
  max_group_size: number | null
  is_active: boolean
  manages_departures: boolean
  short_description: string | null
  highlights: string[]
  hero_image: string | null
  gallery: string[]
  meta_title: string | null
  meta_description: string | null
  tags: string[]
  faqs: unknown[]
  sold_out: boolean
  single_supplement_note: string | null
  rating: number | null
  review_count: number | null
  review_summary: string | null
  quick_answer: string | null
  /** Website-only pass-through; today only `related_blog_slugs`. */
  site_extras: Record<string, unknown>
}

export interface SeedDepartureRow {
  tourKey: string
  depart_on: string
  return_on: null
  price_text_override: string | null
  status: 'open'
}

export interface SeedPlan {
  tours: SeedTourRow[]
  departures: SeedDepartureRow[]
  skippedExisting: string[]
  notes: Array<{ tourKey: string; note: string }>
}

export interface SeedResult {
  toursInserted: number
  departuresInserted: number
  skippedExisting: string[]
  notes: SeedPlan['notes']
}

/** Stable identity for a tour across feeds and DB rows. */
export function tourKey(t: { destination: string; tier?: string; slug: string }): string {
  return `${t.destination}/${t.tier ?? 'unknown'}/${t.slug}`
}

/** Validate a price string, returning the accepted text or null plus a note. */
function acceptPrice(
  price: string | undefined,
  tourKeyValue: string,
  notes: SeedPlan['notes'],
  notePrefix: string,
): string | null {
  if (price === undefined) return null
  const result = validatePriceText(price)
  if (!result.ok) {
    notes.push({ tourKey: tourKeyValue, note: notePrefix + result.reason })
    return null
  }
  return price
}

/** The content columns of design §6.11.1; a field the feed does not send stays empty. */
function buildContentColumns(product: FirstPartyTour): Pick<
  SeedTourRow,
  | 'short_description' | 'highlights' | 'hero_image' | 'gallery' | 'meta_title' | 'meta_description' | 'tags'
  | 'faqs' | 'sold_out' | 'single_supplement_note' | 'rating' | 'review_count' | 'review_summary' | 'quick_answer' | 'site_extras'
> {
  return {
    short_description: product.short_description ?? null,
    highlights: product.highlights ?? [],
    hero_image: product.hero_image === undefined || product.hero_image === '' ? null : product.hero_image,
    gallery: product.gallery ?? [],
    meta_title: product.meta_title ?? null,
    meta_description: product.meta_description ?? null,
    tags: product.tags ?? [],
    faqs: product.faqs ?? [],
    sold_out: product.sold_out ?? false,
    single_supplement_note: product.single_supplement_note ?? null,
    rating: product.rating ?? null,
    review_count: product.review_count ?? null,
    review_summary: product.review_summary ?? null,
    quick_answer: product.quick_answer ?? null,
    site_extras: product.related_blog_slugs === undefined ? {} : { related_blog_slugs: product.related_blog_slugs },
  }
}

/** Build the tour row for a single product. */
function buildTourRow(product: FirstPartyTour, notes: SeedPlan['notes']): SeedTourRow {
  const key = tourKey(product)
  return {
    slug: product.slug,
    destination: product.destination,
    tier: product.tier ?? 'unknown',
    name: product.name,
    title: product.title ?? null,
    duration_text: product.duration ?? null,
    display_price_text: acceptPrice(product.price, key, notes, 'price_rejected:'),
    itinerary: product.itinerary,
    inclusions: product.inclusions,
    exclusions: product.exclusions,
    tour_cities: product.tour_cities,
    single_supplement: product.single_supplement ?? null,
    max_group_size: product.max_group_size ?? null,
    is_active: product.is_active,
    manages_departures: product.departure_dates.length > 0,
    ...buildContentColumns(product),
  }
}

/** Build departure rows for a product, recording unparseable entries as notes. */
function buildDepartureRows(product: FirstPartyTour, notes: SeedPlan['notes']): SeedDepartureRow[] {
  const key = tourKey(product)
  const rows: SeedDepartureRow[] = []
  for (const entry of product.departure_dates) {
    const iso = parseDepartureDisplay(entry)
    if (iso === null) {
      notes.push({ tourKey: key, note: 'departure_unparseable:' + entry })
      continue
    }
    const override = acceptPrice(product.departure_pricing[entry], key, notes, 'override_price_rejected:' + entry + ':')
    rows.push({
      tourKey: key,
      depart_on: iso,
      return_on: null,
      price_text_override: override,
      status: 'open',
    })
  }
  return rows
}

/**
 * Pure planner: turn a feed into insert rows, skipping already-present tours. Every product goes
 * through the save rules first (seed-sanitize.ts): what they refuse is emptied and noted, never
 * stored. Anything the feed reader itself had to drop is carried over as a note too.
 */
export function planSeed(feed: FirstPartyTourFeed, existingKeys: ReadonlySet<string>): SeedPlan {
  const tours: SeedTourRow[] = []
  const departures: SeedDepartureRow[] = []
  const skippedExisting: string[] = []
  const notes: SeedPlan['notes'] = []

  for (const note of feed.parse_notes ?? []) notes.push({ tourKey: FEED_NOTE_KEY, note })

  for (const raw of feed.products) {
    const key = tourKey(raw)
    if (existingKeys.has(key)) {
      skippedExisting.push(key)
      continue
    }
    const product = sanitizeSeedProduct(raw, (note) => notes.push({ tourKey: safeNoteText(key), note }))
    if (product === null) continue
    tours.push(buildTourRow(product, notes))
    departures.push(...buildDepartureRows(product, notes))
  }

  return { tours, departures, skippedExisting, notes }
}

/**
 * A feed from before the website sent the content fields: no tour carries a main image or a short
 * description. Reading it in would leave those fields empty for good (read-in only works on an
 * empty catalog) while the comparison report would still come out clean.
 */
export function feedLacksContentFields(feed: FirstPartyTourFeed): boolean {
  if (feed.products.length === 0) return false
  return feed.products.every(
    (product) => !isNonEmpty(product.hero_image) && !isNonEmpty(product.short_description),
  )
}

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

const FEED_TIMEOUT_MS = 10_000
const FEED_MAX_CHARS = 5 * 1024 * 1024

/** Fetch and parse a first-party tour feed over HTTPS. */
export async function fetchFirstPartyFeed(
  feedUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FirstPartyTourFeed> {
  if (!feedUrl.startsWith('https://')) {
    throw new Error('feed_url_must_be_https')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
  try {
    const response = await fetchImpl(feedUrl, { signal: controller.signal, redirect: 'error' })
    if (!response.ok) {
      throw new Error('feed_http_' + response.status)
    }
    const body = await response.text()
    if (body.length > FEED_MAX_CHARS) {
      throw new Error('feed_too_large')
    }
    let json: unknown
    try {
      json = JSON.parse(body) as unknown
    } catch {
      throw new Error('feed_invalid')
    }
    const parsed = parseFirstPartyTourFeed(json)
    if (parsed === null) {
      throw new Error('feed_invalid')
    }
    return parsed
  } finally {
    clearTimeout(timer)
  }
}

interface ExistingTourRow {
  destination: string
  tier: string
  slug: string
}

interface InsertedTourRow extends ExistingTourRow {
  id: string
}

/** Load the set of tour keys already present for a client. */
async function loadExistingKeys(db: SupabaseClient, clientId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('tour_catalog_tours')
    .select('destination, tier, slug')
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ExistingTourRow[]
  return new Set(rows.map((row) => tourKey(row)))
}

/** Insert new tours and return a map from tour key to inserted id. */
async function insertTours(
  db: SupabaseClient,
  clientId: string,
  tours: SeedTourRow[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (tours.length === 0) return map

  const rows = tours.map((tour, index) => ({ ...tour, client_id: clientId, sort_order: index }))
  const { data, error } = await db
    .from('tour_catalog_tours')
    .insert(rows)
    .select('id, destination, tier, slug')
  if (error) throw new Error(error.message)

  const inserted = (data ?? []) as InsertedTourRow[]
  for (const row of inserted) {
    map.set(tourKey(row), row.id)
  }
  return map
}

/** Insert departure rows, resolving tour ids from the key map. */
async function insertDepartures(
  db: SupabaseClient,
  clientId: string,
  departures: SeedDepartureRow[],
  tourIds: Map<string, string>,
): Promise<number> {
  if (departures.length === 0) return 0

  const rows = departures.map((departure) => ({
    client_id: clientId,
    tour_id: tourIds.get(departure.tourKey) ?? null,
    depart_on: departure.depart_on,
    return_on: departure.return_on,
    price_text_override: departure.price_text_override,
    status: departure.status,
    status_source: 'seed',
  }))
  const { error } = await db.from('tour_catalog_departures').insert(rows)
  if (error) throw new Error(error.message)
  return rows.length
}

/** Delete tours inserted by this call; their departures cascade. */
async function compensateInsertedTours(
  db: SupabaseClient,
  clientId: string,
  insertedIds: string[],
): Promise<void> {
  if (insertedIds.length === 0) return
  const { error } = await db
    .from('tour_catalog_tours')
    .delete()
    .eq('client_id', clientId)
    .in('id', insertedIds)
  if (error) {
    console.error('seedCatalog: compensation delete failed', error)
  }
}

/**
 * Plan and persist a feed for a client. Read-in is a one-off for an EMPTY catalog (design
 * §6.11.1 item 12): with any tour already there it throws `catalog_not_empty`, and an old-shape
 * feed throws `feed_missing_content_fields`. Nothing is written in either case.
 */
export async function seedCatalog(
  db: SupabaseClient,
  clientId: string,
  feed: FirstPartyTourFeed,
): Promise<SeedResult> {
  if (feedLacksContentFields(feed)) throw new Error('feed_missing_content_fields')
  const existingKeys = await loadExistingKeys(db, clientId)
  if (existingKeys.size > 0) throw new Error('catalog_not_empty')
  const plan = planSeed(feed, existingKeys)

  const tourIds = await insertTours(db, clientId, plan.tours)
  const insertedIds = Array.from(tourIds.values())

  let departuresInserted: number
  try {
    departuresInserted = await insertDepartures(db, clientId, plan.departures, tourIds)
  } catch (err) {
    await compensateInsertedTours(db, clientId, insertedIds)
    throw err
  }

  return {
    toursInserted: plan.tours.length,
    departuresInserted,
    skippedExisting: plan.skippedExisting,
    notes: plan.notes,
  }
}

// Lives in its own file so the validation modules can use it without importing the read-in code.
export { normalizeDomain } from './domain'
