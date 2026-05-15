/**
 * Local review aggregation connector — client.
 *
 * Reference: ROADMAP.md P8.12.S1.2
 *
 *  - Google Business Profile reviews  → SerpAPI google_maps engine (env SERPAPI_API_KEY)
 *  - ProductReview.com.au reviews      → Jina Reader (no key — see src/lib/brief/jina.ts)
 *
 * Design mirrors src/lib/semrush/client.ts:
 *  - API credentials retrieved at call time (clear error if missing).
 *  - Low-level fetchers throw on transport/HTTP errors.
 *  - The high-level `aggregateLocalReviews` wrapper is non-fatal: each
 *    source is settled independently so one failure never blocks the other.
 */

import { validateEnvVar } from '@/lib/validation-utils'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import type {
  LocalReviewSnapshot,
  ReviewSample,
  SerpApiMapsRaw,
} from './types'

const SERPAPI_BASE = 'https://serpapi.com/search.json'
const NEGATIVE_RATING_CEILING = 2          // reviews at or below this are "negative"
const MAX_NEGATIVE_SAMPLES = 5

function getSerpApiKey(): string {
  return validateEnvVar('SERPAPI_API_KEY')
}

// ─── Google Business Profile (SerpAPI) ───────────────────────────────────────

/** Build a stable Google Maps URL from a place_id. */
function mapsUrlFromPlaceId(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
}

/**
 * Extract a brand token from a SerpAPI-style query like "Apapaya Wantirna South VIC".
 * Assumption: the brand name is the first whitespace-separated token (geo terms trail).
 */
function brandTokenFromQuery(query: string): string {
  return (query.trim().split(/\s+/)[0] || '').toLowerCase()
}

/**
 * Does the SerpAPI-returned place title actually correspond to the brand we asked for?
 * SerpAPI google_maps falls back to fuzzy matching — without this check we surface
 * a same-city different-business place as if it were the target brand. Brand tokens
 * shorter than 3 chars are not reliable enough to filter on (would cause false
 * negatives), so we let them through.
 *
 * Real regression: query="Apapaya Wantirna South VIC" → SerpAPI returned a nearby
 * unrelated business → we surfaced it as Apapaya's GBP with a Google Maps link to
 * the wrong place.
 */
function titleMatchesBrand(title: string | undefined, brand: string): boolean {
  if (!title) return false
  if (brand.length < 3) return true
  return title.toLowerCase().includes(brand)
}

/**
 * Fetch Google Business Profile reputation for a business query
 * (e.g. "Oztop Building Supplies Slacks Creek QLD").
 *
 * Throws on transport/HTTP/SerpAPI errors; returns null when no place
 * matches the query.
 */
export async function fetchGbpReviews(
  query: string,
): Promise<LocalReviewSnapshot | null> {
  const params = new URLSearchParams({
    engine: 'google_maps',
    type: 'search',
    q: query,
    api_key: getSerpApiKey(),
  })

  const res = await fetch(`${SERPAPI_BASE}?${params}`)
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`)

  const data = (await res.json()) as SerpApiMapsRaw
  if (data.error) throw new Error(`SerpAPI error: ${data.error}`)

  // A specific business query yields `place_results`; an ambiguous one
  // yields `local_results` (no review samples available there).
  // ⚠️ SerpAPI's "match" is fuzzy — verify the returned title actually contains
  // the brand token from the query before trusting it (see titleMatchesBrand).
  const brand = brandTokenFromQuery(query)

  const place = data.place_results
  if (place?.place_id && titleMatchesBrand(place.title, brand)) {
    const samples = (place.user_reviews?.most_relevant ?? [])
      .filter(r => typeof r.rating === 'number' && r.rating <= NEGATIVE_RATING_CEILING)
      .slice(0, MAX_NEGATIVE_SAMPLES)
      .map(
        (r): ReviewSample => ({
          rating: r.rating as number,
          text: r.description?.trim() || '',
          date: r.date || null,
          author: r.username || null,
        }),
      )
    return {
      source: 'google',
      url: mapsUrlFromPlaceId(place.place_id),
      rating: typeof place.rating === 'number' ? place.rating : null,
      review_count: typeof place.reviews === 'number' ? place.reviews : null,
      rating_distribution: null,    // SerpAPI google_maps does not expose this
      recent_negative_samples: samples,
      response_rate: null,
    }
  }

  // Scan all local_results for a brand-matching entry — the real match may
  // not be the first row (Codex review P2 on PR #24).
  const matched = data.local_results?.find(
    r => r.place_id && titleMatchesBrand(r.title, brand),
  )
  if (matched?.place_id) {
    return {
      source: 'google',
      url: mapsUrlFromPlaceId(matched.place_id),
      rating: typeof matched.rating === 'number' ? matched.rating : null,
      review_count: typeof matched.reviews === 'number' ? matched.reviews : null,
      rating_distribution: null,
      recent_negative_samples: [],
      response_rate: null,
    }
  }

  return null
}

// ─── ProductReview.com.au (Jina Reader) ──────────────────────────────────────

/**
 * Extract the overall rating from ProductReview markdown.
 * Pages render the score as e.g. "4.2 · 87 reviews" or "4.2 out of 5".
 */
function parseProductReviewRating(markdown: string): number | null {
  const m =
    markdown.match(/([0-5](?:\.\d)?)\s*(?:out of 5|\/\s*5)/i) ||
    markdown.match(/\b([0-5]\.\d)\b\s*(?:·|\||from|stars?)/i)
  if (!m) return null
  const value = parseFloat(m[1])
  return Number.isFinite(value) && value >= 0 && value <= 5 ? value : null
}

/** Extract the review count from ProductReview markdown ("87 reviews"). */
function parseProductReviewCount(markdown: string): number | null {
  const m = markdown.match(/([\d,]+)\s+reviews?\b/i)
  if (!m) return null
  const value = parseInt(m[1].replace(/,/g, ''), 10)
  return Number.isFinite(value) ? value : null
}

/**
 * Fetch ProductReview.com.au reputation for a given listing URL.
 *
 * ProductReview actively blocks scrapers, so this routes through Jina
 * Reader and degrades gracefully: it returns null (never throws) when the
 * page can't be fetched or the rating can't be parsed.
 */
export async function fetchProductReviewReviews(
  listingUrl: string,
): Promise<LocalReviewSnapshot | null> {
  if (!/productreview\.com\.au/i.test(listingUrl)) {
    return null
  }

  try {
    const { markdown } = await fetchUrlAsMarkdown(listingUrl)
    const rating = parseProductReviewRating(markdown)
    const reviewCount = parseProductReviewCount(markdown)
    if (rating === null && reviewCount === null) return null

    return {
      source: 'productreview',
      url: listingUrl,
      rating,
      review_count: reviewCount,
      rating_distribution: null,
      recent_negative_samples: [],
      response_rate: null,
    }
  } catch (err) {
    console.error('[local-reviews] ProductReview fetch failed', err)
    return null
  }
}

// ─── High-level wrapper (non-fatal — used by the Zhangqian agent) ────────────

export interface AggregateLocalReviewsOptions {
  /** Business query for Google Maps, e.g. "Brand Name City STATE". */
  businessQuery: string
  /** Optional ProductReview.com.au listing URL (the agent finds it first). */
  productReviewUrl?: string
}

/**
 * Aggregate reputation snapshots from every available local source.
 *
 * Non-fatal by contract: each source is settled independently, so a
 * missing SERPAPI_API_KEY or a blocked ProductReview page yields a
 * partial result rather than blocking discovery. Returns only the
 * snapshots that resolved successfully (may be empty).
 */
export async function aggregateLocalReviews(
  opts: AggregateLocalReviewsOptions,
): Promise<LocalReviewSnapshot[]> {
  const tasks: Array<Promise<LocalReviewSnapshot | null>> = [
    // Promise.resolve().then(...) so a synchronous throw (missing API key)
    // is captured by allSettled rather than escaping before the await.
    Promise.resolve().then(() => fetchGbpReviews(opts.businessQuery)),
  ]
  if (opts.productReviewUrl) {
    tasks.push(fetchProductReviewReviews(opts.productReviewUrl))
  }

  const settled = await Promise.allSettled(tasks)
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<LocalReviewSnapshot> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)
}
