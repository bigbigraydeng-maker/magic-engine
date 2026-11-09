/**
 * Tests for POST /api/clients/[id]/strategy/generate
 *
 * TDD: RED phase — all tests must fail before implementation exists.
 *
 * Mock strategy:
 * - vi.mock factories use vi.fn() directly (no top-level variable references)
 *   to avoid hoisting issues with const declarations.
 * - Concrete mock references obtained via vi.mocked() after import.
 * - scorer is NOT mocked — it is a pure function used as-is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/strategy/analyzer', () => ({
  fetchClientPages: vi.fn(),
  fetchWeakAIQueries: vi.fn(),
  fetchKeywordOpportunities: vi.fn(),
  analyzeOpportunities: vi.fn(),
}))

// P14.C.5: the route loads per-client SEO mode confidence before scoring.
// Zero-filled entries → getModeBoost() = 0 → scoring identical to pre-P14.C.5.
// getModeBoost stays real (pure function).
vi.mock('@/lib/case-library/outcome-confidence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/case-library/outcome-confidence')>()
  return {
    ...actual,
    fetchSeoBlogConfidenceByMode: vi.fn().mockResolvedValue({
      unified:  { successRate: 0, sampleSize: 0 },
      geo_only: { successRate: 0, sampleSize: 0 },
      seo_only: { successRate: 0, sampleSize: 0 },
    }),
  }
})

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchClientPages,
  fetchWeakAIQueries,
  fetchKeywordOpportunities,
  analyzeOpportunities,
} from '@/lib/strategy/analyzer'
import type { GenerateResponse } from '../route'
import type { RawOpportunity } from '@/lib/strategy/types'

// Phase X.S2: paid-tier auth bypass — these route tests target the business
// logic, not the auth path. Real wiring is covered in
// src/lib/auth/__tests__/client-access.test.ts.
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
  requirePaidClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))


// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockFetchClientPages = vi.mocked(fetchClientPages)
const mockFetchWeakAIQueries = vi.mocked(fetchWeakAIQueries)
const mockFetchKeywordOpportunities = vi.mocked(fetchKeywordOpportunities)
const mockAnalyzeOpportunities = vi.mocked(analyzeOpportunities)

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeRawOpportunity(overrides: Partial<RawOpportunity> = {}): RawOpportunity {
  return {
    action_type: 'new_blog',
    content_mode: 'unified',
    proposed_title: 'Test Blog Post',
    rationale: 'AI models rank brand weakly',
    content_angle: 'Answer the query directly',
    source_page_id: null,
    source_query_id: 'query-1',
    source_keyword: 'test keyword',
    keyword_volume: 500,
    keyword_kd: 30,
    scoring_context: {
      has_existing_page: false,
      has_geo_block: false,
      word_count: null,
      page_type: null,
      ai_weak: true,
      ai_weak_model_count: 3,
      keyword_volume: 500,
      keyword_kd: 30,
    },
    ...overrides,
  }
}

function makeRequest(clientId = 'client-1'): [NextRequest, { params: { id: string } }] {
  const req = new NextRequest(
    `http://localhost/api/clients/${clientId}/strategy/generate`,
    { method: 'POST' }
  )
  return [req, { params: { id: clientId } }]
}

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

function setupClientFound(clientId = 'client-1') {
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: clientId, name: 'Test Client' },
          error: null,
        }),
      }),
    }),
  } as any)
}

function setupClientNotFound() {
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'Not found' },
        }),
      }),
    }),
  } as any)
}

function setupClientFoundWithInsert(clientId = 'client-1') {
  // P14.C.3: the route now upserts with ignoreDuplicates. Echo back what was
  // passed to upsert() as the DB-returned rows, adding minimal DB-generated
  // fields so StrategyItem shape is satisfied.
  const mockSelect = vi.fn().mockImplementation(function () {
    const insertedPayload: object[] = (mockUpsert.mock.calls[0]?.[0] ?? []) as object[]
    const now = new Date().toISOString()
    const rows = insertedPayload.map((row, i) => ({
      id: `generated-id-${i}`,
      created_at: now,
      updated_at: now,
      ...(row as object),
    }))
    return Promise.resolve({ data: rows, error: null })
  })
  const mockUpsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.fn()

  mockFrom.mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: clientId, name: 'Test Client' },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'content_strategy_items') {
      return { upsert: mockUpsert }
    }
    return { select: vi.fn(), upsert: vi.fn() }
  })

  vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom)
  return { mockUpsert, mockSelect }
}

function setupClientFoundWithInsertError(clientId = 'client-1') {
  const mockFrom = vi.fn()

  mockFrom.mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: clientId, name: 'Test Client' },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'content_strategy_items') {
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'DB insert failed' },
          }),
        }),
      }
    }
    return {}
  })

  vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom)
}

// ---------------------------------------------------------------------------
// Default analyzer mocks
// ---------------------------------------------------------------------------

function setupAnalyzerDefaults() {
  mockFetchClientPages.mockResolvedValue([])
  mockFetchWeakAIQueries.mockResolvedValue([])
  mockFetchKeywordOpportunities.mockResolvedValue([])
  mockAnalyzeOpportunities.mockResolvedValue([])
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  setupAnalyzerDefaults()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/strategy/generate', () => {

  // =========================================================================
  // Suite 1: Client validation
  // =========================================================================

  describe('Suite 1: Client validation', () => {
    it('returns 404 when client is not found', async () => {
      setupClientNotFound()

      const [req, ctx] = makeRequest('nonexistent-id')
      const response = await POST(req, ctx)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error).toMatch(/client not found/i)
    })

    it('returns 200 (not 404) when client exists', async () => {
      setupClientFoundWithInsert()

      const [req, ctx] = makeRequest('client-1')
      const response = await POST(req, ctx)

      expect(response.status).toBe(200)
    })
  })

  // =========================================================================
  // Suite 2: Empty opportunities
  // =========================================================================

  describe('Suite 2: Empty opportunities', () => {
    it('returns 200 with empty items when analyzeOpportunities returns []', async () => {
      setupClientFoundWithInsert()
      mockAnalyzeOpportunities.mockResolvedValue([])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(response.status).toBe(200)
      expect(body.items).toEqual([])
      expect(body.count).toBe(0)
    })

    it('returns a valid UUID strategy_run_id even when items is empty', async () => {
      setupClientFoundWithInsert()
      mockAnalyzeOpportunities.mockResolvedValue([])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(body.strategy_run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })
  })

  // =========================================================================
  // Suite 3: Items generation and scoring
  // =========================================================================

  describe('Suite 3: Items generation and scoring', () => {
    it('returns 200 with scored items when analyzeOpportunities returns opportunities', async () => {
      const { mockUpsert } = setupClientFoundWithInsert()
      const opp = makeRawOpportunity()
      mockAnalyzeOpportunities.mockResolvedValue([opp])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(response.status).toBe(200)
      expect(body.items).toHaveLength(1)
      expect(body.count).toBe(1)
      expect(body.skipped_duplicates).toBe(0)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
    })

    it('each item has required fields: strategy_run_id, client_id, action_type, content_mode, priority, priority_score', async () => {
      setupClientFoundWithInsert()
      const opp = makeRawOpportunity({
        action_type: 'new_blog',
        content_mode: 'unified',
        scoring_context: {
          has_existing_page: false,
          has_geo_block: false,
          word_count: null,
          page_type: null,
          ai_weak: true,
          ai_weak_model_count: 3,
          keyword_volume: 500,
          keyword_kd: 30,
        },
      })
      mockAnalyzeOpportunities.mockResolvedValue([opp])

      const [req, ctx] = makeRequest('client-1')
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      const item = body.items[0]
      expect(item.strategy_run_id).toBeDefined()
      expect(item.client_id).toBe('client-1')
      expect(item.action_type).toBeDefined()
      expect(item.content_mode).toBeDefined()
      expect(item.priority).toBeDefined()
      expect(item.priority_score).toBeDefined()
    })

    it('items are sorted by priority_score DESC', async () => {
      setupClientFoundWithInsert()

      const lowScoreOpp = makeRawOpportunity({
        proposed_title: 'Low Priority',
        scoring_context: {
          has_existing_page: true,
          has_geo_block: true,
          word_count: 1000,
          page_type: 'blog',
          ai_weak: false,
          ai_weak_model_count: 0,
          keyword_volume: null,
          keyword_kd: null,
        },
      })

      const highScoreOpp = makeRawOpportunity({
        proposed_title: 'High Priority',
        scoring_context: {
          has_existing_page: false,
          has_geo_block: false,
          word_count: null,
          page_type: null,
          ai_weak: true,
          ai_weak_model_count: 4,
          keyword_volume: 1000,
          keyword_kd: 25,
        },
      })

      mockAnalyzeOpportunities.mockResolvedValue([lowScoreOpp, highScoreOpp])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(body.items[0].priority_score).toBeGreaterThanOrEqual(body.items[1].priority_score)
    })

    it('count matches items.length', async () => {
      setupClientFoundWithInsert()
      const opps = [makeRawOpportunity(), makeRawOpportunity({ proposed_title: 'Second' })]
      mockAnalyzeOpportunities.mockResolvedValue(opps)

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(body.count).toBe(body.items.length)
      expect(body.count).toBe(2)
    })

    it('strategy_run_id is a valid UUID', async () => {
      setupClientFoundWithInsert()
      mockAnalyzeOpportunities.mockResolvedValue([makeRawOpportunity()])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(body.strategy_run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
    })

    it('all items share the same strategy_run_id', async () => {
      setupClientFoundWithInsert()
      const opps = [makeRawOpportunity(), makeRawOpportunity({ proposed_title: 'Another' })]
      mockAnalyzeOpportunities.mockResolvedValue(opps)

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      const runIds = new Set(body.items.map(i => i.strategy_run_id))
      expect(runIds.size).toBe(1)
    })

    it('handles opportunities with various content_modes correctly', async () => {
      setupClientFoundWithInsert()

      const unifiedOpp = makeRawOpportunity({ content_mode: 'unified' })
      const geoOpp = makeRawOpportunity({
        content_mode: 'geo_only',
        proposed_title: 'GEO only',
        scoring_context: {
          has_existing_page: false,
          has_geo_block: false,
          word_count: null,
          page_type: null,
          ai_weak: true,
          ai_weak_model_count: 2,
          keyword_volume: null,
          keyword_kd: null,
        },
      })
      const seoOpp = makeRawOpportunity({
        content_mode: 'seo_only',
        proposed_title: 'SEO only',
        scoring_context: {
          has_existing_page: false,
          has_geo_block: false,
          word_count: null,
          page_type: null,
          ai_weak: false,
          ai_weak_model_count: 0,
          keyword_volume: 200,
          keyword_kd: 20,
        },
      })

      mockAnalyzeOpportunities.mockResolvedValue([unifiedOpp, geoOpp, seoOpp])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(response.status).toBe(200)
      expect(body.items).toHaveLength(3)

      const modes = body.items.map(i => i.content_mode)
      expect(modes).toContain('unified')
      expect(modes).toContain('geo_only')
      expect(modes).toContain('seo_only')
    })
  })

  // =========================================================================
  // Suite 4: Parallel data fetching
  // =========================================================================

  describe('Suite 4: Parallel data fetching', () => {
    it('calls fetchClientPages, fetchWeakAIQueries, and fetchKeywordOpportunities', async () => {
      setupClientFoundWithInsert('client-abc')

      const [req, ctx] = makeRequest('client-abc')
      await POST(req, ctx)

      expect(mockFetchClientPages).toHaveBeenCalledWith('client-abc')
      expect(mockFetchWeakAIQueries).toHaveBeenCalledWith('client-abc')
      expect(mockFetchKeywordOpportunities).toHaveBeenCalledWith('client-abc')
    })

    it('calls analyzeOpportunities with clientId and the three fetched arrays', async () => {
      setupClientFoundWithInsert('client-abc')

      const pages = [{ id: 'p1', url: 'https://example.com', title: 'Home', page_type: 'service', topics: [], primary_keyword: null, word_count: 300, has_geo_block: false }]
      const queries = [{ id: 'q1', question: 'best tour?', avg_rank: null, weak_model_count: 3 }]
      const keywords = [{ keyword: 'tour', volume: 500, kd: 30, intent: 'commercial' }]

      mockFetchClientPages.mockResolvedValue(pages)
      mockFetchWeakAIQueries.mockResolvedValue(queries)
      mockFetchKeywordOpportunities.mockResolvedValue(keywords)

      const [req, ctx] = makeRequest('client-abc')
      await POST(req, ctx)

      expect(mockAnalyzeOpportunities).toHaveBeenCalledWith(
        'client-abc',
        pages,
        queries,
        keywords
      )
    })
  })

  // =========================================================================
  // Suite 5: DB insert and error handling
  // =========================================================================

  describe('Suite 5: DB insert and error handling', () => {
    it('upserts items into content_strategy_items, ignoring (client_id, proposed_title) duplicates', async () => {
      const { mockUpsert } = setupClientFoundWithInsert()
      mockAnalyzeOpportunities.mockResolvedValue([makeRawOpportunity()])

      const [req, ctx] = makeRequest()
      await POST(req, ctx)

      expect(mockUpsert).toHaveBeenCalledTimes(1)
      const insertedItems = mockUpsert.mock.calls[0][0] as unknown[]
      expect(insertedItems).toHaveLength(1)
      // P14.C.3: re-running strategy must not pollute the kanban with duplicates
      expect(mockUpsert.mock.calls[0][1]).toEqual({
        onConflict:       'client_id,proposed_title',
        ignoreDuplicates: true,
      })
    })

    it('reports skipped_duplicates when the DB returns fewer rows than were sent', async () => {
      const { mockUpsert, mockSelect } = setupClientFoundWithInsert()
      mockAnalyzeOpportunities.mockResolvedValue([
        makeRawOpportunity(),
        makeRawOpportunity({ proposed_title: 'Already on the kanban' }),
      ])
      // DB ignored one duplicate row → only one row comes back
      mockSelect.mockImplementation(() => {
        const sent = (mockUpsert.mock.calls[0]?.[0] ?? []) as object[]
        return Promise.resolve({
          data: [{ id: 'generated-id-0', created_at: 'now', updated_at: 'now', ...sent[0] }],
          error: null,
        })
      })

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json() as GenerateResponse

      expect(response.status).toBe(200)
      expect(body.count).toBe(1)
      expect(body.skipped_duplicates).toBe(1)
    })

    it('returns 500 when DB upsert fails', async () => {
      setupClientFoundWithInsertError()
      mockAnalyzeOpportunities.mockResolvedValue([makeRawOpportunity()])

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })

    it('returns 500 when an unexpected error is thrown', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        throw new Error('Unexpected DB failure')
      })

      const [req, ctx] = makeRequest()
      const response = await POST(req, ctx)

      expect(response.status).toBe(500)
    })
  })
})
