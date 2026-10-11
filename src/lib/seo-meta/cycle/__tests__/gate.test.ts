import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GscSnapshotRow } from '@/lib/gsc/client'
import type { ApplyAdapter, MetaCycleCandidate, MetaCycleClientConfig } from '../types'

/**
 * PM 2026-09-20 (W38 dry-run follow-up): 9 real candidates went through the
 * gate, 7 hit keyword_snapshot_missing_or_stale (the weekly snapshot job
 * only tracks ~200 currently-ranked keywords, not every page-scoped GSC
 * query the gate derives), the forbidden-city page burned a full gate run
 * before failing on slug_not_in_any_data_file, and the leshan page's
 * highest-impression on-topic query was the French "leshan au départ de
 * chengdu". PM 2026-09-20 fourth pass: DataForSEO simply has no data for
 * many small-market long-tail queries, primary market or not, so
 * resolveKeywordData is now a 3-tier waterfall (dataforseo_primary →
 * dataforseo_fallback → gsc_serp). Per PM's explicit test list: one pass
 * case per tier, plus tier 3's two failure modes (GSC impressions below the
 * 30-sample floor, SERP domain-authority lookups all failing) — nothing
 * else, per PM's repeated instruction not to over-test this.
 */

const mockFetchGscQueriesForPage = vi.fn()
vi.mock('@/lib/gsc/client', () => ({
  fetchGscQueriesForPage: (...args: unknown[]) => mockFetchGscQueriesForPage(...args),
}))

const mockGetSerpPage = vi.fn()
vi.mock('@/lib/dataforseo/serp', () => ({
  getSerpPage: (...args: unknown[]) => mockGetSerpPage(...args),
}))

const mockBulkKeywordVolume = vi.fn()
const mockGetDomainMetrics = vi.fn()
vi.mock('@/lib/dataforseo/labs', () => ({
  bulkKeywordVolume: (...args: unknown[]) => mockBulkKeywordVolume(...args),
  getDomainMetrics: (...args: unknown[]) => mockGetDomainMetrics(...args),
}))

const CONFIG: MetaCycleClientConfig = {
  clientId: 'client-1',
  domain: 'ctstours.co.nz',
  semrushDb: 'nz',
  maxPagesPerRun: 3,
  cooldownDays: 30,
  brandVoice: 'factual AU/NZ English',
  keywordFallbackLocations: [],
  protectedSlugs: [],
}

beforeEach(() => {
  vi.clearAllMocks()
})

function candidate(overrides: Partial<MetaCycleCandidate> = {}): MetaCycleCandidate {
  return {
    pageUrl: 'https://ctstours.co.nz/blog/leshan-giant-buddha-guide',
    slug: 'leshan-giant-buddha-guide',
    keyword: 'leshan giant buddha guide',
    source: 'gsc',
    position: 8,
    impressions: 200,
    ctr: 0.03,
    searchVolume: null,
    keywordDifficulty: null,
    ...overrides,
  }
}

/**
 * Chainable fake covering exactly the query-builder surface gate.ts calls.
 * `limit()` is used two ways by gate.ts: lookupSnapshotRow chains
 * `.limit(1).maybeSingle()`, checkNoRecentReuse awaits `.limit(1)` directly
 * — so its return value needs both a `.maybeSingle()` method AND `.then`
 * (thenable) to satisfy `await` without it.
 */
function fakeSupabase(opts: { snapshotRow?: unknown; reuseRows?: unknown[] }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    ilike: () => chain,
    neq: () => chain,
    is: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => ({
      maybeSingle: async () => ({ data: opts.snapshotRow ?? null, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: opts.reuseRows ?? [], error: null }),
    }),
    maybeSingle: async () => ({ data: opts.snapshotRow ?? null, error: null }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any
}

describe('resolveKeywordData — 3-tier waterfall (PM 2026-09-20, fourth pass)', () => {
  const NULL_LIVE_RESULT = [{ keyword: 'x', search_volume: null, keyword_difficulty: null, cpc: null, competition: null, intent: 'informational', position: null }]

  it('tier 1 (dataforseo_primary): a fresh keyword_snapshots row at the primary location is used directly, no live call needed', async () => {
    const { resolveKeywordData } = await import('../gate')
    const supabase = fakeSupabase({ snapshotRow: { search_volume: 320, keyword_difficulty: 45, snapshot_date: new Date().toISOString().slice(0, 10) } })

    const result = await resolveKeywordData(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554, [], 200, ['tripadvisor.com'])

    expect('failure' in result).toBe(false)
    if ('failure' in result) return
    expect(result.keywordDataSource).toBe('dataforseo_primary')
    expect(result.keywordDataLocation).toBe(2554)
    expect(result.searchVolume).toBe(320)
    expect(result.keywordDifficulty).toBe(45)
  })

  it('tier 2 (dataforseo_fallback): primary location has no data, a client-configured fallback location does', async () => {
    const { resolveKeywordData } = await import('../gate')
    const supabase = fakeSupabase({ snapshotRow: null })
    mockBulkKeywordVolume.mockImplementation(async (_keywords: string[], locationCode: number) =>
      locationCode === 2036 ? [{ keyword: 'x', search_volume: 40, keyword_difficulty: 22, cpc: null, competition: null, intent: 'informational', position: null }] : NULL_LIVE_RESULT,
    )

    const result = await resolveKeywordData(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554, [2036], 200, ['tripadvisor.com'])

    expect('failure' in result).toBe(false)
    if ('failure' in result) return
    expect(result.keywordDataSource).toBe('dataforseo_fallback')
    expect(result.keywordDataLocation).toBe(2036)
    expect(result.keywordDataNote).toContain('AU')
  })

  it('tier 3 (gsc_serp): neither DataForSEO location has data — falls back to this page\'s GSC impressions + average SERP-competitor domain authority', async () => {
    const { resolveKeywordData } = await import('../gate')
    const supabase = fakeSupabase({ snapshotRow: null })
    mockBulkKeywordVolume.mockResolvedValue(NULL_LIVE_RESULT)
    mockGetDomainMetrics.mockImplementation(async (domain: string) => ({ organic_keywords: 100, organic_traffic: 500, authority_score: domain === 'a.com' ? 40 : 60 }))

    const result = await resolveKeywordData(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554, [], 214, ['a.com', 'b.com'])

    expect('failure' in result).toBe(false)
    if ('failure' in result) return
    expect(result.keywordDataSource).toBe('gsc_serp')
    expect(result.keywordDataLocation).toBeNull()
    expect(result.searchVolume).toBe(214)
    expect(result.keywordDifficulty).toBe(50)
    expect(result.keywordDataNote).toContain('214')
    expect(result.keywordDataNote).toContain('非 DataForSEO 难度分')
  })

  it('tier 3 skips when this page\'s own GSC impressions for the keyword are below the 30-sample floor', async () => {
    const { resolveKeywordData } = await import('../gate')
    const supabase = fakeSupabase({ snapshotRow: null })
    mockBulkKeywordVolume.mockResolvedValue(NULL_LIVE_RESULT)

    const result = await resolveKeywordData(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554, [], 12, ['a.com'])

    expect('failure' in result).toBe(true)
    expect(mockGetDomainMetrics).not.toHaveBeenCalled()
  })

  it('tier 3 skips when domain-authority lookups fail for every SERP competitor domain — never coerced into a made-up difficulty', async () => {
    const { resolveKeywordData } = await import('../gate')
    const supabase = fakeSupabase({ snapshotRow: null })
    mockBulkKeywordVolume.mockResolvedValue(NULL_LIVE_RESULT)
    mockGetDomainMetrics.mockRejectedValue(new Error('DataForSEO domain overview unavailable'))

    const result = await resolveKeywordData(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554, [], 214, ['a.com', 'b.com'])

    expect('failure' in result).toBe(true)
  })
})

describe('runStep3Gate — editable-slug check runs BEFORE any DataForSEO/GSC spend (PM 2026-09-20)', () => {
  it('skips a candidate whose slug is not in any editable data file without ever calling GSC for it', async () => {
    const { runStep3Gate } = await import('../runner')
    const supabase = fakeSupabase({ snapshotRow: { config: { site_url: 'https://ctstours.co.nz/' } } })
    const adapter: ApplyAdapter = {
      channel: 'pr',
      canEditSlug: async (slug) => slug !== 'forbidden-city-travel-guide',
      apply: vi.fn(),
    }
    const candidates = [candidate({ slug: 'forbidden-city-travel-guide', pageUrl: 'https://ctstours.co.nz/blog/forbidden-city-travel-guide' })]

    const result = await runStep3Gate(supabase, adapter, CONFIG, candidates)

    expect(result.passed).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].reason).toBe('slug_not_in_any_data_file')
    expect(mockFetchGscQueriesForPage).not.toHaveBeenCalled()
    expect(mockGetSerpPage).not.toHaveBeenCalled()
  })

  it('skips a protected conversion-page slug before even checking canEditSlug (PM 2026-09-23 incident follow-up: /china-tours must never reach the gate)', async () => {
    const { runStep3Gate } = await import('../runner')
    const supabase = fakeSupabase({ snapshotRow: { config: { site_url: 'https://ctstours.co.nz/' } } })
    const canEditSlug = vi.fn(async () => true)
    const adapter: ApplyAdapter = { channel: 'pr', canEditSlug, apply: vi.fn() }
    const candidates = [candidate({ slug: 'china-tours', pageUrl: 'https://ctstours.co.nz/china-tours' })]
    const config = { ...CONFIG, protectedSlugs: ['china-tours'] }

    const result = await runStep3Gate(supabase, adapter, config, candidates)

    expect(result.passed).toHaveLength(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].reason).toBe('protected_conversion_page')
    expect(canEditSlug).not.toHaveBeenCalled()
    expect(mockFetchGscQueriesForPage).not.toHaveBeenCalled()
  })
})

describe('step3 protected pages — shared matcher', () => {
  async function run(config: typeof CONFIG, cand: ReturnType<typeof candidate>) {
    const { runStep3Gate } = await import('../runner')
    const supabase = fakeSupabase({ snapshotRow: { config: { site_url: 'https://ctstours.co.nz/' } } })
    const canEditSlug = vi.fn(async () => true)
    const adapter: ApplyAdapter = { channel: 'pr', canEditSlug, apply: vi.fn() }
    const result = await runStep3Gate(supabase, adapter, config, [cand])
    return { result, canEditSlug }
  }

  it('protects the home page when "/" is on the list (used to be impossible)', async () => {
    const { result, canEditSlug } = await run({ ...CONFIG, protectedSlugs: ['/'] }, candidate({ slug: null, pageUrl: 'https://ctstours.co.nz/' }))
    expect(result.failures[0]?.reason).toBe('protected_conversion_page')
    expect(canEditSlug).not.toHaveBeenCalled()
  })

  it('a candidate with neither slug nor URL is refused fail-closed, not waved through', async () => {
    const { result } = await run({ ...CONFIG, protectedSlugs: [] }, candidate({ slug: null, pageUrl: null }))
    expect(result.failures[0]?.reason).toBe('protected_conversion_page')
  })

  it('a path entry matches by URL path even when the slug alone would not', async () => {
    const { result } = await run({ ...CONFIG, protectedSlugs: ['blog/china-visa'] }, candidate({ slug: 'china-visa', pageUrl: 'https://ctstours.co.nz/blog/china-visa' }))
    expect(result.failures[0]?.reason).toBe('protected_conversion_page')
  })
})

describe('deriveTopicMatchedKeyword — English-only target keyword (PM 2026-09-20 W38 dry-run follow-up)', () => {
  it('skips a higher-impression French on-topic query and picks this page\'s own English on-topic query instead', async () => {
    const { deriveTopicMatchedKeyword } = await import('../gate')
    const rows: GscSnapshotRow[] = [
      { query: 'leshan au départ de chengdu', impressions: 500, clicks: 2, ctr: 0.004, position: 15 },
      { query: 'leshan giant buddha day trip', impressions: 80, clicks: 3, ctr: 0.0375, position: 9 },
    ]
    mockFetchGscQueriesForPage.mockResolvedValue(rows)

    const result = await deriveTopicMatchedKeyword('https://ctstours.co.nz/', candidate(), CONFIG.clientId)

    expect('failure' in result).toBe(false)
    if ('failure' in result) return
    expect(result.keyword).toBe('leshan giant buddha day trip')
  })
})

describe('deriveTopicMatchedKeyword — 2026-09-28 incident regression: a shared city-name token must not qualify a query on its own', () => {
  it('refuses "how many days in chongqing" for the Liziba page — it shares only "chongqing" with the slug, not a page-specific word like "liziba"/"monorail"', async () => {
    const { deriveTopicMatchedKeyword } = await import('../gate')
    // Real shape of the incident: GSC genuinely attributes some impressions
    // for this broad, shared-city query to the Liziba page's URL (Google
    // occasionally shows more than one of a site's pages for a broad
    // query) — high impressions, but the ONLY shared word is "chongqing".
    const rows: GscSnapshotRow[] = [
      { query: 'how many days in chongqing', impressions: 300, clicks: 4, ctr: 0.013, position: 12 },
      { query: 'liziba monorail station guide', impressions: 40, clicks: 3, ctr: 0.075, position: 7 },
    ]
    mockFetchGscQueriesForPage.mockResolvedValue(rows)

    const result = await deriveTopicMatchedKeyword(
      'https://ctstours.co.nz/',
      candidate({ slug: 'liziba-monorail-chongqing-guide', pageUrl: 'https://ctstours.co.nz/blog/liziba-monorail-chongqing-guide' }),
      CONFIG.clientId,
    )

    // Must pick the page's OWN low-impression-but-actually-relevant query,
    // never the high-impression query that really belongs to a different
    // page (chinatravel #199/#200's exact shape).
    expect('failure' in result).toBe(false)
    if ('failure' in result) return
    expect(result.keyword).toBe('liziba monorail station guide')
  })

  it('skips entirely (never borrows the shared-city query) when the page has no query matching 2+ of its own distinctive slug words', async () => {
    const { deriveTopicMatchedKeyword } = await import('../gate')
    const rows: GscSnapshotRow[] = [
      { query: 'how many days in chongqing', impressions: 300, clicks: 4, ctr: 0.013, position: 12 },
    ]
    mockFetchGscQueriesForPage.mockResolvedValue(rows)

    const result = await deriveTopicMatchedKeyword(
      'https://ctstours.co.nz/',
      candidate({ slug: 'chongqing-night-city-lights', pageUrl: 'https://ctstours.co.nz/blog/chongqing-night-city-lights' }),
      CONFIG.clientId,
    )

    expect('failure' in result).toBe(true)
    if (!('failure' in result)) return
    expect(result.failure.reason).toBe('no_page_scoped_keyword_match')
  })
})

describe('checkTitleOnTopic — 2026-09-28 incident regression: generated copy must mention something specific to the page', () => {
  it('flags a generated title/description that has drifted onto a completely different subject', async () => {
    const { checkTitleOnTopic } = await import('../gate')

    const result = checkTitleOnTopic(
      'chongqing-night-city-lights',
      "The Forbidden Palace & China's Top Destinations | CTS Tours",
      'Explore the Forbidden Palace and other must-see stops across China with CTS Tours.',
    )

    expect(result.onTopic).toBe(false)
  })

  it('passes a generated title/description that mentions one of the page\'s own distinctive words', async () => {
    const { checkTitleOnTopic } = await import('../gate')

    const result = checkTitleOnTopic(
      'chongqing-night-city-lights',
      'Chongqing Night City Lights: A Kiwi Traveller\'s Guide | CTS',
      'See Chongqing light up after dark — book your night city lights tour with CTS Tours.',
    )

    expect(result.onTopic).toBe(true)
  })
})
