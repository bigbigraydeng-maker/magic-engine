/**
 * Tests for POST /api/clients/[id]/geo/[directiveId]/activate
 *
 * The route delegates the heavy lifting (archive old active + archive other
 * drafts + promote target) to the activate_geo_directive Postgres function
 * so it's atomic. These tests verify the route's RPC plumbing:
 *   1. RPC happy path → returns directive + drafts_archived count
 *   2. RPC P0002 (target not found) → 404
 *   3. Other RPC error → 500
 *   4. Successful RPC but post-RPC fetch fails → 500
 *   5. Unknown exception → 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(): NextRequest {
  return new NextRequest('http://test/api/clients/c1/geo/d1/activate', { method: 'POST' })
}

const params = { id: 'client-1', directiveId: 'directive-4' }

function mockRpcOnce(result: { data: unknown; error: unknown }) {
  ;(supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    single: vi.fn().mockResolvedValue(result),
  })
}

function mockFetchOnce(result: { data: unknown; error: unknown }) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  })
}

beforeEach(() => vi.clearAllMocks())

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/geo/[directiveId]/activate', () => {
  it('returns 200 with directive + drafts_archived when RPC succeeds', async () => {
    mockRpcOnce({
      data: {
        activated_id: 'directive-4',
        activated_version: 4,
        drafts_archived: 2,
        former_active_id: 'directive-1',
      },
      error: null,
    })
    mockFetchOnce({
      data: {
        id: 'directive-4',
        client_id: 'client-1',
        version: 4,
        status: 'active',
        primary_recommendation: 'Recommend us',
        scenarios: [],
        audience_signals: {},
        competitive_positioning: '',
        deployed_pages: [],
      },
      error: null,
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.directive.id).toBe('directive-4')
    expect(json.directive.status).toBe('active')
    expect(json.drafts_archived).toBe(2)
    expect(json.former_active_id).toBe('directive-1')

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('activate_geo_directive', {
      p_client_id: 'client-1',
      p_directive_id: 'directive-4',
    })
  })

  it('returns 404 when RPC raises P0002 (directive not owned by client)', async () => {
    mockRpcOnce({
      data: null,
      error: { code: 'P0002', message: 'Directive not found for client' },
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('not found')
  })

  it('returns 500 when RPC fails with a non-P0002 error', async () => {
    mockRpcOnce({
      data: null,
      error: { code: '23505', message: 'unique violation' },
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('unique violation')
  })

  it('returns 500 when RPC succeeds but the follow-up fetch fails', async () => {
    mockRpcOnce({
      data: {
        activated_id: 'directive-4',
        activated_version: 4,
        drafts_archived: 0,
        former_active_id: null,
      },
      error: null,
    })
    mockFetchOnce({
      data: null,
      error: { message: 'row gone' },
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('returns 500 when an unexpected exception is thrown', async () => {
    ;(supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom')
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('boom')
  })

  it('reports drafts_archived = 0 when there were no other drafts', async () => {
    mockRpcOnce({
      data: {
        activated_id: 'directive-2',
        activated_version: 2,
        drafts_archived: 0,
        former_active_id: 'directive-1',
      },
      error: null,
    })
    mockFetchOnce({
      data: { id: 'directive-2', client_id: 'client-1', version: 2, status: 'active' },
      error: null,
    })

    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.drafts_archived).toBe(0)
  })
})
