import { describe, expect, it, vi } from 'vitest'
import type { GscSnapshotRow } from '@/lib/gsc/client'
import type { ApplyAdapter, MetaCycleCandidate, MetaCycleClientConfig } from '../types'

/**
 * PM 2026-09-20 (W38 dry-run follow-up): 9 real candidates went through the
 * gate, 7 hit keyword_snapshot_missing_or_stale (the weekly snapshot job
 * only tracks ~200 currently-ranked keywords, not every page-scoped GSC
 * query the gate derives), the forbidden-city page burned a full gate run
 * before failing on slug_not_in_any_data_file, and the leshan page's
 * highest-impression on-topic query was the French "leshan au départ de
 * chengdu". One real-shaped test per fix (two for the live-fallback path,
 * per PM's explicit ask: one where difficulty comes back null and the
 * candidate must be skipped, one where both fields come back and the gate
 * continues), per PM's instruction not to over-test this.
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
vi.mock('@/lib/dataforseo/labs', () => ({
  bulkKeywordVolume: (...args: unknown[]) => mockBulkKeywordVolume(...args),
}))

const CONFIG: MetaCycleClientConfig = {
  clientId: 'client-1',
  domain: 'ctstours.co.nz',
  semrushDb: 'nz',
  maxPagesPerRun: 3,
  cooldownDays: 30,
  brandVoice: 'factual AU/NZ English',
}

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
 * `limit()` is used two ways by gate.ts: checkKeywordSnapshot chains
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

describe('checkKeywordSnapshot — live DataForSEO fallback (PM 2026-09-20, third pass)', () => {
  it('skips when the live fallback returns a search volume but no difficulty — a partial result is treated the same as no result, never let through with a gap', async () => {
    const { checkKeywordSnapshot } = await import('../gate')
    mockBulkKeywordVolume.mockResolvedValue([{ keyword: 'leshan giant buddha day trip', search_volume: 90, keyword_difficulty: null, cpc: null, competition: null, intent: 'informational', position: null }])
    const supabase = fakeSupabase({ snapshotRow: null })

    const result = await checkKeywordSnapshot(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554)

    expect(mockBulkKeywordVolume).toHaveBeenCalledWith(['leshan giant buddha day trip'], 2554)
    expect('failure' in result).toBe(true)
  })

  it('continues into the gate when the live fallback returns BOTH search volume and difficulty', async () => {
    const { checkKeywordSnapshot } = await import('../gate')
    mockBulkKeywordVolume.mockResolvedValue([{ keyword: 'leshan giant buddha day trip', search_volume: 90, keyword_difficulty: 34, cpc: null, competition: null, intent: 'informational', position: null }])
    const supabase = fakeSupabase({ snapshotRow: null })

    const result = await checkKeywordSnapshot(supabase, CONFIG.clientId, 'leshan giant buddha day trip', 2554)

    expect('failure' in result).toBe(false)
    if ('failure' in result) return
    expect(result.searchVolume).toBe(90)
    expect(result.keywordDifficulty).toBe(34)
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
