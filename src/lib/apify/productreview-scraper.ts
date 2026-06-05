/**
 * Apify ProductReview.com.au scraper wrapper.
 *
 * Scrapes aggregate business rating + review count from ProductReview.com.au,
 * Australia's largest consumer review platform (building / professional /
 * retail / education coverage).
 *
 * Actor: abotapi/product-reviews-australia-scraper
 * Docs:  https://apify.com/abotapi/product-reviews-australia-scraper
 *
 * Mirrors the pattern in social-scraper.ts (run-sync-get-dataset-items endpoint,
 * client-side abort timeout, error body capture). Unlike the social scrapers,
 * this function swallows failures and returns null so the reputation collector
 * can degrade gracefully when ProductReview has no match for a given business.
 */

const APIFY_BASE = 'https://api.apify.com/v2'
const APIFY_ACTOR_TIMEOUT_SEC = 60

export interface ProductReviewBusinessReviews {
  rating: number       // 1.0 - 5.0
  totalReviews: number // total review count
}

/**
 * Read an Apify error response without consuming the body for the success path.
 * Returns a short summary suitable for inclusion in thrown error messages.
 * Best-effort: if reading the body fails, returns a fixed sentinel.
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
 * Coerce a value that may be a number or numeric string into a finite number,
 * or null when it cannot be parsed.
 */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    // Strip thousands separators / non-numeric chrome ("1,234 reviews" → "1234").
    const cleaned = v.replace(/[^0-9.]/g, '')
    if (!cleaned) return null
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Extract { rating, totalReviews } from a raw actor result item. ProductReview
 * actors have historically used a few different field names; try the common
 * ones in order. Returns null when neither rating nor review count is present.
 */
function parseItem(item: Record<string, unknown>): ProductReviewBusinessReviews | null {
  const rating =
    toFiniteNumber(item['rating']) ??
    toFiniteNumber(item['averageRating']) ??
    toFiniteNumber(item['overallRating']) ??
    toFiniteNumber(item['stars'])

  const totalReviews =
    toFiniteNumber(item['totalReviews']) ??
    toFiniteNumber(item['reviewCount']) ??
    toFiniteNumber(item['numberOfReviews']) ??
    toFiniteNumber(item['reviewsCount'])

  if (rating == null || totalReviews == null) return null
  if (rating < 0 || rating > 5) return null
  if (totalReviews < 0) return null

  return { rating, totalReviews }
}

/**
 * Search ProductReview.com.au for a business and return aggregate rating + review count.
 * @param query Rich search string e.g. "Oztop Brisbane AU" or "GoTo Flooring".
 * @returns null if no match found or scraper failed.
 */
export async function scrapeProductReviewBusiness(
  query: string,
): Promise<ProductReviewBusinessReviews | null> {
  const token = process.env.APIFY_API_KEY
  if (!token) {
    console.error('[reputation-scraper] APIFY_API_KEY not configured — ProductReview scrape aborted')
    return null
  }

  const trimmed = query.trim()
  if (!trimmed) {
    console.error('[reputation-scraper] ProductReview scrape called with empty query')
    return null
  }

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/abotapi~product-reviews-australia-scraper/run-sync-get-dataset-items?token=${token}&timeout=${APIFY_ACTOR_TIMEOUT_SEC}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          search: trimmed,
          maxItems: 1,
        }),
        signal: AbortSignal.timeout((APIFY_ACTOR_TIMEOUT_SEC + 15) * 1000),
      },
    )

    if (!res.ok) {
      const body = await readApifyErrorBody(res)
      console.error(
        `[reputation-scraper] Apify ProductReview error: status=${res.status} query="${trimmed}" body=${body}`,
      )
      return null
    }

    const items = (await res.json()) as Record<string, unknown>[]
    if (!Array.isArray(items) || items.length === 0) {
      console.error(`[reputation-scraper] ProductReview returned no items for query="${trimmed}"`)
      return null
    }

    for (const item of items) {
      const parsed = parseItem(item)
      if (parsed) return parsed
    }

    console.error(
      `[reputation-scraper] ProductReview returned ${items.length} item(s) but none had rating + reviewCount for query="${trimmed}"`,
    )
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[reputation-scraper] ProductReview scrape threw for query="${trimmed}": ${msg}`)
    return null
  }
}
