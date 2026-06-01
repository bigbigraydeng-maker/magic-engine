/**
 * Tests for POST /api/clients/[id]/cms/publish-geo-snippet — P24.C
 *
 * Mocks: requireDashboardClientAccess, supabaseAdmin,
 *        getWordpressConnection, getShopifyConnection,
 *        createWordpressPageDraft, publishWordpressPage,
 *        createShopifyPageDraft, publishShopifyPage,
 *        prepareCmsContent, generateDirectiveHtml
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Auth mock ─────────────────────────────────────────────────────────────────

const mockRequireAccess = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: (...args: unknown[]) => mockRequireAccess(...args),
}))

// ── supabaseAdmin mock — geo_directives queries ───────────────────────────────

const mockGeoSelect = vi.fn()
const mockGeoEq1    = vi.fn()
const mockGeoEq2    = vi.fn()
const mockGeoMaybeSingle = vi.fn()

const mockUpdateEq1 = vi.fn()
const mockUpdateEq2 = vi.fn()

// Tracks whether the next `from('geo_directives')` call is for SELECT or UPDATE
let geoFromCallCount = 0

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'geo_directives') {
        geoFromCallCount++
        if (geoFromCallCount === 1) {
          // First call: .select('*').eq().eq().maybeSingle() — fetch directive
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: mockGeoMaybeSingle,
                })),
              })),
            })),
          }
        }
        // Second call: .select('deployed_pages').eq().eq().maybeSingle() — recordDeployment read
        if (geoFromCallCount === 2) {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { deployed_pages: [] }, error: null }),
                })),
              })),
            })),
          }
        }
        // Third call: .update().eq().eq() — recordDeployment write
        return {
          update: vi.fn(() => ({
            eq: mockUpdateEq1,
          })),
        }
      }
      return {}
    }),
  },
}))

// ── CMS connection mocks ──────────────────────────────────────────────────────

const mockGetWordpress = vi.fn()
const mockGetShopify   = vi.fn()

vi.mock('@/lib/cms/connection-store', () => ({
  getWordpressConnection: (...args: unknown[]) => mockGetWordpress(...args),
  getShopifyConnection:   (...args: unknown[]) => mockGetShopify(...args),
}))

// ── CMS client mocks ──────────────────────────────────────────────────────────

const mockCreateWpPage   = vi.fn()
const mockPublishWpPage  = vi.fn()
const mockCreateShPage   = vi.fn()
const mockPublishShPage  = vi.fn()

vi.mock('@/lib/cms/wordpress-client', () => ({
  createWordpressPageDraft: (...args: unknown[]) => mockCreateWpPage(...args),
  publishWordpressPage:     (...args: unknown[]) => mockPublishWpPage(...args),
}))

vi.mock('@/lib/cms/shopify-client', () => ({
  createShopifyPageDraft: (...args: unknown[]) => mockCreateShPage(...args),
  publishShopifyPage:     (...args: unknown[]) => mockPublishShPage(...args),
}))

// ── HTML helpers ──────────────────────────────────────────────────────────────

vi.mock('@/lib/cms/html-sanitizer', () => ({
  prepareCmsContent: (html: string) => html,
}))

vi.mock('@/lib/geo/html-generator', () => ({
  generateDirectiveHtml: () => '<div data-geo="1">directive</div>',
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CLIENT_ID = 'client-abc'
const DIRECTIVE_ROW = {
  id:        'directive-1',
  client_id: CLIENT_ID,
  status:    'active',
  content:   { brand: 'Test', description: 'desc' },
  deployed_pages: [],
}
const WP_CONN = {
  connected:        true,
  status:           'connected',
  siteUrl:          'https://example.com',
  username:         'admin',
  plainAppPassword: 'abc123xyz456',
}
const SH_CONN = {
  connected:   true,
  status:      'connected',
  shopUrl:     'https://myshop.myshopify.com',
  plainToken:  'shpat_abc123',
}
const WP_DRAFT = { platformId: '42', previewUrl: 'https://example.com/?p=42' }
const SH_DRAFT = { platformId: 'sh-99', previewUrl: 'https://myshop.myshopify.com/pages/geo-directive' }

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/cms/publish-geo-snippet`, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const ROUTE_CTX = { params: { id: CLIENT_ID } }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/clients/[id]/cms/publish-geo-snippet — P24.C', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    geoFromCallCount = 0

    // Default: auth ok
    mockRequireAccess.mockResolvedValue({ ok: true })
    // Default: active directive exists
    mockGeoMaybeSingle.mockResolvedValue({ data: DIRECTIVE_ROW, error: null })
    // Default: connections available
    mockGetWordpress.mockResolvedValue(WP_CONN)
    mockGetShopify.mockResolvedValue(SH_CONN)
    // Default: CMS calls succeed
    mockCreateWpPage.mockResolvedValue(WP_DRAFT)
    mockPublishWpPage.mockResolvedValue(undefined)
    mockCreateShPage.mockResolvedValue(SH_DRAFT)
    mockPublishShPage.mockResolvedValue(undefined)
    // Update eq chain
    mockUpdateEq1.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  })

  // ── Auth ──────────────────────────────────────────────────────────────────

  it('returns 401 when access check fails', async () => {
    mockRequireAccess.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 })

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ provider: 'wordpress' }), ROUTE_CTX)
    expect(res.status).toBe(401)
  })

  // ── Input validation ──────────────────────────────────────────────────────

  it('returns 400 when provider is missing', async () => {
    const { POST } = await import('./route')
    const res  = await POST(makeRequest({}), ROUTE_CTX)
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.code).toBe('INVALID_INPUT')
  })

  it('returns 400 when provider is unknown value', async () => {
    const { POST } = await import('./route')
    const res  = await POST(makeRequest({ provider: 'ghost' }), ROUTE_CTX)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    const { POST } = await import('./route')
    const req = new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/cms/publish-geo-snippet`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    'NOT JSON{',
    })
    const res = await POST(req, ROUTE_CTX)
    expect(res.status).toBe(400)
  })

  // ── No active directive ───────────────────────────────────────────────────

  it('returns 404 when no active GEO directive exists', async () => {
    mockGeoMaybeSingle.mockResolvedValue({ data: null, error: null })

    const { POST } = await import('./route')
    const res  = await POST(makeRequest({ provider: 'wordpress' }), ROUTE_CTX)
    const json = await res.json()
    expect(res.status).toBe(404)
    expect(json.code).toBe('NO_DIRECTIVE')
  })

  // ── WordPress happy path ──────────────────────────────────────────────────

  it('publishes to WordPress and returns published_url', async () => {
    const { POST } = await import('./route')
    const res  = await POST(makeRequest({ provider: 'wordpress' }), ROUTE_CTX)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.published_url).toBe(WP_DRAFT.previewUrl)
    expect(json.provider).toBe('wordpress')
    expect(mockCreateWpPage).toHaveBeenCalledOnce()
    expect(mockPublishWpPage).toHaveBeenCalledOnce()
  })

  it('passes correct WordPress config to client functions', async () => {
    const { POST } = await import('./route')
    await POST(makeRequest({ provider: 'wordpress' }), ROUTE_CTX)

    const [config] = mockCreateWpPage.mock.calls[0] as [{ siteUrl: string; username: string }]
    expect(config.siteUrl).toBe(WP_CONN.siteUrl)
    expect(config.username).toBe(WP_CONN.username)
  })

  // ── Shopify happy path ────────────────────────────────────────────────────

  it('publishes to Shopify and returns published_url', async () => {
    const { POST } = await import('./route')
    const res  = await POST(makeRequest({ provider: 'shopify' }), ROUTE_CTX)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.published_url).toBe(SH_DRAFT.previewUrl)
    expect(json.provider).toBe('shopify')
    expect(mockCreateShPage).toHaveBeenCalledOnce()
    expect(mockPublishShPage).toHaveBeenCalledOnce()
  })

  // ── No connection ─────────────────────────────────────────────────────────

  it('returns 422 NO_CONNECTION when WordPress is not connected', async () => {
    mockGetWordpress.mockResolvedValue(null)

    const { POST } = await import('./route')
    const res  = await POST(makeRequest({ provider: 'wordpress' }), ROUTE_CTX)
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.code).toBe('NO_CONNECTION')
  })

  it('returns 422 CONNECTION_NOT_VERIFIED when Shopify status is not connected', async () => {
    mockGetShopify.mockResolvedValue({ ...SH_CONN, status: 'error', connected: false })

    const { POST } = await import('./route')
    const res  = await POST(makeRequest({ provider: 'shopify' }), ROUTE_CTX)
    const json = await res.json()
    expect(res.status).toBe(422)
    expect(json.code).toBe('CONNECTION_NOT_VERIFIED')
  })

  // ── DB error fetching directive ───────────────────────────────────────────

  it('returns 500 when directive fetch fails', async () => {
    mockGeoMaybeSingle.mockResolvedValue({ data: null, error: { message: 'DB timeout' } })

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ provider: 'wordpress' }), ROUTE_CTX)
    expect(res.status).toBe(500)
  })
})
