/**
 * Apify Booking.com reviews scraper wrapper.
 *
 * Scrapes accommodation aggregate rating + review count via the
 * `zhorex/booking-reviews-scraper` actor ($0.001/review, tourism use cases).
 *
 * Booking.com uses a 1–10 review scale. Magic Engine reputation scoring
 * standardises on 1–5, so the raw score is divided by 2 before returning.
 *
 * Caller is responsible for retries / Goal-level orchestration.
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
 * Search Booking.com for an accommodation and return aggregate rating + review count.
 *
 * The `zhorex/booking-reviews-scraper` actor accepts `startUrls` pointing at
 * Booking.com search-result pages; it follows the top match and emits per-review
 * items plus property-level metadata (`hotelRating` 1–10, `reviewsCount`).
 *
 * Conversion: Booking score is on a 1–10 scale; ME reputation scoring uses 1–5,
 * so we divide by 2 (e.g. Booking 8.6 → ME 4.3).
 *
 * @param query Rich search string e.g. "Hilton Auckland NZ".
 * @returns null if no match found or scraper failed.
 */
export async function scrapeBookingBusiness(query: string): Promise<BookingBusinessReviews | null> {
  const token = process.env.APIFY_API_KEY
  if (!token) {
    console.error('[reputation-scraper] APIFY_API_KEY not configured — Booking scrape aborted')
    return null
  }

  const searchUrl = `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(query)}`

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/zhorex~booking-reviews-scraper/run-sync-get-dataset-items?token=${token}&timeout=${APIFY_ACTOR_TIMEOUT_SEC}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url: searchUrl }],
          maxReviewsPerHotel: 1, // we only need aggregate stats, not review bodies
          maxHotels: 1,
        }),
        signal: AbortSignal.timeout((APIFY_ACTOR_TIMEOUT_SEC + 15) * 1000),
      },
    )

    if (!res.ok) {
      const body = await readApifyErrorBody(res)
      console.error(`[reputation-scraper] Apify Booking error: status=${res.status} query=${query} body=${body}`)
      return null
    }

    const items = (await res.json()) as Record<string, unknown>[]
    if (items.length === 0) {
      console.error(`[reputation-scraper] Apify Booking returned no items for query=${query}`)
      return null
    }

    // The actor emits one item per review; each carries the parent hotel's
    // aggregate fields. Read from the first item.
    const first = items[0]

    // Field name varies across actor versions — try the common keys.
    const rawScore =
      (first['hotelRating'] as number | undefined) ??
      (first['hotelScore'] as number | undefined) ??
      (first['score'] as number | undefined) ??
      (first['rating'] as number | undefined)

    const rawCount =
      (first['reviewsCount'] as number | undefined) ??
      (first['hotelReviewsCount'] as number | undefined) ??
      (first['totalReviews'] as number | undefined)

    if (typeof rawScore !== 'number' || typeof rawCount !== 'number') {
      console.error(
        `[reputation-scraper] Apify Booking missing rating/count fields for query=${query} keys=${Object.keys(first).join(',')}`,
      )
      return null
    }

    // Booking uses 1–10; normalise to ME's 1–5 scale.
    const normalised = rawScore / 2
    const rating = Math.max(1, Math.min(5, Number(normalised.toFixed(2))))

    return {
      rating,
      totalReviews: Math.max(0, Math.round(rawCount)),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[reputation-scraper] Apify Booking scrape failed query=${query} err=${msg}`)
    return null
  }
}
