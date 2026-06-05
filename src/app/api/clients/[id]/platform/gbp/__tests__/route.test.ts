import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireDashboardClientAccess: vi.fn(),
  requirePaidClientAccess: vi.fn(),
  listConnections:    vi.fn(),
  getConnectionById:  vi.fn(),
  revokeConnection:   vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
  requirePaidClientAccess: mocks.requireDashboardClientAccess,
}))

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  listConnections:   mocks.listConnections,
  getConnectionById: mocks.getConnectionById,
  revokeConnection:  mocks.revokeConnection,
}))

// ─── Import after mocks ────────────────────────────────────────────────────────

import { GET, DELETE } from '../route'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CLIENT_ID  = 'client-abc'
const CONN_ID    = 'conn-xyz-123'

const CONN_SUMMARY = {
  id:            CONN_ID,
  provider:      'google_gbp',
  display_name:  'OzTop Building Supplies',
  account_id:    'accounts/999',
  location_name: null,
  status:        'active',
  scopes:        ['https://www.googleapis.com/auth/business.manage'],
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
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/gbp`)
}

function makeDeleteRequest(connectionId?: string) {
  const url = new URL(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/gbp`)
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

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id]/platform/gbp', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false, status: 401, error: 'Unauthenticated',
    })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 403 when user has no access to this client', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false, status: 403, error: 'Forbidden',
    })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(403)
  })

  it('returns 200 with connections array on success', async () => {
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connections).toHaveLength(1)
    expect(body.connections[0].id).toBe(CONN_ID)
  })

  it('calls listConnections with the correct clientId', async () => {
    await GET(makeGetRequest(), routeContext())
    expect(mocks.listConnections).toHaveBeenCalledWith(CLIENT_ID)
  })

  it('does NOT include token fields in the response', async () => {
    const res = await GET(makeGetRequest(), routeContext())
    const body = await res.json()
    const conn = body.connections[0]
    expect(conn).not.toHaveProperty('access_token_enc')
    expect(conn).not.toHaveProperty('refresh_token_enc')
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/clients/[id]/platform/gbp', () => {
  it('returns 400 when connectionId is missing', async () => {
    const res = await DELETE(makeDeleteRequest(), routeContext())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/connectionId/)
  })

  it('returns 401 when not authenticated', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({
      ok: false, status: 401, error: 'Unauthenticated',
    })
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(401)
  })

  it('returns 404 when connection does not belong to this client (tenant isolation)', async () => {
    // Simulate connection belonging to a DIFFERENT client
    mocks.getConnectionById.mockResolvedValue({
      ...CONN_ROW,
      client_id: 'other-client',
    })
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(404)
  })

  it('returns 404 when connection is not found', async () => {
    mocks.getConnectionById.mockResolvedValue(null)
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(404)
  })

  it('calls revokeConnection with the correct id on success', async () => {
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    expect(res.status).toBe(200)
    expect(mocks.revokeConnection).toHaveBeenCalledWith(CONN_ID)
  })

  it('returns success:true JSON on success', async () => {
    const res = await DELETE(makeDeleteRequest(CONN_ID), routeContext())
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
