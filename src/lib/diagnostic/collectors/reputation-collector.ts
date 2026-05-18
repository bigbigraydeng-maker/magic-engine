import { getBusinessReviews } from '@/lib/places/client'
import type { BusinessReviewData } from '@/lib/places/client'
import type { CollectorResult, NewFinding } from '../types'
import { makeEvidence, evidenceSource } from '../types'
import { MAX_COLLECTOR_TIMEOUT_MS } from '../constants'

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const RATING_WEIGHT = 0.60
const REVIEW_WEIGHT = 0.40
const MAX_REVIEWS_FOR_FULL_SCORE = 100

const LOW_RATING_THRESHOLD = 3.5
const FEW_REVIEWS_THRESHOLD = 20

// ---------------------------------------------------------------------------
// ReputationCollector
// ---------------------------------------------------------------------------

export class ReputationCollector {
  constructor(private readonly timeoutMs: number = MAX_COLLECTOR_TIMEOUT_MS) {}

  async collect(
    clientId: string,
    domain: string,
    _keywords: string[],
  ): Promise<CollectorResult> {
    const fallback: CollectorResult = { score: null, findings: [] }

    const timeout = new Promise<CollectorResult>(resolve =>
      setTimeout(() => resolve(fallback), this.timeoutMs),
    )

    try {
      return await Promise.race([this.fetchAndScore(clientId, domain), timeout])
    } catch {
      return fallback
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchAndScore(clientId: string, domain: string): Promise<CollectorResult> {
    const data = await getBusinessReviews(domain)

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

    const score = this.computeScore(data.rating, data.totalReviews)
    return { score, findings }
  }

  private computeScore(rating: number, reviewCount: number): number {
    // rating normalised from 1–5 range → 0–100
    const ratingScore = Math.max(0, Math.min(100, ((rating - 1) / 4) * 100))
    const reviewScore = Math.min(1, reviewCount / MAX_REVIEWS_FOR_FULL_SCORE) * 100
    const raw = ratingScore * RATING_WEIGHT + reviewScore * REVIEW_WEIGHT
    return Math.min(100, Math.max(0, Math.round(raw)))
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
