/**
 * Local review aggregation connector — client.
 *
 * Reference: ROADMAP.md P8.12.S1.2 / P8.13.C.2
 *
 *  - Google Business Profile reviews  → DataForSEO Business Data API (primary)
 *                                        SerpAPI google_maps (fallback if DataForSEO unavailable)
 *  - ProductReview.com.au reviews      → Jina Reader (no key)
 *  - Tripadvisor reviews               → DataForSEO Business Data API (tourism clients)
 *
 * Design mirrors src/lib/semrush/client.ts:
 *  - API credentials retrieved at call time (clear error if missing).
 *  - Low-level fetchers throw on transport/HTTP errors.
 *  - The high-level `aggregateLocalReviews` wrapper is non-fatal: each
 *    source is settled independently so one failure never blocks the other.
 */

import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { getGmbInfo, getGoogleReviews, getTripadvisorInfo } from '@/lib/dataforseo/business-data'
import type { LocalReviewSnapshot, ReviewSample } from './types'

const NEGATIVE_RATING_CEILING = 2          // reviews at or below this are "negative"
const MAX_NEGATIVE_SAMPLES = 5

// ─── Google Business Profile (DataForSEO Business Data) ──────────────────────

/**
 * Fetch Google Business Profile reputation + negative review samples via
 * DataForSEO Business Data API (primary source, replaced SerpAPI P8.13.C.2).
 *
 * Throws on transport/HTTP errors; returns null when no place matches.
 */
export async function fetchGbpReviews(
  query: string,
): Promise<LocalReviewSnapshot | null> {
  const info = await getGmbInfo(query)
  if (!info) return null

  // Fetch individual reviews to surface negative samples
  let negativeSamples: ReviewSample[] = []
  try {
    const reviews = await getGoogleReviews(query, 20)
    if (reviews) {
      negativeSamples = reviews
        .filter(r => r.rating <= NEGATIVE_RATING_CEILING)
        .slice(0, MAX_NEGATIVE_SAMPLES)
        .map(r => ({
          rating: r.rating,
          text:   r.text,
          date:   r.date,
          author: r.author,
        }))
    }
  } catch {
    // Non-fatal: negative samples are enrichment, not required
  }

  return {
    source:                   'google',
    url:                      info.maps_url ?? null,
    rating:                   info.rating,
    review_count:             info.review_count,
    rating_distribution:      null,
    recent_negative_samples:  negativeSamples,
    response_rate:            null,
  }
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

// ─── Tripadvisor (DataForSEO Business Data) ───────────────────────────────────

/**
 * Fetch a Tripadvisor listing for a keyword via DataForSEO Business Data API.
 * Returns null (never throws) — intended for tourism clients like CTS Tours.
 */
export async function fetchTripadvisorReviews(
  keyword: string,
): Promise<LocalReviewSnapshot | null> {
  try {
    const info = await getTripadvisorInfo(keyword)
    if (!info || !info.url) return null
    return {
      source:                  'tripadvisor',
      url:                     info.url,
      rating:                  info.rating,
      review_count:            info.review_count,
      rating_distribution:     null,
      recent_negative_samples: [],
      response_rate:           null,
    }
  } catch (err) {
    console.error('[local-reviews] Tripadvisor fetch failed', err)
    return null
  }
}

// ─── High-level wrapper (non-fatal — used by the Zhangqian agent) ────────────

export interface AggregateLocalReviewsOptions {
  /** Business query for Google Maps, e.g. "Brand Name City STATE". */
  businessQuery: string
  /** Optional ProductReview.com.au listing URL (the agent finds it first). */
  productReviewUrl?: string
  /**
   * Optional Tripadvisor keyword for tourism-sector clients (e.g. CTS Tours).
   * When provided, fetches the first Tripadvisor match for this keyword.
   */
  tripadvisorKeyword?: string
}

/**
 * Aggregate reputation snapshots from every available local source.
 *
 * Non-fatal by contract: each source is settled independently, so a
 * missing API key or a blocked page yields a partial result rather than
 * blocking discovery. Returns only the snapshots that resolved successfully
 * (may be empty).
 *
 * Sources:
 *   1. Google Business Profile (DataForSEO Business Data — primary)
 *   2. ProductReview.com.au (Jina Reader — AU's dominant review platform)
 *   3. Tripadvisor (DataForSEO Business Data — tourism clients only)
 */
export async function aggregateLocalReviews(
  opts: AggregateLocalReviewsOptions,
): Promise<LocalReviewSnapshot[]> {
  const tasks: Array<Promise<LocalReviewSnapshot | null>> = [
    // Promise.resolve().then(...) so a synchronous throw is captured by
    // allSettled rather than escaping before the await.
    Promise.resolve().then(() => fetchGbpReviews(opts.businessQuery)),
  ]

  if (opts.productReviewUrl) {
    tasks.push(fetchProductReviewReviews(opts.productReviewUrl))
  }

  if (opts.tripadvisorKeyword) {
    tasks.push(fetchTripadvisorReviews(opts.tripadvisorKeyword))
  }

  const settled = await Promise.allSettled(tasks)
  return settled
    .filter(
      (r): r is PromiseFulfilledResult<LocalReviewSnapshot> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)
}
