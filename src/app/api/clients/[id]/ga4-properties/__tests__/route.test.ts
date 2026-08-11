import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireOnboardingClientAccess: vi.fn(),
  from:              vi.fn(),
  getValidToken:     vi.fn(),
  listGa4Properties: vi.fn(),
  setGa4Property:    vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: mocks.requireOnboardingClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()
  return { ...actual, getValidToken: mocks.getValidToken }
})

vi.mock('@/lib/ga4/admin', () => ({
  listGa4Properties: mocks.listGa4Properties,
}))

vi.mock('@/lib/ga4/property', () => ({
  setGa4Property: mocks.setGa4Property,
}))

import { GET, PATCH } from '../route'
import { PlatformConnectionNotFoundError } from '@/lib/platform-oauth/token-manager'

const CLIENT_ID = 'client-abc'

function routeContext() {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function chainResolvingMaybeSingle(data: unknown) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'limit'].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain) })
  chain.maybeSingle = vi.fn().mockResolvedValue({ data })
  return chain
}

function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/ga4-properties`)
}

function makePatchRequest(body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/ga4-properties`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireOnboardingClientAccess.mockResolvedValue(adminAccess())
})

describe('GET /api/clients/[id]/ga4-properties', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns connected:false when the client has no active GA4 connection', async () => {
    mocks.from.mockReturnValue(chainResolvingMaybeSingle(null))
    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body).toEqual({ connected: false, current: null, options: [] })
  })

  it('returns needs_reauth when the connection cannot be found for a token', async () => {
    mocks.from.mockReturnValue(chainResolvingMaybeSingle({ account_id: 'properties/1' }))
    mocks.getValidToken.mockRejectedValue(new PlatformConnectionNotFoundError(CLIENT_ID, 'google_ga4'))

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body.connected).toBe(true)
    expect(body.error).toBe('needs_reauth')
    expect(body.options).toEqual([])
  })

  it('returns google_unavailable when the token refresh throws something other than "not found"', async () => {
    mocks.from.mockReturnValue(chainResolvingMaybeSingle({ account_id: 'properties/1' }))
    mocks.getValidToken.mockRejectedValue(new Error('refresh failed'))

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body.error).toBe('google_unavailable')
  })

  it('returns google_unavailable when listGa4Properties itself fails (distinct from "zero properties")', async () => {
    mocks.from.mockReturnValue(chainResolvingMaybeSingle({ account_id: 'properties/1' }))
    mocks.getValidToken.mockResolvedValue('access-token')
    mocks.listGa4Properties.mockResolvedValue({ ok: false, reason: 'api_failed' })

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body.error).toBe('google_unavailable')
  })

  it('returns the current selection + available options on success', async () => {
    mocks.from.mockReturnValue(chainResolvingMaybeSingle({ account_id: 'properties/1' }))
    mocks.getValidToken.mockResolvedValue('access-token')
    mocks.listGa4Properties.mockResolvedValue({
      ok: true,
      properties: [
        { property: 'properties/1', displayName: 'Site A' },
        { property: 'properties/2', displayName: 'Site B' },
      ],
    })

    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    expect(body).toEqual({
      connected: true,
      current: 'properties/1',
      options: [
        { property: 'properties/1', display_name: 'Site A' },
        { property: 'properties/2', display_name: 'Site B' },
      ],
    })
  })
})

describe('PATCH /api/clients/[id]/ga4-properties', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireOnboardingClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await PATCH(makePatchRequest({ property: 'properties/1' }), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 400 when `property` is missing', async () => {
    const res = await PATCH(makePatchRequest({}), routeContext())
    expect(res.status).toBe(400)
  })

  it('returns 400 with a plain-language message when setGa4Property reports not_connected', async () => {
    mocks.setGa4Property.mockResolvedValue({ ok: false, reason: 'not_connected' })
    const res = await PATCH(makePatchRequest({ property: 'properties/1' }), routeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.reason).toBe('not_connected')
  })

  it('returns success:true on a valid bind', async () => {
    mocks.setGa4Property.mockResolvedValue({ ok: true })
    const res = await PATCH(makePatchRequest({ property: 'properties/1' }), routeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, property: 'properties/1' })
  })
})
