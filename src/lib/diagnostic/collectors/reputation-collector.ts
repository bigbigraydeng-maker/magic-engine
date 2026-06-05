import { getBusinessReviews } from '@/lib/places/client'
import { scrapeTripadvisorBusiness } from '@/lib/apify/tripadvisor-scraper'
import { scrapeProductReviewBusiness } from '@/lib/apify/productreview-scraper'
import { scrapeBookingBusiness } from '@/lib/apify/booking-scraper'
import { scrapeHipagesBusiness } from '@/lib/apify/hipages-scraper'
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

/**
 * All reputation sources currently supported.  Add new keys here when a new
 * Apify scraper / API integration lands — the scoring function picks up the
 * new key automatically as long as INDUSTRY_REPUTATION_WEIGHTS is updated.
 */
export type ReputationSource =
  | 'gbp'             // Google Business Profile via Google Places API (all industries)
  | 'tripadvisor'     // Apify maxcopell/tripadvisor-scraper (tourism + restaurant primary)
  | 'productReview'   // Apify abotapi/product-reviews-australia-scraper (building/services/retail/education)
  | 'booking'         // Apify zhorex/booking-reviews-scraper (tourism — accommodation focus)
  | 'hipages'         // Apify abotapi/hipages-business-scraper (trades / building services)

export type ReputationSignals = Partial<Record<ReputationSource, ReputationSourceSignal | null>>

/**
 * Industries we apply differentiated source weights for.  Anything not listed
 * here falls back to DEFAULT_INDUSTRY_WEIGHTS (Google Reviews only).
 *
 * These string keys mirror clients.industry free-text values normalised by the
 * caller — the collector matches case-insensitively against this map.
 */
export type ReputationIndustry =
  | 'tourism'         // travel agents, tour operators, hotels — TripAdvisor primary
  | 'restaurant'      // restaurants, cafes — TripAdvisor primary
  | 'building'        // building supplies, flooring, materials — ProductReview primary
  | 'professional'   // legal / accounting / consulting — ProductReview primary
  | 'retail'          // general retail — ProductReview primary
  | 'education'       // tutoring, training providers — ProductReview primary
  | 'trades'          // electricians, plumbers, builders — Hipages primary

/**
 * Per-industry source weights.  Each row MUST sum to 1.0.  Sources not listed
 * (or set to 0) are ignored even if data was fetched — this lets us "fetch
 * everything in case it's there" while still scoring only what matters for the
 * industry.
 *
 * Weights reflect where AU/NZ customers actually leave reviews per industry:
 *   - tourism:  TripAdvisor is the dominant review platform; Booking adds
 *               accommodation depth.  Google still matters but is secondary.
 *   - building: ProductReview.com.au is the AU-specific platform for tradespeople
 *               and building materials.  Google is co-primary for foot traffic.
 *   - trades:   Hipages owns trades reviews in AU.  Google still matters.
 *   - default:  any unknown industry collapses to Google-only — preserves
 *               existing behaviour, no regression for industries we haven't
 *               classified yet.
 */
export const INDUSTRY_REPUTATION_WEIGHTS: Record<ReputationIndustry, Partial<Record<ReputationSource, number>>> = {
  tourism:      { gbp: 0.30, tripadvisor: 0.50, booking: 0.20 },
  restaurant:   { gbp: 0.40, tripadvisor: 0.60 },
  building:     { gbp: 0.50, productReview: 0.50 },
  professional: { gbp: 0.50, productReview: 0.50 },
  retail:       { gbp: 0.50, productReview: 0.50 },
  education:    { gbp: 0.50, productReview: 0.50 },
  trades:       { gbp: 0.40, hipages: 0.60 },
}

export const DEFAULT_INDUSTRY_WEIGHTS: Partial<Record<ReputationSource, number>> = { gbp: 1.0 }

/**
 * Map free-text clients.industry value → ReputationIndustry bucket.  Returns
 * null when no mapping exists (caller uses DEFAULT_INDUSTRY_WEIGHTS).
 *
 * Mirrors src/lib/strategy/industry-mapping.ts pattern but uses ME's own
 * reputation taxonomy (which is broader — tourism covers both inbound and
 * outbound since reputation reviews don't care about direction).
 */
export function resolveReputationIndustry(industry: string | null | undefined): ReputationIndustry | null {
  if (!industry) return null
  const k = industry.trim().toLowerCase().replace(/\s+/g, ' ')
  switch (k) {
    case 'travel':
    case 'tourism':
    case 'tour operator':
    case 'inbound tour':
    case 'inbound tourism':
    case '入境旅游':
    case '出境旅游':
    case '中文旅行社':
      return 'tourism'
    case 'restaurant':
    case 'food':
    case 'cafe':
    case '餐饮':
    case '中餐':
      return 'restaurant'
    case 'flooring':
    case 'tiles':
    case 'flooring & tiles':
    case 'flooring and tiles':
    case 'building':
    case 'building materials':
    case '地板':
    case '瓷砖':
    case '建材':
      return 'building'
    case 'legal':
    case 'law':
    case 'accounting':
    case 'consulting':
    case 'professional services':
      return 'professional'
    case 'retail':
    case 'shop':
    case '零售':
      return 'retail'
    case 'education':
    case 'tutoring':
    case 'training':
    case '教育':
    case '留学':
      return 'education'
    case 'electrician':
    case 'plumber':
    case 'builder':
    case 'trades':
    case 'tradesperson':
      return 'trades'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Pure scoring function — exported for testing and future reuse by other
// dimensions / aggregators.  Each source's individual score is computed using
// the rating/count weights, then sources are combined using the per-industry
// weight table.  Sources without data (null) are dropped and remaining
// weights are re-normalised so partial coverage still produces a sensible
// 0–100 result.
// ---------------------------------------------------------------------------

export function scoreReputation(
  signals: ReputationSignals,
  industry?: ReputationIndustry | null,
): number | null {
  const weights = industry
    ? INDUSTRY_REPUTATION_WEIGHTS[industry]
    : DEFAULT_INDUSTRY_WEIGHTS

  // Compute (sourceScore, weight) pairs only for sources that have data
  // AND have a non-zero weight in the industry table.
  let weightedSum = 0
  let totalWeight = 0
  for (const [source, signal] of Object.entries(signals)) {
    if (!signal) continue
    const w = weights[source as ReputationSource] ?? 0
    if (w <= 0) continue
    const ratingScore = Math.max(0, Math.min(100, ((signal.rating - 1) / 4) * 100))
    const reviewScore = Math.min(1, signal.reviewCount / MAX_REVIEWS_FOR_FULL_SCORE) * 100
    const sourceScore = ratingScore * RATING_WEIGHT + reviewScore * REVIEW_WEIGHT
    weightedSum += sourceScore * w
    totalWeight += w
  }

  if (totalWeight === 0) return null
  return Math.min(100, Math.max(0, Math.round(weightedSum / totalWeight)))
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
  /**
   * Free-text clients.industry value (e.g. 'travel', 'flooring', 'restaurant').
   * Resolved to a ReputationIndustry bucket via resolveReputationIndustry to
   * select per-source weights.  null/unmapped industries fall back to Google-only.
   */
  industry?: string | null
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
    const industry = resolveReputationIndustry(ctx.industry)

    // Fetch every source in parallel — each fetcher is fault-tolerant and
    // returns null on failure.  Industry-irrelevant sources (weight=0 in the
    // industry table) are short-circuited to null to avoid wasted Apify calls.
    const sources = await this.fetchAllSources(query, industry, ctx)

    // Google Business Profile is still the canonical "is this business
    // discoverable" signal.  Surface the "business not listed" finding when
    // GBP returned no match, regardless of other sources.
    if (!sources.gbp && !sources.tripadvisor && !sources.productReview && !sources.booking && !sources.hipages) {
      return {
        score: null,
        findings: [this.makeNoReviewPlatformFinding(clientId)],
      }
    }

    return this.buildResult(clientId, sources, industry)
  }

  /**
   * Parallel-fetch all relevant reputation sources for the given industry.
   * Each fetcher catches its own errors and returns null on failure so a
   * single platform outage doesn't tank the whole dimension.
   *
   * Sources with weight 0 in the industry table are skipped entirely
   * (no Apify call made) — saves credits and reduces latency.
   *
   * NB to apify-actor agents:
   *   - Add a new private async fetch<Source>() method below.
   *   - Wire it into the Promise.all here, gated by industry weight.
   *   - Stage-3 integration (Claude) will run after all 5 fetchers exist.
   */
  private async fetchAllSources(
    query: string,
    industry: ReputationIndustry | null,
    _ctx: ReputationCollectorContext,
  ): Promise<ReputationSignals> {
    const weights = industry
      ? INDUSTRY_REPUTATION_WEIGHTS[industry]
      : DEFAULT_INDUSTRY_WEIGHTS

    // Always fetch GBP — it's the dimension's discoverability check too.
    // Other sources only fetched if industry weights them above zero.
    const [gbp, tripadvisor, productReview, booking, hipages] = await Promise.all([
      this.fetchGbp(query),
      (weights.tripadvisor ?? 0) > 0 ? this.fetchTripadvisor(query) : Promise.resolve(null),
      (weights.productReview ?? 0) > 0 ? this.fetchProductReview(query) : Promise.resolve(null),
      (weights.booking ?? 0) > 0 ? this.fetchBooking(query) : Promise.resolve(null),
      (weights.hipages ?? 0) > 0 ? this.fetchHipages(query) : Promise.resolve(null),
    ])

    return { gbp, tripadvisor, productReview, booking, hipages }
  }

  /** GBP via existing Google Places API path. Unchanged from pre-2026-06-05. */
  private async fetchGbp(query: string): Promise<ReputationSourceSignal | null> {
    try {
      const data = await getBusinessReviews(query)
      if (!data) return null
      return { rating: data.rating, reviewCount: data.totalReviews }
    } catch (err) {
      console.error(`[reputation-collector] GBP fetch failed query="${query}" err=${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  /** Apify maxcopell/tripadvisor — tourism + restaurant primary platform. */
  private async fetchTripadvisor(query: string): Promise<ReputationSourceSignal | null> {
    const data = await scrapeTripadvisorBusiness(query)
    return data ? { rating: data.rating, reviewCount: data.totalReviews } : null
  }

  /** Apify abotapi/product-reviews-australia-scraper — building/professional/retail/education. */
  private async fetchProductReview(query: string): Promise<ReputationSourceSignal | null> {
    const data = await scrapeProductReviewBusiness(query)
    return data ? { rating: data.rating, reviewCount: data.totalReviews } : null
  }

  /** Apify zhorex/booking-reviews-scraper — tourism (accommodation focus). */
  private async fetchBooking(query: string): Promise<ReputationSourceSignal | null> {
    const data = await scrapeBookingBusiness(query)
    return data ? { rating: data.rating, reviewCount: data.totalReviews } : null
  }

  /** Apify abotapi/hipages-business-scraper — trades (electricians, plumbers, builders). */
  private async fetchHipages(query: string): Promise<ReputationSourceSignal | null> {
    const data = await scrapeHipagesBusiness(query)
    return data ? { rating: data.rating, reviewCount: data.totalReviews } : null
  }

  private buildResult(
    clientId: string,
    signals: ReputationSignals,
    industry: ReputationIndustry | null,
  ): CollectorResult {
    const findings: NewFinding[] = []
    const gbp = signals.gbp

    if (gbp && gbp.rating < LOW_RATING_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'reputation',
        finding_type: 'low_review_rating',
        severity: 'high',
        title: 'Low Google review rating',
        description: `Average rating is ${gbp.rating.toFixed(1)}/5 — below the recommended threshold of ${LOW_RATING_THRESHOLD}.`,
        evidence: makeEvidence({
          parsed: { rating: gbp.rating, total_reviews: gbp.reviewCount },
          sources: [evidenceSource('https://business.google.com/')],
        }),
        recommendation: 'Respond to negative reviews professionally and implement a customer feedback process to improve satisfaction.',
        fix_type: 'fde_manual',
        priority_score: 80,
      })
    }

    if (gbp && gbp.reviewCount <= FEW_REVIEWS_THRESHOLD) {
      findings.push({
        client_id: clientId,
        dimension: 'reputation',
        finding_type: 'insufficient_review_count',
        severity: 'medium',
        title: 'Too few Google reviews',
        description: `Only ${gbp.reviewCount} review${gbp.reviewCount === 1 ? '' : 's'} found. More reviews build trust and improve local SEO.`,
        evidence: makeEvidence({
          parsed: { total_reviews: gbp.reviewCount },
          sources: [evidenceSource('https://business.google.com/')],
        }),
        recommendation: 'Ask satisfied customers to leave a Google review. Include a QR code or direct link in receipts or follow-up emails.',
        fix_type: 'fde_manual',
        priority_score: 55,
      })
    }

    // A1: honest disclosure that the score may underestimate real reputation
    // when the customer's industry typically reviews on other platforms.
    // Suppress this finding when an industry-specific source already
    // contributed data — at that point the score IS multi-source and the
    // hint would be misleading.
    const hasIndustrySource = !!(signals.tripadvisor || signals.productReview || signals.booking || signals.hipages)
    if (
      gbp &&
      !hasIndustrySource &&
      gbp.rating >= HIGH_RATING_FOR_OFF_PLATFORM_HINT &&
      gbp.reviewCount <= LOW_COUNT_FOR_OFF_PLATFORM_HINT
    ) {
      findings.push({
        client_id: clientId,
        dimension: 'reputation',
        finding_type: 'reviews_likely_off_platform',
        severity: 'low',
        title: 'Reviews may live on industry platforms (not Google)',
        description: `Strong Google rating (${gbp.rating.toFixed(1)}/5) but only ${gbp.reviewCount} Google review${gbp.reviewCount === 1 ? '' : 's'}. Customers in this industry may be reviewing on TripAdvisor, ProductReview, Yelp, or sector-specific platforms — the Google-only score may underestimate real reputation.`,
        evidence: makeEvidence({
          parsed: { rating: gbp.rating, total_reviews: gbp.reviewCount },
          sources: [evidenceSource('https://business.google.com/')],
        }),
        recommendation: 'Identify the platform your customers actually use to leave reviews (TripAdvisor for tourism, ProductReview for retail/services, etc) and audit reputation there. Add it to the diagnostic data sources to get a complete picture.',
        fix_type: 'fde_manual',
        priority_score: 35,
      })
    }

    const score = scoreReputation(signals, industry)
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
