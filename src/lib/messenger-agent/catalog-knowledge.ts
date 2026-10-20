/**
 * Catalog-backed knowledge entries for the AI customer-service reply agent.
 *
 * Appends `KnowledgeEntry` rows built from the client's PUBLISHED tour catalog
 * to the knowledge base read, so the reply agent and the CTS verifier (which
 * consumes entries whose `factKey` starts with `tour.active.`) can see real
 * tours, prices and departure dates. Only the published catalog is read: an
 * unpublished catalog yields no entries, so drafts that need prices are
 * blocked.
 *
 * 🔴 No remaining-seat / availability information may appear anywhere in the
 * produced entries — a verifier gate blocks any availability claim, so seat
 * data must never be placed into `statement` or `structuredValue`. Entries
 * carry no confirmer fields.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getClientKnowledge,
  type GetClientKnowledgeOptions,
  type KnowledgeEntry,
  type KnowledgeReadResult,
} from '@/lib/knowledge'
import { supabaseAdmin } from '@/lib/supabase'
import { loadPublishedProducts } from '@/lib/tour-catalog/store-publish'
import type { FirstPartyTour } from '@/lib/web-intelligence/first-party-tours'

/** Today's date in Pacific/Auckland as 'YYYY-MM-DD'. */
export function nzToday(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

// Strict on purpose: only "NZD $3,480", "From NZD $4,080" and "... per person" shapes are trusted.
// Anything else ("per couple", "Was ... now ...", ranges, decimals, TBC/POA, other currencies) is skipped,
// because the entry later states the amount as a per-person price.
const PRICE_TEXT_RE = /^(?:from\s+)?NZD\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\s+per\s+person)?$/i
const MIN_PLAUSIBLE_PRICE_NZD = 100

/**
 * Parse an integer NZD amount out of a display price string. Returns `null`
 * unless the whole text is a plain per-person amount (see PRICE_TEXT_RE).
 */
export function parsePriceNzd(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const trimmed = text.trim()
  if (trimmed === '') return null
  const match = PRICE_TEXT_RE.exec(trimmed)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(amount) && amount >= MIN_PLAUSIBLE_PRICE_NZD ? amount : null
}

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}

const DISPLAY_DATE_RE = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/

/**
 * Parse a "D Month YYYY" display date (e.g. "13 May 2027", full English month
 * names, case-insensitive) into an ISO 'YYYY-MM-DD' string. Returns `null`
 * when the text does not match, the month is unknown, or the date is not a
 * real calendar date.
 */
export function parseDisplayDate(text: string): string | null {
  const match = DISPLAY_DATE_RE.exec(text.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = MONTHS[match[2].toLowerCase()]
  const year = Number(match[3])
  if (month === undefined) return null
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

function normalizeCodePart(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function buildCode(tour: FirstPartyTour): string {
  const parts = [tour.destination, tour.tier, tour.slug]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map(normalizeCodePart)
  return parts.join('-')
}

interface PricedDeparture {
  departOn: string
  price: number
}

export function buildCatalogKnowledgeEntries(input: {
  clientId: string
  tours: FirstPartyTour[]
  now: Date
}): KnowledgeEntry[] {
  const { clientId, tours, now } = input
  const today = nzToday(now)
  const nowIso = now.toISOString()

  const activeTours = tours.filter((tour) => tour.is_active === true && tour.sold_out !== true)

  // Group counted departures per tour, then per price.
  const pricedByTour = new Map<string, PricedDeparture[]>()
  for (const tour of activeTours) {
    for (const displayDate of tour.departure_dates) {
      const iso = parseDisplayDate(displayDate)
      if (iso === null) continue
      if (iso < today) continue
      const override = tour.departure_pricing[displayDate]
      const priceText =
        typeof override === 'string' && override.trim() !== '' ? override : tour.price
      const price = parsePriceNzd(priceText)
      if (price === null) continue
      const list = pricedByTour.get(tour.id)
      if (list) list.push({ departOn: iso, price })
      else pricedByTour.set(tour.id, [{ departOn: iso, price }])
    }
  }

  interface Draft {
    code: string
    price: number
    entry: KnowledgeEntry
  }
  const drafts: Draft[] = []

  for (const [tourId, priced] of pricedByTour) {
    const tour = activeTours.find((t) => t.id === tourId)
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
        `${tour.name}: NZD ${price.toLocaleString('en-NZ')} per person, twin share. ` +
        `Departures: ${sortedDates.join(', ')}. ` +
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
  const read = await loadPublishedProducts(db, clientId, nzToday(now))
  if (!read.published) return []
  return buildCatalogKnowledgeEntries({ clientId, tours: read.tours, now })
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
  // `<destination>-<tier>-<slug>`, so match either direction on word boundaries. Drops when unsure
  // (a shared slug such as 'highlights' may hide a live tour — the safe direction). Retired tours are
  // also `is_active=false` in the catalog, which is the primary filter.
  const retiredSlugs = base.forbiddenFactKeys
    .filter((key) => key.startsWith('tour.retired.'))
    .map((key) => {
      // Same convention as the CTS verifier: `tour.retired.<name>[.alias.<slug>]` — match on the slug part.
      const rest = key.slice('tour.retired.'.length)
      const aliasAt = rest.indexOf('.alias.')
      return normalizeCodePart(aliasAt === -1 ? rest : rest.slice(aliasAt + '.alias.'.length))
    })
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
