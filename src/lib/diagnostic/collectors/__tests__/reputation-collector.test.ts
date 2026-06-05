import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available at factory time
// ---------------------------------------------------------------------------

const { mockGetBusinessReviews, mockScrapeProductReview, mockScrapeTripadvisor } = vi.hoisted(() => ({
  mockGetBusinessReviews: vi.fn(),
  mockScrapeProductReview: vi.fn(),
  mockScrapeTripadvisor: vi.fn(),
}))

vi.mock('@/lib/places/client', () => ({
  getBusinessReviews: mockGetBusinessReviews,
}))

vi.mock('@/lib/apify/productreview-scraper', () => ({
  scrapeProductReviewBusiness: mockScrapeProductReview,
}))

vi.mock('@/lib/apify/tripadvisor-scraper', () => ({
  scrapeTripadvisorBusiness: mockScrapeTripadvisor,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { ReputationCollector, scoreReputation, resolveReputationIndustry } from '../reputation-collector'

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
  it('returns score=null + business_not_listed finding when Places API throws', async () => {
    // 2026-06-05: previously all-sources-null returned empty findings. Now we
    // surface a business_not_listed finding so FDE sees something actionable
    // instead of a silent missing dimension. Other sources (Apify) are
    // industry-gated so default industry=null → only GBP runs → null sources.
    mockGetBusinessReviews.mockRejectedValue(new Error('Places timeout'))
    const result = await new ReputationCollector(10).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.finding_type).toBe('business_not_listed')
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

  it('multi-source signals average their per-source scores (tourism industry)', () => {
    // Two identical sources should equal a single source when industry weights
    // both — score is a weighted mean, identical inputs ⇒ identical output.
    const single = scoreReputation({ gbp: { rating: 4.5, reviewCount: 50 } }, 'tourism')
    const double = scoreReputation({
      gbp: { rating: 4.5, reviewCount: 50 },
      tripadvisor: { rating: 4.5, reviewCount: 50 },
    }, 'tourism')
    expect(double).toBe(single)
  })

  it('multi-source signals lift the score when one source is stronger (tourism industry)', () => {
    // Pass industry='tourism' so TripAdvisor weight is non-zero. Without the
    // industry tag, default weights treat TripAdvisor as weight=0 → no lift.
    const gbpOnly = scoreReputation({ gbp: { rating: 4.0, reviewCount: 5 } }, 'tourism')
    const both = scoreReputation({
      gbp: { rating: 4.0, reviewCount: 5 },
      tripadvisor: { rating: 4.8, reviewCount: 200 },
    }, 'tourism')
    expect(both).toBeGreaterThan(gbpOnly ?? 0)
  })

  it('default weights (no industry) include only gbp — TripAdvisor data ignored', () => {
    // Verify the safe default: any business with unknown industry collapses to
    // Google-only scoring even if TripAdvisor data is fetched. Prevents silent
    // mis-scoring of industries we haven't classified yet.
    const gbpOnly = scoreReputation({ gbp: { rating: 4.0, reviewCount: 5 } })
    const withTripadvisor = scoreReputation({
      gbp: { rating: 4.0, reviewCount: 5 },
      tripadvisor: { rating: 4.8, reviewCount: 200 },
    })
    expect(withTripadvisor).toBe(gbpOnly)
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

  it('de-duplicates country tokens already in businessName (CTS Tours NZ + Auckland + NZ)', async () => {
    // E2 fix (2026-06-06): businessName "CTS Tours NZ" already contains the
    // country code, so appending it again produces "CTS Tours NZ Auckland NZ"
    // which lowers TripAdvisor / Booking match rates.  We expect the NZ
    // suffix to be detected and dropped from the appended tokens.
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'CTS Tours NZ',
      city: 'Auckland',
      country: 'NZ',
    })
    expect(mockGetBusinessReviews).toHaveBeenCalledWith('CTS Tours NZ Auckland')
  })

  it('keeps city when businessName does NOT already contain it (Hilton + Auckland + NZ)', async () => {
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'Hilton',
      city: 'Auckland',
      country: 'NZ',
    })
    expect(mockGetBusinessReviews).toHaveBeenCalledWith('Hilton Auckland NZ')
  })

  it('drops both city and country when both already in name (Auckland Lodge NZ + Auckland + NZ)', async () => {
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'Auckland Lodge NZ',
      city: 'Auckland',
      country: 'NZ',
    })
    expect(mockGetBusinessReviews).toHaveBeenCalledWith('Auckland Lodge NZ')
  })

  it('matches token only at word boundary (Brand vs Branded)', async () => {
    // Word-boundary regex: "Branded NZ" + "Brand" should NOT skip "Brand".
    // But we ARE testing the city/country side, so test: name="Auckville Lodge"
    // + city="Auck" should NOT skip Auck (no word boundary inside "Auckville").
    await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'Auckville Lodge',
      city: 'Auck',
      country: 'NZ',
    })
    expect(mockGetBusinessReviews).toHaveBeenCalledWith('Auckville Lodge Auck NZ')
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
// 2026-06-06 follow-up: industry bucket split + new finding type
// ---------------------------------------------------------------------------

describe('resolveReputationIndustry() — industry mapping (2026-06-06)', () => {
  it('maps hotel/motel/lodge/hostel to accommodation bucket (S3)', () => {
    expect(resolveReputationIndustry('hotel')).toBe('accommodation')
    expect(resolveReputationIndustry('hotels')).toBe('accommodation')
    expect(resolveReputationIndustry('motel')).toBe('accommodation')
    expect(resolveReputationIndustry('lodge')).toBe('accommodation')
    expect(resolveReputationIndustry('hostel')).toBe('accommodation')
    expect(resolveReputationIndustry('hostels')).toBe('accommodation')
    expect(resolveReputationIndustry('accommodation')).toBe('accommodation')
    expect(resolveReputationIndustry('B&B')).toBe('accommodation')
    expect(resolveReputationIndustry('bed and breakfast')).toBe('accommodation')
    expect(resolveReputationIndustry('guesthouse')).toBe('accommodation')
    expect(resolveReputationIndustry('酒店')).toBe('accommodation')
    expect(resolveReputationIndustry('民宿')).toBe('accommodation')
    expect(resolveReputationIndustry('旅馆')).toBe('accommodation')
  })

  it('keeps travel agents / tour operators in tourism bucket (NOT accommodation)', () => {
    expect(resolveReputationIndustry('travel')).toBe('tourism')
    expect(resolveReputationIndustry('travel agent')).toBe('tourism')
    expect(resolveReputationIndustry('travel agency')).toBe('tourism')
    expect(resolveReputationIndustry('tour operator')).toBe('tourism')
    expect(resolveReputationIndustry('inbound tour')).toBe('tourism')
    expect(resolveReputationIndustry('outbound tour')).toBe('tourism')
    expect(resolveReputationIndustry('旅行社')).toBe('tourism')
    expect(resolveReputationIndustry('入境旅游')).toBe('tourism')
    expect(resolveReputationIndustry('出境旅游')).toBe('tourism')
  })

  it('returns null for unmapped industries (Google-only fallback)', () => {
    expect(resolveReputationIndustry('manufacturing')).toBeNull()
    expect(resolveReputationIndustry(null)).toBeNull()
    expect(resolveReputationIndustry('')).toBeNull()
  })
})

describe('scoreReputation() — accommodation bucket (2026-06-06)', () => {
  it('accommodation weights GBP + TripAdvisor + Booking (not just GBP)', () => {
    // Hilton-like profile: strong on all 3 platforms.
    const score = scoreReputation({
      gbp: { rating: 4.5, reviewCount: 200 },
      tripadvisor: { rating: 4.6, reviewCount: 500 },
      booking: { rating: 4.4, reviewCount: 1000 },
    }, 'accommodation')
    expect(score).toBeGreaterThanOrEqual(85)
  })

  it('accommodation re-normalises when Booking is null (covers e.g. small B&B not on Booking)', () => {
    const withBooking = scoreReputation({
      gbp: { rating: 4.5, reviewCount: 50 },
      tripadvisor: { rating: 4.5, reviewCount: 50 },
      booking: { rating: 4.5, reviewCount: 50 },
    }, 'accommodation')
    const withoutBooking = scoreReputation({
      gbp: { rating: 4.5, reviewCount: 50 },
      tripadvisor: { rating: 4.5, reviewCount: 50 },
      booking: null,
    }, 'accommodation')
    // All identical inputs => identical score (re-normalisation works).
    expect(withoutBooking).toBe(withBooking)
  })
})

describe('scoreReputation() — tourism bucket excludes booking (2026-06-06)', () => {
  it('tourism (travel agent) ignores Booking data even if fetched', () => {
    // PR #385 e2e revealed: CTS Tours is a travel agent, not accommodation.
    // Even if Booking returned data (which it can\'t for travel agents),
    // the tourism bucket should ignore it.
    const withoutBooking = scoreReputation({
      gbp: { rating: 4.0, reviewCount: 5 },
      tripadvisor: { rating: 4.5, reviewCount: 50 },
    }, 'tourism')
    const withBooking = scoreReputation({
      gbp: { rating: 4.0, reviewCount: 5 },
      tripadvisor: { rating: 4.5, reviewCount: 50 },
      booking: { rating: 4.8, reviewCount: 200 },  // would inflate if counted
    }, 'tourism')
    expect(withBooking).toBe(withoutBooking)
  })

  it('tourism multi-source lift now uses only GBP + TripAdvisor (no Booking)', async () => {
    const gbpOnly = scoreReputation({ gbp: { rating: 4.0, reviewCount: 5 } }, 'tourism')
    const both = scoreReputation({
      gbp: { rating: 4.0, reviewCount: 5 },
      tripadvisor: { rating: 4.8, reviewCount: 200 },
    }, 'tourism')
    expect(both).toBeGreaterThan(gbpOnly ?? 0)
  })
})

describe('ReputationCollector.collect() — review_lookup_failed finding (S1)', () => {
  it('emits review_lookup_failed (not business_not_listed) when industry sources were attempted and all returned null', async () => {
    // Tourism industry → fetchAllSources calls TripAdvisor.  Because we don\'t
    // mock the Apify scraper, it returns null (no APIFY_API_KEY in test env).
    // GBP returns null too.  Should surface review_lookup_failed because
    // multiple sources were tried, not business_not_listed.
    mockGetBusinessReviews.mockResolvedValue(null)
    const result = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      industry: 'travel',
    })
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.finding_type).toBe('review_lookup_failed')
    expect(result.findings[0]!.severity).toBe('high')
  })

  it('still emits business_not_listed (critical) when only GBP was attempted (no industry)', async () => {
    // Default industry=null → only GBP runs.  When GBP returns null, the
    // original critical finding is correct: the business genuinely has no
    // Google listing.
    mockGetBusinessReviews.mockResolvedValue(null)
    const result = await new ReputationCollector().collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.finding_type).toBe('business_not_listed')
    expect(result.findings[0]!.severity).toBe('critical')
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

// ---------------------------------------------------------------------------
// 2026-06-06 hotfix — per-source timeouts (Oztop regression repro)
//
// Past incident: PR #390 wired ProductReview into the building bucket and
// when the Apify actor hung, the outer 30 s collector timeout killed every-
// thing including a healthy GBP, leaving Oztop with score=null and 0
// findings (DB confirmed: run 79991401-... 2026-06-05 15:29 UTC).
//
// With per-source timeouts a hung industry source now resolves to null
// while GBP still lands and produces a score. These tests pin that
// invariant.
// ---------------------------------------------------------------------------

describe('ReputationCollector — per-source timeouts (2026-06-06)', () => {
  it('Oztop regression: GBP healthy + ProductReview hangs → score uses GBP only', async () => {
    // industry='flooring' resolves to 'building' bucket
    // (gbp 0.50 + productReview 0.50).
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'oztop-gbp',
      name: 'Oztop',
      rating: 4.0,
      totalReviews: 30,
    })
    // ProductReview hangs forever — would have nuked the whole dimension
    // under PR #390. The withTimeout wrapper should cap it at 20 s and
    // leave GBP standing.
    mockScrapeProductReview.mockReturnValue(new Promise(() => {}))

    // Use a short hard cap on the collector itself so the test runs fast;
    // the per-source timeouts inside fetchAllSources are independent of
    // this outer cap.
    const result = await new ReputationCollector(25_000).collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'Oztop',
      city: 'Brisbane',
      country: 'AU',
      industry: 'flooring',
    })

    // The withTimeout helper resolves the hung scraper to null at 20 s.
    // After that, scoreReputation re-normalises {gbp only} → ~78
    // (rating 4.0 + 30 reviews capped). Just assert "not null and in band".
    expect(result.score).not.toBeNull()
    expect(result.score!).toBeGreaterThanOrEqual(70)
    expect(result.score!).toBeLessThanOrEqual(85)
  }, 30_000) // vitest test-level timeout slightly above the 20 s source cap

  it('Hung tripadvisor in tourism bucket does not block GBP', async () => {
    mockGetBusinessReviews.mockResolvedValue({
      placeId: 'cts-gbp',
      name: 'CTS Tours NZ',
      rating: 4.0,
      totalReviews: 5,
    })
    mockScrapeTripadvisor.mockReturnValue(new Promise(() => {}))

    const result = await new ReputationCollector(25_000).collect(CLIENT_ID, DOMAIN, KEYWORDS, {
      businessName: 'CTS Tours NZ',
      city: 'Auckland',
      country: 'NZ',
      industry: 'travel',
    })

    expect(result.score).not.toBeNull()
    // GBP at 4.0 / 5 reviews scores in the 50–65 band (matches A1 regression test).
    expect(result.score!).toBeGreaterThanOrEqual(50)
    expect(result.score!).toBeLessThanOrEqual(65)
  }, 30_000)

  it('Hung GBP eventually resolves to null without blocking the collector forever', async () => {
    // GBP itself can hang. The withTimeout wrapper caps it at 10 s and
    // the rest of the collector still runs — in this case no industry
    // sources are configured so we end up with all-null + business_not_listed.
    mockGetBusinessReviews.mockReturnValue(new Promise(() => {}))

    const result = await new ReputationCollector(15_000).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    // With no industry, only GBP attempted → business_not_listed (not
    // review_lookup_failed). This regression-locks the dispatch logic.
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.finding_type).toBe('business_not_listed')
  }, 20_000)
})
