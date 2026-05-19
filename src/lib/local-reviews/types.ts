/**
 * Local review aggregation connector — type definitions.
 *
 * Reference: ROADMAP.md P8.12.S1.2 / P8.13.C.3
 *
 * Aggregates real reputation signals from AU/NZ-relevant sources:
 *  - Google Business Profile (DataForSEO Business Data — primary; was SerpAPI)
 *  - ProductReview.com.au (Jina Reader — AU's dominant review platform)
 *  - Tripadvisor (DataForSEO Business Data — tourism clients / CTS Tours)
 *
 * Purpose: replace LLM-guessed ratings / review counts with verified data,
 * and surface concrete negative-review evidence for the diagnosis.
 */

export type LocalReviewSource = 'google' | 'productreview' | 'tripadvisor'

/** A single sampled review (used for negative-evidence excerpts). */
export interface ReviewSample {
  rating: number                     // 1–5
  text: string
  date: string | null               // upstream-provided, free-form
  author: string | null
}

/** Star-rating breakdown: count of reviews at each star level. */
export type RatingDistribution = Record<'1' | '2' | '3' | '4' | '5', number>

/**
 * Normalised reputation snapshot for one review source.
 * Fields that a given source cannot expose are left null.
 */
export interface LocalReviewSnapshot {
  source: LocalReviewSource
  url: string | null
  rating: number | null              // overall average, 1–5
  review_count: number | null
  rating_distribution: RatingDistribution | null
  recent_negative_samples: ReviewSample[]   // reviews with rating <= 2
  response_rate: number | null               // 0–1 owner-response rate; null if unknown
}

