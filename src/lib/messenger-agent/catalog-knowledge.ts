/**
 * Catalog-backed knowledge entries for the AI customer-service reply agent.
 *
 * Appends `KnowledgeEntry` rows built from the client's tour catalog
 * (`tour_catalog_tours` / `tour_catalog_departures`) to the knowledge base
 * read, so the reply agent and the CTS verifier (which consumes entries whose
 * `factKey` starts with `tour.active.`) can see real tours, prices and
 * departure dates.
 *
 * 🔴 No remaining-seat / availability information may appear anywhere in the
 * produced entries — a verifier gate blocks any availability claim, so seat
 * data must never be placed into `statement` or `structuredValue`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getClientKnowledge,
  type GetClientKnowledgeOptions,
  type KnowledgeEntry,
  type KnowledgeReadResult,
} from '@/lib/knowledge'
import { supabaseAdmin } from '@/lib/supabase'

export interface CatalogTourRow {
  id: string
  slug: string
  destination: string
  tier: string
  name: string
  display_price_text: string | null
  is_active: boolean
  sold_out: boolean | null
}

export interface CatalogDepartureRow {
  tour_id: string
  /** 'YYYY-MM-DD' */
  depart_on: string
  status: string
  price_text_override: string | null
}

/** Today's date in Pacific/Auckland as 'YYYY-MM-DD'. */
export function nzToday(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

const PRICE_AMOUNT_RE = /NZD\s*\$?\s*([0-9][0-9,]*)/i
const PRICE_UNKNOWN_RE = /TBC|POA|on request/i

/**
 * Parse an integer NZD amount out of a display price string. Returns `null`
 * for empty/whitespace input, for TBC/POA/on-request text, or when no amount
 * is found. A leading "From" is accepted (it is a per-person from-price).
 */
export function parsePriceNzd(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (PRICE_UNKNOWN_RE.test(trimmed)) return null
  const match = PRICE_AMOUNT_RE.exec(trimmed)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : null
}

const COUNTED_DEPARTURE_STATUSES: ReadonlySet<string> = new Set(['open', 'limited'])

function normalizeCodePart(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function buildCode(tour: CatalogTourRow): string {
  return [tour.destination, tour.tier, tour.slug].map(normalizeCodePart).join('-')
}

interface PricedDeparture {
  departOn: string
  price: number
}

export function buildCatalogKnowledgeEntries(input: {
  clientId: string
  tours: CatalogTourRow[]
  departures: CatalogDepartureRow[]
  now: Date
}): KnowledgeEntry[] {
  const { clientId, tours, departures, now } = input
  const today = nzToday(now)
  const nowIso = now.toISOString()

  const toursById = new Map<string, CatalogTourRow>()
  for (const tour of tours) {
    if (tour.is_active !== true) continue
    if (tour.sold_out === true) continue
    toursById.set(tour.id, tour)
  }

  // Group counted departures per tour, then per price.
  const pricedByTour = new Map<string, PricedDeparture[]>()
  for (const dep of departures) {
    if (!COUNTED_DEPARTURE_STATUSES.has(dep.status)) continue
    if (dep.depart_on < today) continue
    const tour = toursById.get(dep.tour_id)
    if (!tour) continue
    const override = dep.price_text_override
    const priceText =
      typeof override === 'string' && override.trim() !== '' ? override : tour.display_price_text
    const price = parsePriceNzd(priceText)
    if (price === null) continue
    const list = pricedByTour.get(tour.id)
    if (list) list.push({ departOn: dep.depart_on, price })
    else pricedByTour.set(tour.id, [{ departOn: dep.depart_on, price }])
  }

  interface Draft {
    code: string
    price: number
    entry: KnowledgeEntry
  }
  const drafts: Draft[] = []

  for (const [tourId, priced] of pricedByTour) {
    const tour = toursById.get(tourId)
    if (!tour) continue
    const code = buildCode(tour)

    const datesByPrice = new Map<number, string[]>()
    for (const p of priced) {
      const dates = datesByPrice.get(p.price)
      if (dates) dates.push(p.departOn)
      else datesByPrice.set(p.price, [p.departOn])
    }

    for (const [price, dates] of datesByPrice) {
      const sortedDates = [...dates].sort()
      const statement =
        `${tour.name}: NZD ${price.toLocaleString('en-NZ')} per person ` +
        `(from-price, twin share; single supplement extra). ` +
        `Departures: ${sortedDates.join(', ')}. Source: tour catalog. ` +
        `Do not comment on how full a departure is; hand such questions to a consultant.`
      const entry: KnowledgeEntry = {
        id: `catalog:${tour.id}:${price}`,
        clientId,
        factKey: `tour.active.${code}.p${price}`,
        scope: {},
        statement,
        structuredValue: {
          code,
          name: tour.name,
          aliases: [],
          price_nzd: price,
          departure_dates: sortedDates,
          itinerary_url: '',
        },
        conflictGroupId: null,
        status: 'approved',
        visibility: 'customer_ok',
        sensitivity: 'price',
        validFrom: nowIso,
        validUntil: null,
        lastVerifiedAt: nowIso,
        approvedByEmail: null,
        approvedAt: null,
        clientConfirmedByEmail: null,
        clientConfirmedAt: null,
      }
      drafts.push({ code, price, entry })
    }
  }

  drafts.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1
    return a.price - b.price
  })

  return drafts.map((d) => d.entry)
}

export async function loadCatalogKnowledgeEntries(
  db: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<KnowledgeEntry[]> {
  const toursResult = await db
    .from('tour_catalog_tours')
    .select('id, slug, destination, tier, name, display_price_text, is_active, sold_out')
    .eq('client_id', clientId)
    .eq('is_active', true)
  if (toursResult.error) {
    throw new Error(`[catalog-knowledge] read failed: ${toursResult.error.message}`)
  }

  const departuresResult = await db
    .from('tour_catalog_departures')
    .select('tour_id, depart_on, status, price_text_override')
    .eq('client_id', clientId)
    .gte('depart_on', nzToday(now))
  if (departuresResult.error) {
    throw new Error(`[catalog-knowledge] read failed: ${departuresResult.error.message}`)
  }

  const tours = (toursResult.data ?? []) as CatalogTourRow[]
  const departures = (departuresResult.data ?? []) as CatalogDepartureRow[]

  return buildCatalogKnowledgeEntries({ clientId, tours, departures, now })
}

function catalogEntryCode(entry: KnowledgeEntry): string | null {
  const v = entry.structuredValue
  if (!v || typeof v !== 'object') return null
  const code = (v as Record<string, unknown>).code
  return typeof code === 'string' ? code : null
}

export async function getClientKnowledgeWithCatalog(
  clientId: string,
  options: GetClientKnowledgeOptions,
): Promise<KnowledgeReadResult> {
  const base = await getClientKnowledge(clientId, options)
  if (options.purpose !== 'customer_reply') return base

  let catalogEntries: KnowledgeEntry[]
  try {
    catalogEntries = await loadCatalogKnowledgeEntries(supabaseAdmin, clientId, new Date())
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn(
      `[catalog-knowledge] catalog read failed, continuing without catalog entries: ${message}`,
    )
    return base
  }

  // Retired-tour protection: `tour.retired.<slug>` keys carry the short tour slug, our code is
  // `<destination>-<tier>-<slug>`, so match either direction on word boundaries (drop when unsure).
  const retiredSlugs = base.forbiddenFactKeys
    .filter((key) => key.startsWith('tour.retired.'))
    .map((key) => normalizeCodePart(key.slice('tour.retired.'.length)))
    .filter((slug) => slug !== '')
  const kept = catalogEntries.filter((entry) => {
    const code = catalogEntryCode(entry)
    if (!code) return true
    return !retiredSlugs.some(
      (slug) => code === slug || code.endsWith(`-${slug}`) || slug.endsWith(`-${code}`) || slug.includes(code),
    )
  })

  return {
    entries: [...base.entries, ...kept],
    forbiddenFactKeys: base.forbiddenFactKeys,
  }
}
