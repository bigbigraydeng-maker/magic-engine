/**
 * Google Places API wrapper — fetches business review data.
 *
 * Uses Places Text Search to locate a business by name + location, then
 * retrieves its rating and review count from the first matched result.
 *
 * Callers MUST pass a rich query string (e.g. `"CTS Tours" Auckland NZ`) rather
 * than a raw domain.  A bare domain like `ctstours.com.au` returns the first
 * result Google considers relevant, which is often a wrong match.  The
 * reputation-collector builds the query from the client's `name`, `city`, and
 * `country` fields before calling here.
 */

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place'

export interface BusinessReviewData {
  placeId: string
  name: string
  rating: number        // 1.0–5.0
  totalReviews: number
}

/** @param query  Rich search string, e.g. `"Acme Corp" Sydney AU`. Never pass a bare domain. */
export async function getBusinessReviews(query: string): Promise<BusinessReviewData | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not configured')

  // Step 1: Text search to find the place
  const searchRes = await fetch(
    `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`,
  )
  if (!searchRes.ok) throw new Error(`Places text search error: ${searchRes.status}`)

  const searchData = (await searchRes.json()) as {
    results: { place_id: string; name: string; rating?: number; user_ratings_total?: number }[]
    status: string
  }

  if (searchData.status !== 'OK' || searchData.results.length === 0) return null

  const place = searchData.results[0]

  return {
    placeId: place.place_id,
    name: place.name,
    rating: place.rating ?? 0,
    totalReviews: place.user_ratings_total ?? 0,
  }
}
