/**
 * TDD — RED Phase
 * Unit tests for getWeakSpotOpportunities() — dual-signal blog topic selector.
 *
 * Covers:
 * - Three-mode classification (unified / geo_only / seo_only)
 * - Exact boundary values (weakness_score=0.3, KD=30, volume=100)
 * - SEMrush failure / quota-exceeded degradation
 * - Empty / no-data edge cases
 * - Sorting rules: unified > geo_only > seo_only, then by weakness/volume DESC
 *
 * Reference: ROADMAP.md Track 1.D, ARCHITECTURE.md §13.2, CLAUDE.md §十四
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Module mocks (must be hoisted before imports) ───────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/dataforseo/labs', () => ({
  bulkKeywordVolume: vi.fn(),
}))

vi.mock('@/lib/blog/keyword-candidates', () => ({
  extractKeywordCandidates: vi.fn(),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabase'
import { bulkKeywordVolume } from '@/lib/dataforseo/labs'
import { extractKeywordCandidates } from '@/lib/blog/keyword-candidates'
import { getWeakSpotOpportunities } from '../topic-selector'

// ─── Typed mock aliases ───────────────────────────────────────────────────────

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockBulkKeywordVolume = vi.mocked(bulkKeywordVolume)
const mockExtractKeywordCandidates = vi.mocked(extractKeywordCandidates)

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a Supabase fluent-chain mock that resolves to { data, error }.
 * Supports arbitrary chaining: .select().eq().eq().order().limit() etc.
 * The returned object is also a Promise (thenable) so `await chain` works.
 */
function buildSupabaseChain(resolvedValue: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(resolvedValue)

  // Proxy: every property access (select, eq, in, order, limit…) returns the same
  // thenable object so chaining works, and awaiting it resolves to resolvedValue.
  const handler: ProxyHandler<typeof promise> = {
    get(target, prop) {
      // Preserve native Promise behaviour (then, catch, finally, Symbol.toStringTag…)
      if (prop in target || typeof prop === 'symbol') {
        const val = (target as unknown as Record<string | symbol, unknown>)[prop]
        return typeof val === 'function' ? val.bind(target) : val
      }
      // Any other property access (select, eq, in, order, limit, neq…) returns
      // a function that re-wraps the same promise, keeping the chain going.
      return () => new Proxy(promise, handler)
    },
  }

  return new Proxy(promise, handler)
}

/**
 * Wire the Supabase mock so that:
 * - The 1st call to supabaseAdmin.from() (queries table) resolves queriesResult
 * - The 2nd call (runs table) resolves runsResult
 */
function setupSupabaseMock(
  queriesData: unknown,
  queriesError: unknown = null,
  runsData: unknown = [],
  runsError: unknown = null
) {
  let callCount = 0

  mockFrom.mockImplementation(() => {
    callCount++
    if (callCount === 1) {
      return buildSupabaseChain({ data: queriesData, error: queriesError }) as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    return buildSupabaseChain({ data: runsData, error: runsError }) as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

/** Generate N run rows for a query, all weak or all strong. */
function makeRuns(
  queryId: string,
  count: number,
  weak = true
): Array<{ query_id: string; ai_engine: string; client_brand_rank: number | null; ran_at: string }> {
  return Array.from({ length: count }, (_, i) => ({
    query_id: queryId,
    ai_engine: 'openai',
    client_brand_rank: weak ? null : 1,
    ran_at: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
  }))
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('getWeakSpotOpportunities', () => {

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: DataForSEO returns empty (individual tests override when needed)
    mockBulkKeywordVolume.mockResolvedValue([])

    // Default: keyword extractor returns the input text as a candidate (pass-through)
    // Individual tests that need specific keyword matching override this.
    mockExtractKeywordCandidates.mockImplementation((queryText: string) => [
      { keyword: queryText.toLowerCase().trim(), confidence: 0.95, source: 'title' as const },
    ])
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Empty / No-data Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('empty and no-data cases', () => {

    it('returns [] when clientId is empty string', async () => {
      // Empty clientId guard — should return before hitting Supabase
      const result = await getWeakSpotOpportunities('')
      expect(result).toEqual([])
    })

    it('returns [] when Supabase query for ai_visibility_queries errors', async () => {
      setupSupabaseMock(null, { message: 'DB error' })
      const result = await getWeakSpotOpportunities('client-1')
      expect(result).toEqual([])
    })

    it('returns [] when no enabled queries found for client', async () => {
      setupSupabaseMock([])
      const result = await getWeakSpotOpportunities('client-1')
      expect(result).toEqual([])
    })

    it('returns [] when queries exist but runs query errors', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'best tour operators in NZ' }],
        null,
        null,
        { message: 'runs error' }
      )
      const result = await getWeakSpotOpportunities('client-1')
      expect(result).toEqual([])
    })

    it('returns [] when queries exist but no runs recorded', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'best tour operators in NZ' }],
        null,
        []
      )
      const result = await getWeakSpotOpportunities('client-1')
      expect(result).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Mode Classification — Happy Path
  // ═══════════════════════════════════════════════════════════════════════════

  describe('three-mode classification', () => {

    // ── 2.1 unified mode ──────────────────────────────────────────────────────

    describe('unified mode', () => {

      it('classifies as unified when AI weak AND KD < 30 AND volume > 100', async () => {
        setupSupabaseMock(
          [{ id: 'q-1', question: 'best china tour operators in new zealand' }],
          null,
          makeRuns('q-1', 5, true)   // 5/5 weak → score = 1.0
        )

        mockBulkKeywordVolume.mockResolvedValue([{
          keyword: 'best china tour operators in new zealand',
          search_volume: 500,
          keyword_difficulty: 15,
          cpc: 1.2,
          competition: 0.3,
          intent: 'commercial',
          position: null,
        }])

        const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

        expect(result).toHaveLength(1)
        expect(result[0].mode).toBe('unified')
        expect(result[0].primary_keyword).toBe('best china tour operators in new zealand')
        expect(result[0].keyword_volume).toBe(500)
        expect(result[0].keyword_kd).toBe(15)
      })

      it('classifies as unified when weakness_score = 1.0, KD = 29, volume = 101', async () => {
        setupSupabaseMock(
          [{ id: 'q-1', question: 'china tours nz' }],
          null,
          makeRuns('q-1', 3, true)
        )

        mockBulkKeywordVolume.mockResolvedValue([{
          keyword: 'china tours nz',
          search_volume: 101,
          keyword_difficulty: 29,
          cpc: 0.8,
          competition: 0.2,
          intent: 'commercial',
          position: null,
        }])

        const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
        expect(result[0].mode).toBe('unified')
      })
    })

    // ── 2.2 geo_only mode ─────────────────────────────────────────────────────

    describe('geo_only mode', () => {

      it('classifies as geo_only when AI weak but SEO signal insufficient (KD >= 30)', async () => {
        setupSupabaseMock(
          [{ id: 'q-1', question: 'best tour operator for china travel from nz' }],
          null,
          makeRuns('q-1', 4, true)   // 4/4 weak → score = 1.0
        )

        mockBulkKeywordVolume.mockResolvedValue([{
          keyword: 'best tour operator for china travel from nz',
          search_volume: 500,
          keyword_difficulty: 55,   // KD too high → geo_only
          cpc: 2.0,
          competition: 0.4,
          intent: 'commercial',
          position: null,
        }])

        const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

        expect(result).toHaveLength(1)
        expect(result[0].mode).toBe('geo_only')
      })

      it('classifies as geo_only when AI weak but volume <= 100', async () => {
        setupSupabaseMock(
          [{ id: 'q-1', question: 'specialised china visa nz travelers' }],
          null,
          makeRuns('q-1', 4, true)
        )

        mockBulkKeywordVolume.mockResolvedValue([{
          keyword: 'specialised china visa nz travelers',
          search_volume: 80,   // volume too low → geo_only
          keyword_difficulty: 10,
          cpc: 0.5,
          competition: 0.1,
          intent: 'informational',
          position: null,
        }])

        const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
        expect(result[0].mode).toBe('geo_only')
      })

      it('classifies as geo_only when SEMrush returns no data for the keyword', async () => {
        setupSupabaseMock(
          [{ id: 'q-1', question: 'obscure query with no semrush data' }],
          null,
          makeRuns('q-1', 3, true)
        )

        mockBulkKeywordVolume.mockResolvedValue([])   // no DataForSEO results

        const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

        expect(result).toHaveLength(1)
        expect(result[0].mode).toBe('geo_only')
        expect(result[0].primary_keyword).toBeUndefined()
        expect(result[0].keyword_volume).toBeUndefined()
        expect(result[0].keyword_kd).toBeUndefined()
      })

      it('classifies as geo_only when includeSemrush = false', async () => {
        setupSupabaseMock(
          [{ id: 'q-1', question: 'best nz china tours' }],
          null,
          makeRuns('q-1', 5, true)
        )

        // DataForSEO should NOT be called
        const result = await getWeakSpotOpportunities('client-1', 20, 10, false)

        expect(mockBulkKeywordVolume).not.toHaveBeenCalled()
        expect(result[0].mode).toBe('geo_only')
      })
    })

    // ── 2.3 seo_only mode ─────────────────────────────────────────────────────

    describe('seo_only mode', () => {

      it('classifies as seo_only when no AI weakness but strong SEO signal', async () => {
        // Brand is always mentioned (strong) → weakness_score below threshold → filtered from AI weak pool
        // But SEMrush keyword data (KD < 30, volume > 100) should surface it as seo_only
        setupSupabaseMock(
          [{ id: 'q-1', question: 'china tours new zealand packages' }],
          null,
          makeRuns('q-1', 5, false)   // all runs: brand ranked #1 → not weak
        )

        mockBulkKeywordVolume.mockResolvedValue([{
          keyword: 'china tours new zealand packages',
          search_volume: 800,
          keyword_difficulty: 20,
          cpc: 3.0,
          competition: 0.5,
          intent: 'transactional',
          position: null,
        }])

        const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

        // The function should surface seo_only opportunities from SEMrush data
        const seoOnly = result.filter(r => r.mode === 'seo_only')
        expect(seoOnly.length).toBeGreaterThanOrEqual(1)
        expect(seoOnly[0].keyword_kd).toBeLessThan(30)
        expect(seoOnly[0].keyword_volume).toBeGreaterThan(100)
      })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Exact Boundary Values
  // ═══════════════════════════════════════════════════════════════════════════

  describe('boundary values', () => {

    it('weakness_score = 0.3 exactly: NOT filtered out', async () => {
      // 3 weak out of 10 runs = 0.3 exactly — should be included
      const runs = [
        ...makeRuns('q-1', 3, true),
        ...makeRuns('q-1', 7, false),
      ]

      setupSupabaseMock(
        [{ id: 'q-1', question: 'china group tours from auckland' }],
        null,
        runs
      )

      const result = await getWeakSpotOpportunities('client-1', 20, 10, false)
      expect(result.length).toBe(1)
      expect(result[0].weakness_score).toBe(0.3)
    })

    it('weakness_score just below 0.3: filtered out', async () => {
      // 2 weak out of 10 runs = 0.2 — should be excluded
      const runs = [
        ...makeRuns('q-1', 2, true),
        ...makeRuns('q-1', 8, false),
      ]

      setupSupabaseMock(
        [{ id: 'q-1', question: 'nz to china group tours' }],
        null,
        runs
      )

      const result = await getWeakSpotOpportunities('client-1', 20, 10, false)
      expect(result).toEqual([])
    })

    it('KD = 30 exactly: does NOT qualify for unified (must be < 30)', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china tour packages nz' }],
        null,
        makeRuns('q-1', 5, true)
      )

      mockBulkKeywordVolume.mockResolvedValue([{
        keyword: 'china tour packages nz',
        search_volume: 500,
        keyword_difficulty: 30,   // exactly at boundary — NOT < 30 → geo_only
        cpc: 1.0,
        competition: 0.3,
        intent: 'commercial',
        position: null,
      }])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].mode).toBe('geo_only')
    })

    it('KD = 29 exactly: qualifies for unified', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china package holidays nz' }],
        null,
        makeRuns('q-1', 5, true)
      )

      mockBulkKeywordVolume.mockResolvedValue([{
        keyword: 'china package holidays nz',
        search_volume: 500,
        keyword_difficulty: 29,   // just below boundary
        cpc: 1.0,
        competition: 0.3,
        intent: 'commercial',
        position: null,
      }])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].mode).toBe('unified')
    })

    it('volume = 100 exactly: does NOT qualify for unified (must be > 100)', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'guided china tours nz' }],
        null,
        makeRuns('q-1', 5, true)
      )

      mockBulkKeywordVolume.mockResolvedValue([{
        keyword: 'guided china tours nz',
        search_volume: 100,   // exactly at boundary — NOT > 100 → geo_only
        keyword_difficulty: 15,
        cpc: 0.8,
        competition: 0.2,
        intent: 'commercial',
        position: null,
      }])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].mode).toBe('geo_only')
    })

    it('volume = 101 exactly: qualifies for unified', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'luxury china tours nz' }],
        null,
        makeRuns('q-1', 5, true)
      )

      mockBulkKeywordVolume.mockResolvedValue([{
        keyword: 'luxury china tours nz',
        search_volume: 101,   // just above boundary
        keyword_difficulty: 15,
        cpc: 1.2,
        competition: 0.3,
        intent: 'commercial',
        position: null,
      }])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].mode).toBe('unified')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DataForSEO Failure / Degradation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DataForSEO failure degradation', () => {

    it('returns geo_only opportunities when DataForSEO throws (quota exceeded)', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'best travel agents for china from nz' }],
        null,
        makeRuns('q-1', 5, true)
      )

      // Simulate quota exceeded / network failure
      mockBulkKeywordVolume.mockRejectedValue(new Error('DataForSEO API error: 429'))

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      expect(result).toHaveLength(1)
      expect(result[0].mode).toBe('geo_only')
      // No SEO keyword data attached when SEMrush fails
      expect(result[0].primary_keyword).toBeUndefined()
      expect(result[0].keyword_volume).toBeUndefined()
      expect(result[0].keyword_kd).toBeUndefined()
    })

    it('returns geo_only opportunities when DataForSEO returns empty array', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china group tour nz' }],
        null,
        makeRuns('q-1', 4, true)
      )

      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      expect(result[0].mode).toBe('geo_only')
      expect(result[0].keyword_kd).toBeUndefined()
    })

    it('does not call DataForSEO at all when includeSemrush is false', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china tours' }],
        null,
        makeRuns('q-1', 5, true)
      )

      await getWeakSpotOpportunities('client-1', 20, 10, false)

      expect(mockBulkKeywordVolume).not.toHaveBeenCalled()
    })

    it('does not call DataForSEO when no queries are found', async () => {
      setupSupabaseMock([])

      await getWeakSpotOpportunities('client-1', 20, 10, true)

      expect(mockBulkKeywordVolume).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Sorting Logic
  // ═══════════════════════════════════════════════════════════════════════════

  describe('sorting logic', () => {

    it('sorts unified before geo_only', async () => {
      setupSupabaseMock(
        [
          { id: 'q-geo', question: 'niche geo only query' },
          { id: 'q-uni', question: 'best china tours nz unified' },
        ],
        null,
        [
          // q-geo: weak (low volume → geo_only)
          ...makeRuns('q-geo', 5, true),
          // q-uni: weak (good SEO → unified)
          ...makeRuns('q-uni', 5, true),
        ]
      )

      mockBulkKeywordVolume.mockResolvedValue([
        {
          keyword: 'best china tours nz unified',
          search_volume: 500,
          keyword_difficulty: 15,
          cpc: 1.5,
          competition: 0.3,
          intent: 'commercial',
          position: null,
        },
        {
          keyword: 'niche geo only query',
          search_volume: 20,   // too low → geo_only
          keyword_difficulty: 5,
          cpc: 0.2,
          competition: 0.1,
          intent: 'informational',
          position: null,
        },
      ])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      const modes = result.map(r => r.mode)
      const unifiedIdx = modes.indexOf('unified')
      const geoIdx = modes.indexOf('geo_only')
      expect(unifiedIdx).toBeLessThan(geoIdx)
    })

    it('within same mode, sorts by weakness_score DESC', async () => {
      setupSupabaseMock(
        [
          { id: 'q-high', question: 'high weakness score query' },
          { id: 'q-low', question: 'low weakness score query' },
        ],
        null,
        [
          // q-high: 5/5 weak → score = 1.0
          ...makeRuns('q-high', 5, true),
          // q-low: 2/4 weak → score = 0.5
          { query_id: 'q-low', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' },
          { query_id: 'q-low', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-02T10:00:00Z' },
          { query_id: 'q-low', ai_engine: 'openai', client_brand_rank: 1, ran_at: '2026-05-03T10:00:00Z' },
          { query_id: 'q-low', ai_engine: 'openai', client_brand_rank: 1, ran_at: '2026-05-04T10:00:00Z' },
        ]
      )

      // Both get no DataForSEO data → both geo_only
      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      expect(result[0].query_id).toBe('q-high')
      expect(result[1].query_id).toBe('q-low')
      expect(result[0].weakness_score).toBeGreaterThan(result[1].weakness_score)
    })

    it('within same mode and same weakness_score, sorts by engines_missing count DESC', async () => {
      setupSupabaseMock(
        [
          { id: 'q-multi', question: 'multi engine weak query' },
          { id: 'q-single', question: 'single engine weak query' },
        ],
        null,
        [
          // q-multi: weak across 3 engines (3/3 runs → score=1.0, 3 engines)
          { query_id: 'q-multi', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' },
          { query_id: 'q-multi', ai_engine: 'anthropic', client_brand_rank: null, ran_at: '2026-05-01T11:00:00Z' },
          { query_id: 'q-multi', ai_engine: 'perplexity', client_brand_rank: null, ran_at: '2026-05-01T12:00:00Z' },
          // q-single: weak in 1 engine, strong in 2 (1/3 runs weak → score=0.33, 1 engine)
          // But 0.33 >= 0.3, so it's included
          { query_id: 'q-single', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' },
          { query_id: 'q-single', ai_engine: 'anthropic', client_brand_rank: 1, ran_at: '2026-05-01T11:00:00Z' },
          { query_id: 'q-single', ai_engine: 'perplexity', client_brand_rank: 1, ran_at: '2026-05-01T12:00:00Z' },
        ]
      )

      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      // q-multi has higher weakness_score (1.0 vs 0.33) → comes first
      expect(result[0].query_id).toBe('q-multi')
      expect(result[0].engines_missing.length).toBeGreaterThan(result[1].engines_missing.length)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Returned Shape & Field Accuracy
  // ═══════════════════════════════════════════════════════════════════════════

  describe('returned BlogOpportunity shape', () => {

    it('includes all required fields on a geo_only result', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'best china tours from auckland' }],
        null,
        [
          { query_id: 'q-1', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' },
          { query_id: 'q-1', ai_engine: 'anthropic', client_brand_rank: null, ran_at: '2026-05-02T10:00:00Z' },
          { query_id: 'q-1', ai_engine: 'perplexity', client_brand_rank: 1, ran_at: '2026-05-03T10:00:00Z' },
        ]
      )

      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      expect(result).toHaveLength(1)
      const opp = result[0]

      expect(opp.query_id).toBe('q-1')
      expect(opp.query_text).toBe('best china tours from auckland')
      expect(opp.weakness_score).toBeCloseTo(0.67, 1)
      expect(opp.engines_missing).toContain('openai')
      expect(opp.engines_missing).toContain('anthropic')
      expect(opp.engines_missing).not.toContain('perplexity')
      expect(opp.total_runs_checked).toBe(3)
      expect(opp.last_run_at).toBe('2026-05-03T10:00:00Z')
      expect(opp.mode).toBe('geo_only')
    })

    it('includes keyword fields on a unified result', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'recommended china tour companies nz' }],
        null,
        makeRuns('q-1', 5, true)
      )

      mockBulkKeywordVolume.mockResolvedValue([{
        keyword: 'recommended china tour companies nz',
        search_volume: 320,
        keyword_difficulty: 22,
        cpc: 1.8,
        competition: 0.3,
        intent: 'commercial',
        position: null,
      }])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      const opp = result[0]

      expect(opp.mode).toBe('unified')
      expect(opp.primary_keyword).toBe('recommended china tour companies nz')
      expect(opp.keyword_volume).toBe(320)
      expect(opp.keyword_kd).toBe(22)
      expect(opp.keyword_intent).toBe('commercial')
    })

    it('weakness_score is rounded to 2 decimal places', async () => {
      // 2/3 runs weak → 0.666... → should be 0.67
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china tour packages from wellington' }],
        null,
        [
          { query_id: 'q-1', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' },
          { query_id: 'q-1', ai_engine: 'anthropic', client_brand_rank: null, ran_at: '2026-05-02T10:00:00Z' },
          { query_id: 'q-1', ai_engine: 'perplexity', client_brand_rank: 2, ran_at: '2026-05-03T10:00:00Z' },
        ]
      )

      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].weakness_score).toBe(0.67)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Limit and Lookback Parameters
  // ═══════════════════════════════════════════════════════════════════════════

  describe('limit and lookback parameters', () => {

    it('respects the limit parameter', async () => {
      const queries = Array.from({ length: 5 }, (_, i) => ({
        id: `q-${i}`,
        question: `query ${i}`,
      }))

      const runs = queries.flatMap(q => makeRuns(q.id, 3, true))

      setupSupabaseMock(queries, null, runs)
      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 3, 10, false)

      expect(result).toHaveLength(3)
    })

    it('uses lookback to cap runs per query', async () => {
      // 15 runs for a single query, but lookback = 5
      const allRuns = [
        ...makeRuns('q-1', 3, true),    // first 3 = weak (within lookback of 5)
        ...makeRuns('q-1', 2, false),   // next 2 = strong (within lookback of 5)
        ...makeRuns('q-1', 10, true),   // 10 more — beyond lookback, should be ignored
      ]

      setupSupabaseMock(
        [{ id: 'q-1', question: 'china travel packages nz' }],
        null,
        allRuns
      )

      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 5, false)

      // 3 weak out of 5 lookback = 0.6
      expect(result[0].total_runs_checked).toBe(5)
      expect(result[0].weakness_score).toBe(0.6)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Weakness Score Computation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('weakness_score computation', () => {

    it('treats client_brand_rank = null as weak (brand not mentioned)', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china tours nz booking' }],
        null,
        [{ query_id: 'q-1', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' }]
      )

      mockBulkKeywordVolume.mockResolvedValue([])
      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].weakness_score).toBe(1)
    })

    it('treats client_brand_rank > 3 as weak (not in top 3)', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china holiday packages nz' }],
        null,
        [{ query_id: 'q-1', ai_engine: 'openai', client_brand_rank: 4, ran_at: '2026-05-01T10:00:00Z' }]
      )

      mockBulkKeywordVolume.mockResolvedValue([])
      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].weakness_score).toBe(1)
    })

    it('treats client_brand_rank <= 3 as strong (not weak)', async () => {
      // 1 strong run out of 1 → weakness_score = 0 → filtered out (< 0.3)
      setupSupabaseMock(
        [{ id: 'q-1', question: 'china tours booking nz' }],
        null,
        [{ query_id: 'q-1', ai_engine: 'openai', client_brand_rank: 3, ran_at: '2026-05-01T10:00:00Z' }]
      )

      mockBulkKeywordVolume.mockResolvedValue([])
      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result).toEqual([])
    })

    it('captures the latest ran_at across all runs for a query', async () => {
      setupSupabaseMock(
        [{ id: 'q-1', question: 'latest run date test' }],
        null,
        [
          { query_id: 'q-1', ai_engine: 'openai', client_brand_rank: null, ran_at: '2026-05-01T10:00:00Z' },
          { query_id: 'q-1', ai_engine: 'anthropic', client_brand_rank: null, ran_at: '2026-05-04T15:00:00Z' },
          { query_id: 'q-1', ai_engine: 'perplexity', client_brand_rank: null, ran_at: '2026-05-02T08:00:00Z' },
        ]
      )

      mockBulkKeywordVolume.mockResolvedValue([])

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)
      expect(result[0].last_run_at).toBe('2026-05-04T15:00:00Z')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Multiple Queries — Integration Scenario
  // ═══════════════════════════════════════════════════════════════════════════

  describe('multi-query mixed scenario', () => {

    it('correctly classifies and sorts a mix of unified, geo_only queries', async () => {
      setupSupabaseMock(
        [
          { id: 'q-geo-high', question: 'niche geo high weakness' },
          { id: 'q-geo-low', question: 'niche geo lower weakness' },
          { id: 'q-uni', question: 'best china tours auckland unified' },
        ],
        null,
        [
          // q-geo-high: 5/5 weak, no SEO
          ...makeRuns('q-geo-high', 5, true),
          // q-geo-low: 3/5 weak, no SEO
          ...makeRuns('q-geo-low', 3, true),
          ...makeRuns('q-geo-low', 2, false),
          // q-uni: 5/5 weak, good SEO
          ...makeRuns('q-uni', 5, true),
        ]
      )

      mockBulkKeywordVolume.mockImplementation(async (keywords: string[]) => {
        return keywords
          .filter(k => k.includes('unified'))
          .map(k => ({
            keyword: k,
            search_volume: 400,
            keyword_difficulty: 18,
            cpc: 2.0,
            competition: 0.4,
            intent: 'commercial',
            position: null,
          }))
      })

      const result = await getWeakSpotOpportunities('client-1', 20, 10, true)

      // Verify mode distribution
      expect(result.find(r => r.mode === 'unified')).toBeDefined()
      expect(result.filter(r => r.mode === 'geo_only').length).toBe(2)

      // unified comes first
      expect(result[0].mode).toBe('unified')

      // Within geo_only, higher weakness_score first
      const geoOpps = result.filter(r => r.mode === 'geo_only')
      expect(geoOpps[0].weakness_score).toBeGreaterThanOrEqual(geoOpps[1].weakness_score)
    })
  })
})
