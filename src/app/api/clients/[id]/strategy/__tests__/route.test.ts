/**
 * Tests for GET /api/clients/[id]/strategy
 *
 * TDD: RED phase — all tests must fail before implementation exists.
 *
 * Mock strategy:
 * - vi.mock factories use vi.fn() directly (no top-level variable references)
 *   to avoid hoisting issues with const declarations.
 * - Concrete mock references obtained via vi.mocked() after import.
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

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import type { ListStrategyResponse } from '../route'
import type { StrategyItem, StrategyStatus } from '@/lib/strategy/types'

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
// Test data factories
// ---------------------------------------------------------------------------

function makeStrategyItem(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    client_id: 'client-1',
    strategy_run_id: 'run-abc-123',
    action_type: 'new_blog',
    content_mode: 'unified',
    priority: 'high',
    priority_score: 75,
    proposed_title: 'Test Strategy Item',
    rationale: 'AI models rank brand weakly',
    content_angle: 'Answer directly',
    source_page_id: null,
    source_query_id: 'query-1',
    source_keyword: 'test keyword',
    keyword_volume: 500,
    keyword_kd: 30,
    status: 'pending',
    linked_blog_post_id: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  }
}

function makeRequest(clientId: string, searchParams?: Record<string, string>): [NextRequest, { params: { id: string } }] {
  const url = new URL(`http://localhost/api/clients/${clientId}/strategy`)
  if (searchParams) {
    Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const req = new NextRequest(url.toString())
  return [req, { params: { id: clientId } }]
}

// ---------------------------------------------------------------------------
// Supabase mock builder
// ---------------------------------------------------------------------------

interface MockQueryChain {
  mockItems: StrategyItem[]
  mockTotal: number
  mockError?: { message: string }
}

function buildQueryChain({ mockItems, mockTotal, mockError }: MockQueryChain) {
  // Represents the terminal select call that includes { count: 'exact' }
  const terminal = vi.fn().mockResolvedValue({
    data: mockError ? null : mockItems,
    count: mockError ? null : mockTotal,
    error: mockError ?? null,
  })

  // Range needs to return something with the terminal structure
  const rangeFn = vi.fn().mockReturnValue({ data: mockItems, count: mockTotal, error: null, then: terminal })

  // Build a chainable mock that accumulates filters
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({
      data: mockError ? null : mockItems,
      count: mockError ? null : mockTotal,
      error: mockError ?? null,
    }),
  }

  return chain
}

function setupClientWithItems(
  clientId: string,
  items: StrategyItem[],
  total = items.length
) {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({
      data: items,
      count: total,
      error: null,
    }),
    single: vi.fn().mockResolvedValue({
      data: { id: clientId },
      error: null,
    }),
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: clientId },
              error: null,
            }),
          }),
        }),
      }
    }
    if (table === 'content_strategy_items') {
      return mockChain
    }
    return mockChain
  })

  vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom)
  return { mockChain }
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

function setupItemsQueryError(clientId: string) {
  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'clients') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: clientId },
              error: null,
            }),
          }),
        }),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: null,
        count: null,
        error: { message: 'DB query failed' },
      }),
    }
  })

  vi.mocked(supabaseAdmin.from).mockImplementation(mockFrom)
}

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/strategy', () => {

  // =========================================================================
  // Suite 1: Client validation
  // =========================================================================

  describe('Suite 1: Client validation', () => {
    it('returns 404 when client is not found', async () => {
      setupClientNotFound()

      const [req, ctx] = makeRequest('nonexistent-id')
      const response = await GET(req, ctx)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error).toMatch(/client not found/i)
    })

    it('returns 200 when client exists', async () => {
      setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)

      expect(response.status).toBe(200)
    })
  })

  // =========================================================================
  // Suite 2: Basic response shape
  // =========================================================================

  describe('Suite 2: Response shape', () => {
    it('returns correct shape: { items, total, limit, offset }', async () => {
      const items = [makeStrategyItem()]
      setupClientWithItems('client-1', items, 1)

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(body).toMatchObject({
        items: expect.any(Array),
        total: expect.any(Number),
        limit: expect.any(Number),
        offset: expect.any(Number),
      })
    })

    it('returns empty items array (not error) when no strategy items exist', async () => {
      setupClientWithItems('client-1', [], 0)

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(response.status).toBe(200)
      expect(body.items).toEqual([])
      expect(body.total).toBe(0)
    })

    it('returns items ordered by priority_score DESC', async () => {
      const items = [
        makeStrategyItem({ priority_score: 90, id: 'item-high' }),
        makeStrategyItem({ priority_score: 50, id: 'item-med' }),
        makeStrategyItem({ priority_score: 20, id: 'item-low' }),
      ]
      setupClientWithItems('client-1', items, 3)

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(body.items[0].id).toBe('item-high')
      expect(body.items[1].id).toBe('item-med')
      expect(body.items[2].id).toBe('item-low')
    })
  })

  // =========================================================================
  // Suite 3: Filtering
  // =========================================================================

  describe('Suite 3: Filtering', () => {
    it('filters by status when valid status is provided', async () => {
      const pendingItems = [makeStrategyItem({ status: 'pending' })]
      const { mockChain } = setupClientWithItems('client-1', pendingItems, 1)

      const [req, ctx] = makeRequest('client-1', { status: 'pending' })
      await GET(req, ctx)

      expect(mockChain.eq).toHaveBeenCalledWith('status', 'pending')
    })

    it('returns 400 for invalid status value', async () => {
      setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1', { status: 'invalid_status' })
      const response = await GET(req, ctx)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
    })

    it('accepts all valid status values without error', async () => {
      const validStatuses: StrategyStatus[] = ['pending', 'approved', 'in_progress', 'done', 'dismissed']

      for (const status of validStatuses) {
        vi.clearAllMocks()
        setupClientWithItems('client-1', [])

        const [req, ctx] = makeRequest('client-1', { status })
        const response = await GET(req, ctx)

        expect(response.status).toBe(200)
      }
    })

    it('filters by run_id when provided', async () => {
      const runId = 'run-xyz-789'
      const items = [makeStrategyItem({ strategy_run_id: runId })]
      const { mockChain } = setupClientWithItems('client-1', items, 1)

      const [req, ctx] = makeRequest('client-1', { run_id: runId })
      await GET(req, ctx)

      expect(mockChain.eq).toHaveBeenCalledWith('strategy_run_id', runId)
    })

    it('does not filter by status when status is omitted', async () => {
      const { mockChain } = setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1')
      await GET(req, ctx)

      // eq should only be called for client_id, NOT for status
      const eqCalls = mockChain.eq.mock.calls as [string, unknown][]
      const statusCall = eqCalls.find(([field]) => field === 'status')
      expect(statusCall).toBeUndefined()
    })

    it('does not filter by run_id when run_id is omitted', async () => {
      const { mockChain } = setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1')
      await GET(req, ctx)

      const eqCalls = mockChain.eq.mock.calls as [string, unknown][]
      const runIdCall = eqCalls.find(([field]) => field === 'strategy_run_id')
      expect(runIdCall).toBeUndefined()
    })
  })

  // =========================================================================
  // Suite 4: Pagination
  // =========================================================================

  describe('Suite 4: Pagination', () => {
    it('uses default limit=50 when not specified', async () => {
      setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(body.limit).toBe(50)
    })

    it('uses default offset=0 when not specified', async () => {
      setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(body.offset).toBe(0)
    })

    it('applies custom limit and offset to range call', async () => {
      const { mockChain } = setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1', { limit: '10', offset: '20' })
      await GET(req, ctx)

      expect(mockChain.range).toHaveBeenCalledWith(20, 29) // offset=20, offset+limit-1=29
    })

    it('returns correct total from DB count', async () => {
      const items = [makeStrategyItem()]
      setupClientWithItems('client-1', items, 100) // total=100, but only 1 returned

      const [req, ctx] = makeRequest('client-1', { limit: '1' })
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(body.total).toBe(100)
    })

    it('clamps limit to 100 when value > 100', async () => {
      const { mockChain } = setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1', { limit: '200' })
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(response.status).toBe(200)
      expect(body.limit).toBe(100)
      expect(mockChain.range).toHaveBeenCalledWith(0, 99)
    })

    it('clamps limit to 1 when value < 1', async () => {
      const { mockChain } = setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1', { limit: '0' })
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(response.status).toBe(200)
      expect(body.limit).toBe(1)
    })

    it('defaults offset to 0 when negative value provided', async () => {
      const { mockChain } = setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1', { offset: '-5' })
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(response.status).toBe(200)
      expect(body.offset).toBe(0)
      expect(mockChain.range).toHaveBeenCalledWith(0, 49)
    })

    it('echoes limit and offset back in the response', async () => {
      setupClientWithItems('client-1', [])

      const [req, ctx] = makeRequest('client-1', { limit: '25', offset: '10' })
      const response = await GET(req, ctx)
      const body = await response.json() as ListStrategyResponse

      expect(body.limit).toBe(25)
      expect(body.offset).toBe(10)
    })
  })

  // =========================================================================
  // Suite 5: Error handling
  // =========================================================================

  describe('Suite 5: Error handling', () => {
    it('returns 500 when DB query for items fails', async () => {
      setupItemsQueryError('client-1')

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)

      expect(response.status).toBe(500)
    })

    it('returns 500 when unexpected error is thrown', async () => {
      vi.mocked(supabaseAdmin.from).mockImplementation(() => {
        throw new Error('Unexpected DB failure')
      })

      const [req, ctx] = makeRequest('client-1')
      const response = await GET(req, ctx)

      expect(response.status).toBe(500)
    })
  })
})
