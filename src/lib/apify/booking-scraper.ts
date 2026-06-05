/**
 * Apify Booking.com scraper wrapper.
 *
 * Scrapes accommodation aggregate rating + review count via the
 * `voyager/booking-scraper` actor.  Accepts a free-text destination search
 * query (not pre-supplied hotel URLs) which matches ME's diagnostic flow
 * (caller has client business name + city, not a Booking property URL).
 *
 * Booking.com uses a 1–10 review scale. Magic Engine reputation scoring
 * standardises on 1–5, normalised via linear remap: ((raw - 1) / 9) * 4 + 1.
 *
 * Caller is responsible for retries / Goal-level orchestration.
 *
 * History:
 *   - 2026-06-05 (PR #385): initial wrapper around zhorex/booking-reviews-scraper.
 *     Discovered in CTS E2E that actor returns 400 — it requires pre-supplied
 *     `hotelUrls`, not a search query.  Doesn't fit ME's diagnostic flow.
 *   - 2026-06-06 (follow-up PR): switched to voyager/booking-scraper which
 *     accepts `search` query.  Also tightened rawScore range check and added
 *     Array.isArray guard to align with other 3 scrapers in this directory.
 */

const APIFY_BASE = 'https://api.apify.com/v2'

// Apify actor-level timeout in seconds; Node fetch abort adds a 15s buffer.
const APIFY_ACTOR_TIMEOUT_SEC = 60

export interface BookingBusinessReviews {
  rating: number       // 1.0 – 5.0 (normalised from Booking's 1–10 scale)
  totalReviews: number
}

/**
 * Read an Apify error response body for inclusion in log lines.
 * Truncates to 300 chars so logs stay readable.
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
 * Linear remap Booking's 1–10 score to ME's 1–5 scale.
 *   1  → 1
 *   10 → 5
 * Formula: ((raw - 1) / 9) * 4 + 1
 *
 * Replaces the earlier `raw / 2` shortcut which was off by ~2 score points
 * at the extremes (e.g. Booking 10 → 5.0 ✓, but Booking 1 → 0.5 ✗).
 */
function normaliseBookingScore(raw: number): number {
  return ((raw - 1) / 9) * 4 + 1
}

/**
 * Search Booking.com for an accommodation and return aggregate rating + review count.
 *
 * The `voyager/booking-scraper` actor accepts a `search` query (destination
 * name) and returns matching properties with their aggregate score and review
 * count.  We take the top match and surface its rating.
 *
 * Conversion: Booking score is 1–10; ME reputation uses 1–5 (linear remap).
 *
 * @param query Rich search string e.g. "Hilton Auckland NZ" or "CTS Tours Auckland".
 * @returns null if no match found or scraper failed.
 */
export async function scrapeBookingBusiness(query: string): Promise<BookingBusinessReviews | null> {
  const token = process.env.APIFY_API_KEY
  if (!token) {
    console.error('[reputation-scraper:booking] APIFY_API_KEY not configured — Booking scrape aborted')
    return null
  }

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/voyager~booking-scraper/run-sync-get-dataset-items?token=${token}&timeout=${APIFY_ACTOR_TIMEOUT_SEC}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          search: query,
          maxItems: 1,
        }),
        signal: AbortSignal.timeout((APIFY_ACTOR_TIMEOUT_SEC + 15) * 1000),
      },
    )

    if (!res.ok) {
      const body = await readApifyErrorBody(res)
      console.error(`[reputation-scraper:booking] Apify error: status=${res.status} query=${query} body=${body}`)
      return null
    }

    const payload = (await res.json()) as unknown
    if (!Array.isArray(payload)) {
      console.error(`[reputation-scraper:booking] expected array payload, got ${typeof payload} query=${query}`)
      return null
    }
    const items = payload as Record<string, unknown>[]
    if (items.length === 0) {
      console.error(`[reputation-scraper:booking] no items for query=${query}`)
      return null
    }

    const first = items[0]

    // Field names vary across actor versions / property types — try common keys.
    const rawScore =
      (first['rating'] as number | undefined) ??
      (first['score'] as number | undefined) ??
      (first['hotelRating'] as number | undefined) ??
      (first['hotelScore'] as number | undefined)

    const rawCount =
      (first['reviews'] as number | undefined) ??
      (first['reviewsCount'] as number | undefined) ??
      (first['totalReviews'] as number | undefined) ??
      (first['hotelReviewsCount'] as number | undefined)

    if (typeof rawScore !== 'number' || typeof rawCount !== 'number') {
      console.error(
        `[reputation-scraper:booking] missing rating/count fields for query=${query} keys=${Object.keys(first).join(',')}`,
      )
      return null
    }

    // Booking scores are 1–10 in spec.  Reject out-of-range values rather than
    // silently clamping — an out-of-range value means the actor changed
    // field semantics and we should rebuild the wrapper, not produce fake data.
    if (rawScore < 1 || rawScore > 10) {
      console.error(
        `[reputation-scraper:booking] rawScore out of expected 1-10 range query=${query} rawScore=${rawScore}`,
      )
      return null
    }
    if (rawCount < 0) {
      console.error(`[reputation-scraper:booking] negative review count query=${query} rawCount=${rawCount}`)
      return null
    }

    const rating = Number(normaliseBookingScore(rawScore).toFixed(2))
    return {
      rating,
      totalReviews: Math.round(rawCount),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[reputation-scraper:booking] scrape failed query=${query} err=${msg}`)
    return null
  }
}
