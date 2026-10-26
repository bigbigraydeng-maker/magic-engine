import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireOnboardingClientAccess: vi.fn(),
  rows: [] as Array<{ anchor: string; status: string; config: unknown; connected_at: string | null }>,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireOnboardingClientAccess: mocks.requireOnboardingClientAccess,
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockImplementation(() => Promise.resolve({ data: mocks.rows, error: null }))
  return { supabaseAdmin: { from: vi.fn().mockReturnValue(chain) } }
})

import { GET } from '../route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireOnboardingClientAccess.mockResolvedValue({ ok: true, user: { email: 'a@test.com' }, role: 'admin', allowedClientId: null })
  mocks.rows = []
})

describe('GET /api/clients/[id]/connectors/status', () => {
  it('does not present an old checkbox marker as a real social authorisation', async () => {
    mocks.rows = [{ anchor: 'social', status: 'connected', config: null, connected_at: null }]
    const res = await GET(new NextRequest('http://localhost/api/clients/c1/connectors/status'), { params: { id: 'c1' } })
    const row = (await res.json()).connectors.find((value: { anchor: string }) => value.anchor === 'social')
    expect(row.status).toBe('partial')
    expect(row.statusLabel).toBe('按平台核验授权')
  })
  it('returns no publer connector and no Publer wording anywhere in the catalogue', async () => {
    // A leftover legacy row must not resurrect the connector in the response.
    mocks.rows = [{ anchor: 'publer', status: 'connected', config: { publer_account_ids: {} }, connected_at: null }]
    const res = await GET(
      new NextRequest('http://localhost:3001/api/clients/c1/connectors/status'),
      { params: { id: 'c1' } },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as { connectors: Array<{ anchor: string }> }

    expect(body.connectors.map(c => c.anchor)).not.toContain('publer')
    expect(body.connectors.map(c => c.anchor)).toContain('social')
    expect(JSON.stringify(body).toLowerCase()).not.toContain('publer')
  })
})
