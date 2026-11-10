import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  resolveLiteClientActor: vi.fn(),
  requireGlobalAdmin: vi.fn(),
  loadSocialReadbackPanel: vi.fn(),
}))

vi.mock('@/lib/social/story-lite/route-support', () => ({
  resolveLiteClientActor: mocks.resolveLiteClientActor,
}))

vi.mock('@/lib/social/story-lite/service', () => ({
  requireGlobalAdmin: mocks.requireGlobalAdmin,
}))

vi.mock('@/lib/social/story-lite/ports', () => ({
  createLiteServicePorts: () => ({}),
}))

vi.mock('@/lib/social/social-readback-load', () => ({
  loadSocialReadbackPanel: mocks.loadSocialReadbackPanel,
  defaultReadbackWindow: () => ({
    since: new Date('2026-10-01T00:00:00.000Z'),
    until: new Date('2026-11-03T00:00:00.000Z'),
  }),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { GET } from './route'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('GET /api/clients/[id]/social-readback', () => {
  beforeEach(() => {
    mocks.resolveLiteClientActor.mockReset()
    mocks.requireGlobalAdmin.mockReset()
    mocks.loadSocialReadbackPanel.mockReset()
    mocks.requireGlobalAdmin.mockReturnValue({ ok: true, value: true })
  })

  it('returns 403 when actor resolution fails', async () => {
    mocks.resolveLiteClientActor.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    })
    const res = await GET(new Request('http://test/api'), { params: { id: CLIENT } })
    expect(res.status).toBe(403)
  })

  it('returns panel payload for global admin', async () => {
    mocks.resolveLiteClientActor.mockResolvedValue({
      ok: true,
      actor: { id: 'u1', email: 'admin@example.com', allowedClientId: null },
    })
    mocks.loadSocialReadbackPanel.mockResolvedValue({
      client_id: CLIENT,
      since: '2026-10-01T00:00:00.000Z',
      until: '2026-11-03T00:00:00.000Z',
      limit: 20,
      generated_at: '2026-11-03T00:00:00.000Z',
      items: [],
    })

    const res = await GET(new Request('http://test/api'), { params: { id: CLIENT } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; panel: { client_id: string } }
    expect(body.success).toBe(true)
    expect(body.panel.client_id).toBe(CLIENT)
    expect(mocks.loadSocialReadbackPanel).toHaveBeenCalledOnce()
  })

  it('rejects inverted since/until window', async () => {
    mocks.resolveLiteClientActor.mockResolvedValue({
      ok: true,
      actor: { id: 'u1', email: 'admin@example.com', allowedClientId: null },
    })
    const res = await GET(
      new Request(`http://test/api?since=2026-11-10T00:00:00.000Z&until=2026-11-01T00:00:00.000Z`),
      { params: { id: CLIENT } },
    )
    expect(res.status).toBe(400)
  })
})
