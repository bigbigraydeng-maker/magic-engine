/**
 * Tests for POST /api/clients/[id]/cms/publish-geo-snippet
 *
 * Covers:
 *   1. Auth guard (403)
 *   2. Invalid provider → 400
 *   3. No active GEO directive → 404
 *   4. No CMS connection → 422
 *   5. WordPress happy path → 200 + records deployment
 *   6. Shopify happy path → 200 + records deployment
 *   7. DB error on directive fetch → 500
 *
 * Phase 24.C TDD
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must be before imports of the module under test) ──────────────────

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/cms/connection-store', () => ({
  getWordpressConnection: vi.fn(),
  getShopifyConnection:   vi.fn(),
}))

vi.mock('@/lib/cms/wordpress-client', () => ({
  createWordpressPageDraft: vi.fn(),
  publishWordpressPage:     vi.fn(),
}))

vi.mock('@/lib/cms/shopify-client', () => ({
  createShopifyPageDraft: vi.fn(),
  publishShopifyPage:     vi.fn(),
}))

vi.mock('@/lib/cms/html-sanitizer', () => ({
  prepareCmsContent: vi.fn((html: string) => html),
}))

vi.mock('@/lib/geo/html-generator', () => ({
  generateDirectiveHtml: vi.fn(() => '<div>GEO snippet</div>'),
}))

import { POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getWordpressConnection, getShopifyConnection } from '@/lib/cms/connection-store'
import {
  createWordpressPageDraft,
  publishWordpressPage,
} from '@/lib/cms/wordpress-client'
import {
  createShopifyPageDraft,
  publishShopifyPage,
} from '@/lib/cms/shopify-client'

// ── Typed mocks ───────────────────────────────────────────────────────────────

const mockAuth        = vi.mocked(requireDashboardClientAccess)
const mockFrom        = vi.mocked(supabaseAdmin.from)
const mockGetWp       = vi.mocked(getWordpressConnection)
const mockGetShopify  = vi.mocked(getShopifyConnection)
const mockWpDraft     = vi.mocked(createWordpressPageDraft)
const mockWpPublish   = vi.mocked(publishWordpressPage)
const mockSfDraft     = vi.mocked(createShopifyPageDraft)
const mockSfPublish   = vi.mocked(publishShopifyPage)

// ── Constants ─────────────────────────────────────────────────────────────────

const CLIENT_ID    = 'client-uuid-1234'
const DIRECTIVE_ID = 'directive-uuid-abcd'
const WP_URL       = 'https://example.com/geo-directive'
const SF_URL       = 'https://shop.example.com/pages/geo-directive'

const MOCK_DIRECTIVE = {
  id:             DIRECTIVE_ID,
  client_id:      CLIENT_ID,
  status:         'active',
  directive_text: 'You are browsing a travel agency website.',
  deployed_pages: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/cms/publish-geo-snippet`, {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const CTX = { params: { id: CLIENT_ID } }

/** Utility: mock supabaseAdmin chain for geo_directives with configurable result */
function mockDirectiveFetch(data: unknown, error: { message: string } | null = null) {
  const chainResult = { data, error }
  const chain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(chainResult),
    update:      vi.fn().mockReturnThis(),
  }
  mockFrom.mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
  return chain
}

/** Utility: mock supabaseAdmin for both directive fetch and deployment update */
function mockDirectiveAndUpdate(directiveData: unknown) {
  let callCount = 0
  const fetchChain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: directiveData, error: null }),
    update:      vi.fn().mockReturnThis(),
  }
  const updateChain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: directiveData, error: null }),
    update:      vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    }),
  }
  mockFrom.mockImplementation(() => {
    callCount++
    return (callCount === 1 ? fetchChain : updateChain) as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/cms/publish-geo-snippet', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── 1. Auth guard ────────────────────────────────────────────────────────────

  it('returns 403 when session cannot access client', async () => {
    mockAuth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })

    const res = await POST(makeRequest({ provider: 'wordpress' }), CTX)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Forbidden' })
  })

  // ── 2. Input validation ──────────────────────────────────────────────────────

  it('returns 400 when provider is missing', async () => {
    mockAuth.mockResolvedValue({ ok: true })

    const res = await POST(makeRequest({}), CTX)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_INPUT')
  })

  it('returns 400 when provider is an unknown value', async () => {
    mockAuth.mockResolvedValue({ ok: true })

    const res = await POST(makeRequest({ provider: 'squarespace' }), CTX)
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is invalid JSON', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    const badReq = new NextRequest(
      `http://localhost:3001/api/clients/${CLIENT_ID}/cms/publish-geo-snippet`,
      { method: 'POST', body: 'not-json', headers: { 'Content-Type': 'application/json' } },
    )

    const res = await POST(badReq, CTX)
    expect(res.status).toBe(400)
  })

  // ── 3. No active directive ───────────────────────────────────────────────────

  it('returns 404 when no active GEO directive exists', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    mockDirectiveFetch(null)

    const res = await POST(makeRequest({ provider: 'wordpress' }), CTX)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('NO_DIRECTIVE')
  })

  it('returns 500 when geo_directives fetch errors', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    mockDirectiveFetch(null, { message: 'connection timeout' })

    const res = await POST(makeRequest({ provider: 'wordpress' }), CTX)
    expect(res.status).toBe(500)
  })

  // ── 4. No CMS connection ─────────────────────────────────────────────────────

  it('returns 422 when WordPress connection is missing', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    mockDirectiveFetch(MOCK_DIRECTIVE)
    mockGetWp.mockResolvedValue(null)

    const res = await POST(makeRequest({ provider: 'wordpress' }), CTX)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('NO_CONNECTION')
  })

  it('returns 422 when Shopify connection is not verified', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    mockDirectiveFetch(MOCK_DIRECTIVE)
    mockGetShopify.mockResolvedValue({
      status:    'error',
      shopUrl:   'shop.example.com',
      plainToken: 'tok',
    } as unknown as Awaited<ReturnType<typeof getShopifyConnection>>)

    const res = await POST(makeRequest({ provider: 'shopify' }), CTX)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONNECTION_NOT_VERIFIED')
  })

  // ── 5. WordPress happy path ───────────────────────────────────────────────────

  it('publishes to WordPress and returns published_url', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    mockDirectiveAndUpdate(MOCK_DIRECTIVE)

    mockGetWp.mockResolvedValue({
      status:          'connected',
      siteUrl:         'https://example.com',
      username:        'admin',
      plainAppPassword:'secret',
    } as unknown as Awaited<ReturnType<typeof getWordpressConnection>>)

    mockWpDraft.mockResolvedValue({ platformId: 'wp-123', previewUrl: WP_URL } as unknown as Awaited<ReturnType<typeof createWordpressPageDraft>>)
    mockWpPublish.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ provider: 'wordpress' }), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.published_url).toBe(WP_URL)
    expect(body.provider).toBe('wordpress')
    expect(mockWpDraft).toHaveBeenCalledOnce()
    expect(mockWpPublish).toHaveBeenCalledWith(expect.any(Object), 'wp-123')
  })

  // ── 6. Shopify happy path ─────────────────────────────────────────────────────

  it('publishes to Shopify and returns published_url', async () => {
    mockAuth.mockResolvedValue({ ok: true })
    mockDirectiveAndUpdate(MOCK_DIRECTIVE)

    mockGetShopify.mockResolvedValue({
      status:     'connected',
      shopUrl:    'shop.example.com',
      plainToken: 'tok123',
    } as unknown as Awaited<ReturnType<typeof getShopifyConnection>>)

    mockSfDraft.mockResolvedValue({ platformId: 'sf-999', previewUrl: SF_URL } as unknown as Awaited<ReturnType<typeof createShopifyPageDraft>>)
    mockSfPublish.mockResolvedValue(undefined)

    const res = await POST(makeRequest({ provider: 'shopify' }), CTX)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.published_url).toBe(SF_URL)
    expect(body.provider).toBe('shopify')
    expect(mockSfDraft).toHaveBeenCalledOnce()
    expect(mockSfPublish).toHaveBeenCalledWith(expect.any(Object), 'sf-999')
  })
})
