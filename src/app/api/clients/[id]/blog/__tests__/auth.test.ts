/**
 * TDD — RED Phase
 * Tests for Bearer token authentication on blog API routes.
 *
 * Covers CRITICAL-1: API routes have no authentication.
 * All blog endpoints must reject requests without a valid session (requireDashboardClientAccess).
 *
 * Reference: Phase 7.3 security fix
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports (hoisting rule)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('@/lib/blog/generator', () => ({
  generateBlogPost: vi.fn(),
}))

vi.mock('@/lib/blog/content-auditor', () => ({
  auditExistingContent: vi.fn(),
}))

vi.mock('@/lib/blog/topic-selector', () => ({
  getWeakSpotOpportunities: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET as blogListGET, POST as blogListPOST } from '../route'
import { GET as opportunitiesGET } from '../opportunities/route'
import { GET as postDetailGET, PATCH as postDetailPATCH, DELETE as postDetailDELETE } from '../[postId]/route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const mockAccess = vi.mocked(requireDashboardClientAccess)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000'

function makeRequest(
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {}
): NextRequest {
  const url = `${BASE_URL}${path}`
  const initOptions: Record<string, unknown> = {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
  }
  if (options.body) {
    initOptions.body = JSON.stringify(options.body)
  }
  return new NextRequest(url, initOptions as any)
}

function makeUnauthRequest(
  path: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  return makeRequest(path, options)
}

function makeAuthedRequest(
  path: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  return makeRequest(path, options)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Default: deny access (simulates no session)
  mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
})

function allowAccess() {
  mockAccess.mockResolvedValue({ ok: true, user: { email: 'test@test.com' } as never, role: 'admin', allowedClientId: null })
}

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/[id]/blog
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog — authentication', () => {
  const params = { id: 'client-1' }

  it('returns 401 when no session', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('returns 401 when session is invalid', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('allows request with valid session', async () => {
    allowAccess()
    const req = makeAuthedRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: POST /api/clients/[id]/blog
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/blog — authentication', () => {
  const params = { id: 'client-1' }

  it('returns 401 when no session', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog', {
      method: 'POST',
      body: { topic: 'test topic', mode: 'geo_only' },
    })
    const res = await blogListPOST(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows POST with valid session', async () => {
    allowAccess()
    const req = makeAuthedRequest('/api/clients/client-1/blog', {
      method: 'POST',
      body: { topic: 'china tours nz', mode: 'geo_only' },
    })
    const res = await blogListPOST(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/[id]/blog/opportunities
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog/opportunities — authentication', () => {
  const params = { id: 'client-1' }

  it('returns 401 when no session', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog/opportunities')
    const res = await opportunitiesGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows request with valid session', async () => {
    allowAccess()
    const req = makeAuthedRequest('/api/clients/client-1/blog/opportunities')
    const res = await opportunitiesGET(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/[id]/blog/[postId]
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/blog/[postId] — authentication', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 401 when no session', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog/post-abc')
    const res = await postDetailGET(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows request with valid session', async () => {
    allowAccess()
    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc')
    const res = await postDetailGET(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: PATCH /api/clients/[id]/blog/[postId]
// ---------------------------------------------------------------------------

describe('PATCH /api/clients/[id]/blog/[postId] — authentication', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 401 when no session', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog/post-abc', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    const res = await postDetailPATCH(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows PATCH with valid session', async () => {
    allowAccess()
    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    const res = await postDetailPATCH(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Tests: DELETE /api/clients/[id]/blog/[postId]
// ---------------------------------------------------------------------------

describe('DELETE /api/clients/[id]/blog/[postId] — authentication', () => {
  const params = { id: 'client-1', postId: 'post-abc' }

  it('returns 401 when no session', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog/post-abc', { method: 'DELETE' })
    const res = await postDetailDELETE(req, { params })
    expect(res.status).toBe(401)
  })

  it('allows DELETE with valid session', async () => {
    allowAccess()
    const req = makeAuthedRequest('/api/clients/client-1/blog/post-abc', { method: 'DELETE' })
    const res = await postDetailDELETE(req, { params })
    expect(res.status).not.toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Session-based auth: unauthenticated requests are always rejected
// ---------------------------------------------------------------------------

describe('authentication — session-based (no bearer token)', () => {
  const params = { id: 'client-1' }

  it('returns 401 when session is absent', async () => {
    const req = makeUnauthRequest('/api/clients/client-1/blog')
    const res = await blogListGET(req, { params })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })
})
