/**
 * Apify Hipages reputation scraper.
 *
 * Hipages is the primary AU trades / home-services review platform (electricians,
 * plumbers, builders). This wrapper resolves a rich query string (business name +
 * city + country) into an aggregate rating + total review count via the
 * `abotapi/hipages-business-scraper` actor.
 *
 * Contract: returns `null` on any failure (missing token, actor error, no match,
 * malformed response) — callers fall back to other sources. Never throws.
 */

const APIFY_BASE = 'https://api.apify.com/v2'

// Apify actor-level timeout in seconds; separate from the Node fetch abort below.
const APIFY_ACTOR_TIMEOUT_SEC = 60

export interface HipagesBusinessReviews {
  rating: number       // 1.0 - 5.0
  totalReviews: number
}

/**
 * Read an Apify error response without consuming the body for the success path.
 * Returns a short summary suitable for inclusion in error logs.
 */
async function readApifyErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    return text.length > 300 ? `${text.slice(0, 300)}…` : text
  } catch {
    return '(body unreadable)'
  }
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = record[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string') {
      const parsed = Number.parseFloat(raw)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

/**
 * Search Hipages for a tradesperson business and return aggregate rating + review count.
 * @param query Rich search string e.g. "John's Plumbing Brisbane AU".
 * @returns null if no match found or scraper failed.
 */
export async function scrapeHipagesBusiness(query: string): Promise<HipagesBusinessReviews | null> {
  const token = process.env.APIFY_API_KEY
  if (!token) {
    console.error('[reputation-scraper:hipages] APIFY_API_KEY not configured — scrape aborted')
    return null
  }

  const trimmed = query.trim()
  if (!trimmed) {
    console.error('[reputation-scraper:hipages] query is empty — skipping')
    return null
  }

  try {
    const res = await fetch(
      `${APIFY_BASE}/acts/abotapi~hipages-business-scraper/run-sync-get-dataset-items?token=${token}&timeout=${APIFY_ACTOR_TIMEOUT_SEC}`,
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
      console.error(`[reputation-scraper:hipages] Apify error: status=${res.status} query="${trimmed}" body=${body}`)
      return null
    }

    const items = (await res.json()) as Record<string, unknown>[]
    if (!Array.isArray(items) || items.length === 0) {
      console.error(`[reputation-scraper:hipages] returned no matches for query="${trimmed}"`)
      return null
    }

    const first = items[0] ?? {}
    const rating = pickNumber(first, ['rating', 'averageRating', 'ratingValue', 'overallRating'])
    const totalReviews = pickNumber(first, ['totalReviews', 'reviewCount', 'reviewsCount', 'numberOfReviews'])

    if (rating === null || totalReviews === null) {
      console.error(`[reputation-scraper:hipages] payload missing rating/review fields for query="${trimmed}" keys=${Object.keys(first).join(',')}`)
      return null
    }

    if (rating < 1 || rating > 5 || totalReviews < 0) {
      console.error(`[reputation-scraper:hipages] rating/review out of range for query="${trimmed}" rating=${rating} totalReviews=${totalReviews}`)
      return null
    }

    return {
      rating,
      totalReviews: Math.round(totalReviews),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[reputation-scraper:hipages] scrape threw for query="${trimmed}" error=${message}`)
    return null
  }
}
