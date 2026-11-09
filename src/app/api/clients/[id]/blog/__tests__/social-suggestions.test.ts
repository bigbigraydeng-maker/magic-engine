/**
 * Tests for POST /api/clients/[id]/blog/[postId]/social-suggestions
 * Reference: ROADMAP.md P8.2.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — declared before imports (hoisting rule)
// ---------------------------------------------------------------------------

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockEq = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'blog_posts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: mockEq,
          single: mockSingle,
        }
      }
      // content_strategy_items
      return {
        insert: mockInsert,
        select: mockSelect,
      }
    }),
  },
}))

// 2026-08-05 (狄仁杰复审): the route now runs requireDashboardClientAccess
// (cookie session) BEFORE the bearer-token check. Default to an admin session
// so the remaining tests exercise the bearer gate + business logic.
const mockRequireDashboardClientAccess = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: (...args: unknown[]) => mockRequireDashboardClientAccess(...args),
  requirePaidClientAccess:      (...args: unknown[]) => mockRequireDashboardClientAccess(...args),
}))

const mockMessagesCreate = vi.fn()

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'claude-sonnet-test',
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from '../[postId]/social-suggestions/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000'

function makeRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest(`${BASE_URL}${path}`, {
    method: options.method ?? 'POST',
    headers: options.headers ?? {},
  })
}

function makeAuthedRequest(path: string): NextRequest {
  return makeRequest(path, {
    headers: { Authorization: `Bearer ${process.env.INTERNAL_API_KEY}` },
  })
}

const PARAMS = { id: 'client-abc', postId: 'post-xyz' }

const MOCK_POST = {
  id: 'post-xyz',
  title: 'Top 10 Auckland Cafes',
  primary_keyword: 'auckland cafes',
  client_id: 'client-abc',
}

const MOCK_ANTHROPIC_RESPONSE = [
  {
    platform: 'facebook',
    proposed_title: 'Discover Auckland\'s Best Cafes',
    rationale: 'Great for community engagement.',
    content_angle: 'Highlight local favourites.',
  },
  {
    platform: 'instagram',
    proposed_title: 'Auckland cafe vibes ☕',
    rationale: 'Visual, punchy hook for Insta.',
    content_angle: 'Use flat-lay coffee imagery.',
  },
  {
    platform: 'linkedin',
    proposed_title: 'Why Auckland\'s Cafe Culture Drives Business',
    rationale: 'Professional B2B angle for meetings.',
    content_angle: 'Position cafes as productive work venues.',
  },
]

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  process.env.INTERNAL_API_KEY = 'test-internal-key'
  vi.clearAllMocks()
  mockRequireDashboardClientAccess.mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    allowedClientId: null,
  })
})

// ---------------------------------------------------------------------------
// Test: successful generation
// ---------------------------------------------------------------------------

describe('POST /social-suggestions — success', () => {
  it('calls Anthropic, inserts 3 strategy items, returns success:true', async () => {
    // blog_posts query chain: .select().eq().eq() returns { data, error } via single()
    mockEq.mockReturnThis()
    mockSingle.mockResolvedValue({ data: MOCK_POST, error: null })

    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(MOCK_ANTHROPIC_RESPONSE) }],
    })

    const insertedRows = MOCK_ANTHROPIC_RESPONSE.map((s, i) => ({
      id: `item-${i}`,
      action_type: 'social_content',
      proposed_title: s.proposed_title,
    }))

    mockInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: insertedRows, error: null }),
    })

    const req = makeAuthedRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions')
    const res = await POST(req, { params: PARAMS })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.items).toHaveLength(3)
    expect(mockMessagesCreate).toHaveBeenCalledOnce()
    expect(mockInsert).toHaveBeenCalledOnce()

    // Verify rationale prefix encoding
    const insertArg = mockInsert.mock.calls[0][0] as Array<{ rationale: string; action_type: string }>
    expect(insertArg[0].rationale).toMatch(/^FACEBOOK:/)
    expect(insertArg[1].rationale).toMatch(/^INSTAGRAM:/)
    expect(insertArg[2].rationale).toMatch(/^LINKEDIN:/)
    expect(insertArg.every(r => r.action_type === 'social_content')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test: blog post not found
// ---------------------------------------------------------------------------

describe('POST /social-suggestions — blog not found', () => {
  it('returns 404 when blog post does not exist', async () => {
    mockEq.mockReturnThis()
    mockSingle.mockResolvedValue({ data: null, error: null })

    const req = makeAuthedRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions')
    const res = await POST(req, { params: PARAMS })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.success).toBe(false)
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test: client_id mismatch → 403
// ---------------------------------------------------------------------------

describe('POST /social-suggestions — client mismatch', () => {
  it('returns 403 when blog post belongs to a different client', async () => {
    mockEq.mockReturnThis()
    mockSingle.mockResolvedValue({
      data: { ...MOCK_POST, client_id: 'other-client' },
      error: null,
    })

    const req = makeAuthedRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions')
    const res = await POST(req, { params: PARAMS })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).toBe(false)
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test: Anthropic returns non-JSON → 500
// ---------------------------------------------------------------------------

describe('POST /social-suggestions — AI parse failure', () => {
  it('returns 500 when Anthropic returns non-JSON text', async () => {
    mockEq.mockReturnThis()
    mockSingle.mockResolvedValue({ data: MOCK_POST, error: null })

    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Sorry, I cannot help with that right now.' }],
    })

    const req = makeAuthedRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions')
    const res = await POST(req, { params: PARAMS })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test: unauthenticated request → 401
// ---------------------------------------------------------------------------

describe('POST /social-suggestions — authentication', () => {
  it('returns the session gate status before checking the bearer token', async () => {
    mockRequireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const req = makeAuthedRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions')
    const res = await POST(req, { params: PARAMS })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe('Forbidden')
    expect(mockRequireDashboardClientAccess).toHaveBeenCalledWith('client-abc')
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is missing', async () => {
    const req = makeRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions')
    const res = await POST(req, { params: PARAMS })
    expect(res.status).toBe(401)
  })

  it('returns 401 when token is wrong', async () => {
    const req = makeRequest('/api/clients/client-abc/blog/post-xyz/social-suggestions', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await POST(req, { params: PARAMS })
    expect(res.status).toBe(401)
  })
})
