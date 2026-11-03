/**
 * The boost-post endpoint is retired: it created an ACTIVE paid campaign in a
 * single call, bypassing draft -> paused -> approval. These tests pin the
 * retirement contract — auth still gates the response, and the route never
 * touches the network or parses the body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireDashboardClientAccess = vi.fn()

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: (...a: unknown[]) => requireDashboardClientAccess(...a),
}))

import { POST } from '../route'

const fetchSpy = vi.fn()

const req = (body: string) =>
  new NextRequest('http://localhost/api/clients/c1/meta-ads/boost-post', {
    method: 'POST',
    body,
  })

const VALID_BODY = JSON.stringify({
  post_id: '1_2',
  page_id: '1',
  daily_budget_aud: 20,
  duration_days: 7,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchSpy)
  requireDashboardClientAccess.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /meta-ads/boost-post — retired', () => {
  it('auth ok → 410 with the retirement code, and never calls fetch', async () => {
    const res = await POST(req(VALID_BODY), { params: { id: 'c1' } })
    expect(res.status).toBe(410)

    const json = await res.json()
    expect(json.code).toBe('boost_post_retired')
    expect(json.error).toContain('这个入口已停用')

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('auth not ok → passes through the auth status, and never calls fetch', async () => {
    requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' })

    const res = await POST(req(VALID_BODY), { params: { id: 'c1' } })
    expect(res.status).toBe(403)

    const json = await res.json()
    expect(json.error).toBe('forbidden')

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('auth ok but invalid JSON body → still 410 (the route never parses the body)', async () => {
    const res = await POST(req('not json'), { params: { id: 'c1' } })
    expect(res.status).toBe(410)

    const json = await res.json()
    expect(json.code).toBe('boost_post_retired')

    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('auth is checked with the route param id', async () => {
    await POST(req(VALID_BODY), { params: { id: 'c1' } })
    expect(requireDashboardClientAccess).toHaveBeenCalledWith('c1')
  })
})
