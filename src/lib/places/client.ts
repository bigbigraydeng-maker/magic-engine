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

/** One Google review as returned by Places Details API. */
export interface GBPReview {
  author_name: string
  rating: number                    // 1–5
  text: string
  relative_time_description: string // e.g. "3 months ago"
  time: number                      // unix timestamp
  profile_photo_url?: string
}

export interface BusinessReviewDetails extends BusinessReviewData {
  reviews: GBPReview[]
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

/**
 * Fetch full review texts for a business via Places Details API.
 *
 * Returns up to 5 reviews (Google Places API limit for text search results).
 * The Places Details `reviews` field always comes sorted by relevance (recency + rating).
 *
 * @param query  Rich search string, same as getBusinessReviews.
 */
export async function getBusinessReviewDetails(query: string): Promise<BusinessReviewDetails | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not configured')

  // Step 1: Text search to find the place_id
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

  // Step 2: Places Details to get review texts
  const fields = 'place_id,name,rating,user_ratings_total,reviews'
  const detailRes = await fetch(
    `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(place.place_id)}&fields=${fields}&language=en&key=${key}`,
  )
  if (!detailRes.ok) throw new Error(`Places details error: ${detailRes.status}`)

  const detailData = (await detailRes.json()) as {
    result?: {
      place_id: string
      name: string
      rating?: number
      user_ratings_total?: number
      reviews?: Array<{
        author_name: string
        rating: number
        text: string
        relative_time_description: string
        time: number
        profile_photo_url?: string
      }>
    }
    status: string
  }

  if (detailData.status !== 'OK' || !detailData.result) return null

  const detail = detailData.result
  const reviews: GBPReview[] = (detail.reviews ?? [])
    .filter(r => r.text && r.text.trim().length > 0)
    .map(r => ({
      author_name: r.author_name,
      rating: r.rating,
      text: r.text.trim(),
      relative_time_description: r.relative_time_description,
      time: r.time,
      profile_photo_url: r.profile_photo_url,
    }))

  return {
    placeId: detail.place_id,
    name: detail.name,
    rating: detail.rating ?? place.rating ?? 0,
    totalReviews: detail.user_ratings_total ?? place.user_ratings_total ?? 0,
    reviews,
  }
}
