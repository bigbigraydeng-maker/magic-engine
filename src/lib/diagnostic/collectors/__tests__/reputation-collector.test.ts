import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available at factory time
// ---------------------------------------------------------------------------

const { mockGetBusinessReviews } = vi.hoisted(() => ({
  mockGetBusinessReviews: vi.fn(),
}))

vi.mock('@/lib/places/client', () => ({
  getBusinessReviews: mockGetBusinessReviews,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ReputationCollector, scoreReputation } from '../reputation-collector'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-rep-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Happy path — high score
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — strong reputation', () => {
  it('returns score >= 80 for rating=4.8 and 250 reviews', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.8,
      totalReviews: 250,
    })
    const { score } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('returns no findings for an excellent profile', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.8,
      totalReviews: 250,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Low rating
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — low rating', () => {
  it('returns score < 50 for rating=3.2 and 8 reviews', async () => {
    // A1 (2026-06-02): formula change shifted absolute scores; low-rating
    // band is now < 50 instead of < 40.  3.2 stars normalises to 55/100
    // (rating component) × 0.70 = 38.5, plus 8/30 × 100 × 0.30 = ~8 = 46.
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 3.2,
      totalReviews: 8,
    })
    const { score } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(score).toBeLessThan(50)
  })

  it('emits low_review_rating (high) when rating < 3.5', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 3.2,
      totalReviews: 50,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'low_review_rating')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('does NOT emit low_review_rating when rating >= 3.5', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.0,
      totalReviews: 100,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'low_review_rating')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Few reviews
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — few reviews', () => {
  it('emits insufficient_review_count (medium) when reviews <= 5', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.5,
      totalReviews: 5,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'insufficient_review_count')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
  })

  it('does NOT emit insufficient_review_count when reviews > 20', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.0,
      totalReviews: 50,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'insufficient_review_count')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// No review platform
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — no review platform', () => {
  it('returns score=null and business_not_listed finding when Places returns null', async () => {
    // P8.5.20: business not on Google → score is unknowable, dimension is skipped
    mockGetBusinessReviews.mockResolvedValue(null)
    const { score, findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'business_not_listed')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// API timeout / degraded
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — failure', () => {
  it('returns degraded { score: null, findings: [] } when API throws', async () => {
    mockGetBusinessReviews.mockRejectedValue(new Error('Places timeout'))
    const result = await new ReputationCollector(10).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })

  it('returns degraded result on timeout', async () => {
    mockGetBusinessReviews.mockReturnValue(new Promise(() => {}))  // never resolves
    const result = await new ReputationCollector(10).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// A1: pure function — scoreReputation()
// ---------------------------------------------------------------------------

describe('scoreReputation() — pure function', () => {
  it('returns null when no source provides data', () => {
    expect(scoreReputation({ gbp: null })).toBeNull()
    expect(scoreReputation({ gbp: null, tripadvisor: null, productReview: null })).toBeNull()
  })

  it('CTS regression: rating=4.0 + 5 reviews scores in 55-65 band (was 44 under old formula)', () => {
    // A1 regression case.  Under the old (0.60/0.40, ceiling=100) formula,
    // CTS Tours NZ scored 44 (5 GBP reviews, ~4.0 rating).  Under the new
    // (0.70/0.30, ceiling=30) formula it should land in the high-50s —
    // moving the dimension from "broken" into "below-target but plausible".
    // Exact value: 75×0.7 + (5/30)×100×0.3 = 52.5 + 5 = 57.5 → rounds to 58.
    // The remaining ~10pt gap to "healthy" is real signal (industry uses
    // TripAdvisor) and will be covered when A2 adds that data source.
    const score = scoreReputation({ gbp: { rating: 4.0, reviewCount: 5 } })
    expect(score).toBeGreaterThanOrEqual(55)
    expect(score).toBeLessThanOrEqual(65)
  })

  it('oztop regression: rating=4.5 + 50 reviews scores 80+ (review ceiling drop side-effect)', () => {
    // Lowering MAX_REVIEWS_FOR_FULL_SCORE from 100 to 30 means any client
    // with 30+ reviews now hits the review-count ceiling.  This is the
    // intended uplift for SMEs that already have meaningful review volume.
    const score = scoreReputation({ gbp: { rating: 4.5, reviewCount: 50 } })
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('multi-source signals average their per-source scores', () => {
    // When A2 lights up TripAdvisor data, both sources contribute equally.
    // Sanity check: two identical sources should equal a single source.
    const single = scoreReputation({ gbp: { rating: 4.5, reviewCount: 50 } })
    const double = scoreReputation({
      gbp: { rating: 4.5, reviewCount: 50 },
      tripadvisor: { rating: 4.5, reviewCount: 50 },
    })
    expect(double).toBe(single)
  })

  it('multi-source signals lift the score when one source is stronger', () => {
    const gbpOnly = scoreReputation({ gbp: { rating: 4.0, reviewCount: 5 } })
    const both = scoreReputation({
      gbp: { rating: 4.0, reviewCount: 5 },
      tripadvisor: { rating: 4.8, reviewCount: 200 },
    })
    expect(both).toBeGreaterThan(gbpOnly ?? 0)
  })

  it('review-count ceiling at exactly 30 reviews hits 100% review component', () => {
    // Boundary: with MAX_REVIEWS_FOR_FULL_SCORE=30, exactly 30 reviews should
    // saturate the review component.  Guards against silent breakage if the
    // ceiling is changed in future.
    const at30 = scoreReputation({ gbp: { rating: 4.0, reviewCount: 30 } })
    // 75×0.7 + 100×0.3 = 52.5 + 30 = 82.5 → rounds to 83 (or 82 depending on
    // rounding mode); just assert the band so the test survives micro-tweaks.
    expect(at30).toBeGreaterThanOrEqual(80)
    expect(at30).toBeLessThanOrEqual(85)
  })

  it('review-count saturates (does not exceed) past 30 reviews', () => {
    const at30 = scoreReputation({ gbp: { rating: 4.0, reviewCount: 30 } })
    const at500 = scoreReputation({ gbp: { rating: 4.0, reviewCount: 500 } })
    // Same rating + saturated review component → identical score.
    expect(at500).toBe(at30)
  })
})

// ---------------------------------------------------------------------------
// A1.5: rich query construction — businessName + city + country
// ---------------------------------------------------------------------------

describe('ReputationCollector — rich query construction (A1.5)', () => {
  beforeEach(() => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'CTS Tours NZ',
      rating: 4.0,
      totalReviews: 5,
    })
  })

  it('passes rich query to getBusinessReviews when businessName provided', async () => {
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'CTS Tours NZ',
      city: 'Auckland',
      country: 'NZ',
    })
    expect(mockGetBusinessReviews).toHaveBeenCalledWith('CTS Tours NZ Auckland NZ')
  })

  it('omits null city/country parts from the query', async () => {
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'CTS Tours NZ',
      city: null,
      country: null,
    })
    expect(mockGetBusinessReviews).toHaveBeenCalledWith('CTS Tours NZ')
  })

  it('falls back to domain when businessName not provided', async () => {
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {})
    expect(mockGetBusinessReviews).toHaveBeenCalledWith(DOMAIN)
  })

  it('falls back to domain when ctx is omitted entirely', async () => {
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockGetBusinessReviews).toHaveBeenCalledWith(DOMAIN)
  })
})

// ---------------------------------------------------------------------------
// A1: new finding — reviews_likely_off_platform
// ---------------------------------------------------------------------------

describe('ReputationCollector.collect() — off-platform reviews hint', () => {
  it('emits reviews_likely_off_platform when rating high and reviews low', async () => {
    // Strong rating, low count — score may underestimate real reputation if
    // customers review on TripAdvisor / ProductReview / Yelp instead.
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.5,
      totalReviews: 5,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'reviews_likely_off_platform')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('low')
  })

  it('does NOT emit reviews_likely_off_platform when reviews are sufficient', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 4.8,
      totalReviews: 250,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'reviews_likely_off_platform')).toBeUndefined()
  })

  it('does NOT emit reviews_likely_off_platform when rating is low', async () => {
    // Low rating + few reviews → the existing low_review_rating finding
    // already covers it.  Off-platform hint would just add noise.
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'abc123',
      name: 'Example Business',
      rating: 3.2,
      totalReviews: 5,
    })
    const { findings } = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'reviews_likely_off_platform')).toBeUndefined()
  })
})
