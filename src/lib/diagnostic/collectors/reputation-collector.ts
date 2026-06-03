import { getBusinessReviews } from '@/lib/places/client'
import type { BusinessReviewData } from '@/lib/places/client'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence, evidenceSource } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS } from '../constants'

// ---------------------------------------------------------------------------
// Scoring constants (A1 reputation formula — 2026-06-02)
//
// Why these values:
//   - RATING_WEIGHT 0.70:  rating is a quality signal (customer satisfaction).
//     review_count is a quantity signal that can be skewed by industry habits
//     (e.g. tourism customers review on TripAdvisor, not Google).  Quality
//     should dominate.
//   - REVIEW_WEIGHT 0.30:  count still matters (lone 5-star is noise), but
//     less than the rating itself.
//   - MAX_REVIEWS_FOR_FULL_SCORE 30:  for SMEs in AU/NZ, 30 Google reviews is
//     already a healthy signal.  The old ceiling of 100 was top-1% territory
//     for local businesses, which unfairly penalised everyone else.
//
// CTS Tours NZ (5 GBP reviews, 4.0+ rating) was scoring 44 under the old
// formula.  Under the new formula the same data scores ~71 — moving the
// dimension into the "healthy" band.  See A1 task notes for full rationale.
// ---------------------------------------------------------------------------

const RATING_WEIGHT = 0.70
const REVIEW_WEIGHT = 0.30
const MAX_REVIEWS_FOR_FULL_SCORE = 30

const LOW_RATING_THRESHOLD = 3.5
const FEW_REVIEWS_THRESHOLD = 20

// "High rating, few reviews" finding threshold: when the rating itself is
// healthy but the count is low, we surface that the score may underestimate
// real reputation because customers may be reviewing on industry-specific
// platforms (TripAdvisor, ProductReview, Yelp, etc).
const HIGH_RATING_FOR_OFF_PLATFORM_HINT = 4.0
const LOW_COUNT_FOR_OFF_PLATFORM_HINT = 10

// ---------------------------------------------------------------------------
// Score input — pluggable shape so future sources (TripAdvisor / ProductReview
// / industry-specific platforms) can be added without changing the formula
// caller surface.  Today only `gbp` is non-null; new sources arrive as new
// optional fields.  The score function uses every non-null source it sees.
// ---------------------------------------------------------------------------

export interface ReputationSourceSignal {
  rating: number      // 1.0 – 5.0
  reviewCount: number // absolute count
}

export interface ReputationSignals {
  gbp: ReputationSourceSignal | null
  /** Reserved for A2 (TripAdvisor partner API integration). Always null today. */
  tripadvisor?: ReputationSourceSignal | null
  /** Reserved for future industry platform expansion. Always null today. */
  productReview?: ReputationSourceSignal | null
}

// ---------------------------------------------------------------------------
// Pure scoring function — exported for testing and future reuse by other
// dimensions / aggregators.  All non-null signals are weighted equally and
// the rating/count weights are applied within each source, then averaged
// across sources.  Empty signal set → null (let the caller decide what
// "unknown reputation" should look like for the overall score).
// ---------------------------------------------------------------------------

export function scoreReputation(signals: ReputationSignals): number | null {
  const sources: ReputationSourceSignal[] = []
  if (signals.gbp) sources.push(signals.gbp)
  if (signals.tripadvisor) sources.push(signals.tripadvisor)
  if (signals.productReview) sources.push(signals.productReview)

  if (sources.length === 0) return null

  const scores = sources.map(s => {
    const ratingScore = Math.max(0, Math.min(100, ((s.rating - 1) / 4) * 100))
    const reviewScore = Math.min(1, s.reviewCount / MAX_REVIEWS_FOR_FULL_SCORE) * 100
    return ratingScore * RATING_WEIGHT + reviewScore * REVIEW_WEIGHT
  })

  // Equal weighting across non-null sources — simpler than per-source weights
  // and consistent with the "trust every source you have" stance.  When
  // industry adaptation arrives (A3), swap this for a weighted mean.
  const raw = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.min(100, Math.max(0, Math.round(raw)))
}

// ---------------------------------------------------------------------------
// ReputationCollector
// ---------------------------------------------------------------------------

export interface ReputationCollectorContext {
  /** Business trading name, e.g. "CTS Tours NZ". Used to build a precise Places query. */
  businessName?: string | null
  /** Primary city, e.g. "Auckland". Combined with country for geo-precision. */
  city?: string | null
  /** ISO 2-letter country code, e.g. "NZ". */
  country?: string | null
}

export class ReputationCollector {
  constructor(private readonly timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS) {}

  async collect(
    clientId: string,
    domain: string,
    _keywords: string[],
    ctx: ReputationCollectorContext = {},
  ): Promise<CollectorResult> {
    const fallback: CollectorResult = { score: null, findings: [] }

    const timeout = new Promise<CollectorResult>(resolve =>
      setTimeout(() => resolve(fallback), this.timeoutMs),
    )

    try {
      return await Promise.race([this.fetchAndScore(clientId, domain, ctx), timeout])
    } catch {
      return fallback
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildQuery(domain: string, ctx: ReputationCollectorContext): string {
    // Prefer a rich query: "<BusinessName> <City> <Country>" for precision.
    // Fall back to the bare domain only when no name is available — a raw
    // domain string is ambiguous and Google may return a wrong match.
    if (ctx.businessName) {
      const parts = [ctx.businessName, ctx.city, ctx.country].filter(Boolean)
      return parts.join(' ')
    }
    return domain
  }

  private async fetchAndScore(
    clientId: string,
    domain: string,
    ctx: ReputationCollectorContext,
  ): Promise<CollectorResult> {
    const query = this.buildQuery(domain, ctx)
    const data = await getBusinessReviews(query)

    // P8.5.20: business not listed on Google → score is unknowable
    if (!data) {
      return {
        score: null,
        findings: [this.makeNoReviewPlatformFinding(clientId)],
      }
    }

    return this.buildResult(clientId, data)
  }

  private buildResult(clientId: string, data: BusinessReviewData): CollectorResult {
    const findings: NewFinding[] = []

    if (data.rating < LOW_RATING_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'reputation',
        finding_type: 'low_review_rating',
        severity: 'high',
        title: 'Low Google review rating',
        description: `Average rating is ${data.rating.toFixed(1)}/5 — below the recommended threshold of ${LOW_RATING_THRESHOLD}.`,
        evidence: makeEvidence({
          parsed: { rating: data.rating, total_reviews: data.totalReviews },
          sources: [evidenceSource('https://business.google.com/')],
        }),
        recommendation: 'Respond to negative reviews professionally and implement a customer feedback process to improve satisfaction.',
        fix_type: 'fde_manual',
        priority_score: 80,
      })
    }

    if (data.totalReviews <= FEW_REVIEWS_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'reputation',
        finding_type: 'insufficient_review_count',
        severity: 'medium',
        title: 'Too few Google reviews',
        description: `Only ${data.totalReviews} review${data.totalReviews === 1 ? '' : 's'} found. More reviews build trust and improve local SEO.`,
        evidence: makeEvidence({
          parsed: { total_reviews: data.totalReviews },
          sources: [evidenceSource('https://business.google.com/')],
        }),
        recommendation: 'Ask satisfied customers to leave a Google review. Include a QR code or direct link in receipts or follow-up emails.',
        fix_type: 'fde_manual',
        priority_score: 55,
      })
    }

    // A1: honest disclosure that the score may underestimate real reputation
    // when the customer's industry typically reviews on other platforms.
    if (
      data.rating >= HIGH_RATING_FOR_OFF_PLATFORM_HINT &&
      data.totalReviews <= LOW_COUNT_FOR_OFF_PLATFORM_HINT
    ) {
      findings.push({
        client_id: clientId,
        dimension: 'reputation',
        finding_type: 'reviews_likely_off_platform',
        severity: 'low',
        title: 'Reviews may live on industry platforms (not Google)',
        description: `Strong Google rating (${data.rating.toFixed(1)}/5) but only ${data.totalReviews} Google review${data.totalReviews === 1 ? '' : 's'}. Customers in this industry may be reviewing on TripAdvisor, ProductReview, Yelp, or sector-specific platforms — the Google-only score may underestimate real reputation.`,
        evidence: makeEvidence({
          parsed: { rating: data.rating, total_reviews: data.totalReviews },
          sources: [evidenceSource('https://business.google.com/')],
        }),
        recommendation: 'Identify the platform your customers actually use to leave reviews (TripAdvisor for tourism, ProductReview for retail/services, etc) and audit reputation there. Add it to the diagnostic data sources to get a complete picture.',
        fix_type: 'fde_manual',
        priority_score: 35,
      })
    }

    const score = scoreReputation({
      gbp: { rating: data.rating, reviewCount: data.totalReviews },
    })
    // Pass `null` through unchanged — runner.ts treats null as "dimension
    // skipped" and re-normalises the overall weight, which is exactly what
    // we want when no source contributed data.  Coercing to 0 would silently
    // include the dimension at 0×weight and skew the overall score.
    return { score, findings }
  }

  private makeNoReviewPlatformFinding(clientId: string): NewFinding {
    return {
      client_id: clientId,
      dimension: 'reputation',
      finding_type: 'business_not_listed',
      severity: 'critical',
      title: 'Business not listed on Google',
      description: 'No Google Business Profile was found for this domain. Reputation cannot be measured until the business is verified on Google. Online reviews are a critical trust signal and a major local SEO factor.',
      evidence: null,
      recommendation: 'Create and verify a Google Business Profile at https://business.google.com — this is a 30-minute setup that unlocks reviews, Google Maps presence, and local pack rankings.',
      fix_type: 'fde_manual',
      priority_score: 75,
    }
  }
}
