import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Mirrors platform/gbp/__tests__/route.test.ts — same provider-isolation
// contract, this time for google_gsc.

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  listConnections:    vi.fn(),
  getConnectionById:  vi.fn(),
  revokeConnection:   vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
  requireOnboardingClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  listConnections:   mocks.listConnections,
  getConnectionById: mocks.getConnectionById,
  revokeConnection:  mocks.revokeConnection,
}))

import { GET, DELETE } from '../route'

const CLIENT_ID = 'client-abc'
const CONN_ID   = 'conn-gsc-1'

const CONN_SUMMARY = {
  id:            CONN_ID,
  provider:      'google_gsc',
  display_name:  'owner@example.com',
  account_id:    'owner@example.com',
  location_name: null,
  status:        'active',
  scopes:        ['https://www.googleapis.com/auth/webmasters.readonly'],
  last_synced_at: null,
  error_message:  null,
}

const CONN_ROW = {
  ...CONN_SUMMARY,
  client_id:         CLIENT_ID,
  access_token_enc:  'enc:access',
  refresh_token_enc: 'enc:refresh',
  token_expiry:      '2026-07-01T00:00:00Z',
  created_at:        '2026-06-03T00:00:00Z',
  updated_at:        '2026-06-03T00:00:00Z',
}

function routeContext() {
  return { params: { id: CLIENT_ID } }
}

function adminAccess() {
  return { ok: true as const, user: { email: 'admin@test.com' }, role: 'admin' as const, allowedClientId: null }
}

function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/gsc`)
}

function makeDeleteRequest(connectionId?: string) {
  const url = new URL(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/gsc`)
  if (connectionId) url.searchParams.set('connectionId', connectionId)
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireDashboardClientAccess.mockResolvedValue(adminAccess())
  mocks.listConnections.mockResolvedValue([CONN_SUMMARY])
  mocks.getConnectionById.mockResolvedValue(CONN_ROW)
  mocks.revokeConnection.mockResolvedValue(undefined)
})

describe('GET /api/clients/[id]/platform/gsc', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 200 with connections array on success', async () => {
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0].provider).toBe('google_gsc')
  })
})

describe('provider isolation — only google_gsc, 绝不碰别的平台', () => {
  const GBP_SUMMARY = { ...CONN_SUMMARY, id: 'conn-gbp-1', provider: 'google_gbp' }

  it('GET does not return a GBP connection even if listConnections includes one', async () => {
    mocks.listConnections.mockResolvedValue([GBP_SUMMARY, CONN_SUMMARY])
    const body = await (await GET(makeGetRequest(), routeContext())).json()
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0].provider).toBe('google_gsc')
  })

  it('returns empty when the client has no GSC row, even with other providers present', async () => {
    mocks.listConnections.mockResolvedValue([GBP_SUMMARY])
    const body = await (await GET(makeGetRequest(), routeContext())).json()
    expect(body.connections).toEqual([])
  })

  it('DELETE refuses to remove a GBP connection through the GSC route', async () => {
    mocks.getConnectionById.mockResolvedValue({ ...CONN_ROW, id: 'conn-gbp-1', provider: 'google_gbp' })
    const res = await DELETE(makeDeleteRequest('conn-gbp-1'), routeContext())
    expect(res.status).toBe(404)
    expect(mocks.revokeConnection).not.toHaveBeenCalled()
  })

  it('DELETE succeeds for a genuine google_gsc connection belonging to this client', async () => {
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(200)
    expect(mocks.revokeConnection).toHaveBeenCalledWith(CONN_ID)
  })

  it('DELETE returns 404 (tenant isolation) when the connection belongs to a different client', async () => {
    mocks.getConnectionById.mockResolvedValue({ ...CONN_ROW, client_id: 'other-client' })
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(404)
  })
})
