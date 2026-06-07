/**
 * Apify TripAdvisor business-review scraper.
 *
 * Mirrors the structure of `social-scraper.ts` (single-actor, sync run, fixed
 * timeout) but is purpose-built for reputation-collector: caller only needs an
 * aggregate rating + total review count, NOT review text.  Returning review
 * bodies would burn Apify credits and force callers to dedupe / parse text.
 *
 * Failure policy: this function NEVER throws.  reputation-collector dispatches
 * all per-source fetches via `Promise.all`, where a single throw would abort
 * the other sources (GBP / ProductReview / Booking).  Every failure mode below
 * (missing key, non-2xx, network timeout, malformed payload, no match) is
 * logged with `[reputation-scraper:tripadvisor]` prefix and returns `null` instead.
 */

const APIFY_BASE = 'https://api.apify.com/v2'

// Apify actor-level timeout in seconds; the client AbortSignal adds 15s buffer
// so the actor has time to flush its dataset before we cut the socket.
const APIFY_ACTOR_TIMEOUT_SEC = 60

// We only need the highest-confidence first hit — the Apify actor ranks results
// by TripAdvisor's own relevance score, so item[0] is the canonical business
// page for a well-formed query like "CTS Tours Auckland NZ".
const MAX_ITEMS_PER_QUERY = 1

export interface TripAdvisorBusinessReviews {
  rating: number       // 1.0 – 5.0
  totalReviews: number // total review count on TripAdvisor
}

/**
 * Read an Apify error response body for log/error messages.  Truncates to keep
 * server logs bounded (Apify can emit multi-KB error envelopes).
 */
async function readApifyErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return '(body unreadable)'
  }
}

/**
 * Extract a numeric field from either the top-level item or a nested
 * `placeInfo` object — TripAdvisor actor versions differ on where rating /
 * numberOfReviews live, so we tolerate both shapes.
 */
function pickNumber(item: Record<string, unknown>, key: string): number | null {
  const top = item[key]
  if (typeof top === 'number' && Number.isFinite(top)) return top
  const placeInfo = item['placeInfo'] as Record<string, unknown> | undefined
  if (placeInfo) {
    const nested = placeInfo[key]
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested
  }
  return null
}

/**
 * Search TripAdvisor for a business and return aggregate rating + review count.
 *
 * @param query Rich search string e.g. "CTS Tours Auckland NZ" (NOT a bare
 *              domain — TripAdvisor's relevance ranking degrades sharply on
 *              ambiguous single-token inputs).
 * @returns `null` when the scraper fails for ANY reason (missing key, 4xx/5xx,
 *          network timeout, empty result set, malformed rating/count).  Never
 *          throws — see file header for why.
 */
export async function scrapeTripadvisorBusiness(
  query: string,
): Promise<TripAdvisorBusinessReviews | null> {
  const token = process.env.APIFY_API_KEY
  if (!token) {
    console.error('[reputation-scraper:tripadvisor] APIFY_API_KEY not configured — scrape aborted')
    return null
  }

  const trimmed = query.trim()
  if (!trimmed) {
    console.error('[reputation-scraper:tripadvisor] scrape called with empty query — aborted')
    return null
  }

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/maxcopell~tripadvisor/run-sync-get-dataset-items?token=${token}&timeout=${APIFY_ACTOR_TIMEOUT_SEC}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          maxItemsPerQuery: MAX_ITEMS_PER_QUERY,
          includeHotels: true,
          includeRestaurants: true,
          includeAttractions: true,
          includeVacationRentals: true,
          language: 'en',
        }),
        signal: AbortSignal.timeout((APIFY_ACTOR_TIMEOUT_SEC + 15) * 1000),
      },
    )

    if (!res.ok) {
      const body = await readApifyErrorBody(res)
      console.error(
        `[reputation-scraper:tripadvisor] Apify error: status=${res.status} query=${trimmed} body=${body}`,
      )
      return null
    }

    const items = (await res.json()) as Record<string, unknown>[]
    if (!Array.isArray(items) || items.length === 0) {
      console.error(
        `[reputation-scraper:tripadvisor] Apify returned no items for query=${trimmed}`,
      )
      return null
    }

    const first = items[0]
    const rating = pickNumber(first, 'rating')
    const totalReviews = pickNumber(first, 'numberOfReviews')

    if (rating === null || totalReviews === null) {
      console.error(
        `[reputation-scraper:tripadvisor] Apify payload missing rating/numberOfReviews for query=${trimmed}`,
      )
      return null
    }

    // Sanity bounds — TripAdvisor ratings are 1.0–5.0 in half-star steps; a
    // value outside this range means the actor returned junk (e.g. a category
    // page where "rating" is a placeholder), and we should not feed it to the
    // reputation formula.
    if (rating < 1 || rating > 5 || totalReviews < 0) {
      console.error(
        `[reputation-scraper:tripadvisor] Apify out-of-range values for query=${trimmed} rating=${rating} totalReviews=${totalReviews}`,
      )
      return null
    }

    return { rating, totalReviews: Math.round(totalReviews) }
  } catch (err) {
    // Catches: AbortSignal timeout, network errors, JSON parse errors, anything
    // else the runtime can throw inside fetch.  Stringify defensively because
    // some platforms throw non-Error objects.
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[reputation-scraper:tripadvisor] Apify network/parse failure: query=${trimmed} error=${msg}`,
    )
    return null
  }
}
