/**
 * /api/clients/[id]/platform/google-ads route — GET tests
 *
 * Pins the contract the settings panel relies on:
 *   - 401/403 from access-control bubble up unchanged.
 *   - Picks the google_ads provider out of a mixed connection list.
 *   - Returns `null` (not 404) when the client has no google_ads connection.
 *   - Filters out other providers cleanly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  listConnections:         vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  listConnections: mocks.listConnections,
}))

import { GET } from '../route'

const CLIENT_ID = 'client-abc-google-ads'

const GBP_SUMMARY = {
  id: 'gbp-conn', provider: 'google_gbp', display_name: 'GBP',
  account_id: 'accounts/123', location_name: null, status: 'active' as const,
  scopes: [], last_synced_at: null, error_message: null,
}
const GA_SUMMARY = {
  id: 'ga-conn', provider: 'google_ads', display_name: 'CTS Ads',
  account_id: '1234567890', location_name: null, status: 'active' as const,
  scopes: [], last_synced_at: '2026-06-17T03:00:00Z', error_message: null,
}

function routeContext() { return { params: { id: CLIENT_ID } } }
function makeGetRequest() {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/platform/google-ads`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePaidClientAccess.mockResolvedValue({
    ok: true, user: { email: 'admin@test.com' }, role: 'admin', allowedClientId: null,
  })
  mocks.listConnections.mockResolvedValue([])
})

describe('GET /api/clients/[id]/platform/google-ads', () => {
  it('bubbles up access-control errors verbatim', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' })
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
    expect(mocks.listConnections).not.toHaveBeenCalled()
  })

  it('returns { connection: null } when no google_ads connection exists', async () => {
    mocks.listConnections.mockResolvedValue([])
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ connection: null })
  })

  it('returns { connection: null } when client has connections but none for google_ads', async () => {
    // Mixed: GBP only — google_ads must NOT be falsely surfaced.
    mocks.listConnections.mockResolvedValue([GBP_SUMMARY])
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ connection: null })
  })

  it('picks the google_ads row out of a mixed connection list', async () => {
    mocks.listConnections.mockResolvedValue([GBP_SUMMARY, GA_SUMMARY])
    const res = await GET(makeGetRequest(), routeContext())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ connection: GA_SUMMARY })
  })

  it('passes the route [id] param straight through to listConnections', async () => {
    mocks.listConnections.mockResolvedValue([])
    await GET(makeGetRequest(), routeContext())
    expect(mocks.listConnections).toHaveBeenCalledWith(CLIENT_ID)
  })
})
