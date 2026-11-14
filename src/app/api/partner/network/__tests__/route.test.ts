import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as auth from '@/lib/distributor/portal-auth'

const h = vi.hoisted(() => ({ session: null as string | null, view: { displayName: '小王', ready: false } }))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/distributor/mn/portal', () => ({
  loadNetworkShell: vi.fn(async () => h.view),
}))
vi.mock('@/lib/distributor/portal-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/distributor/portal-auth')>()
  return { ...real, resolveSession: vi.fn(async (token: string | null) => (token ? h.session : null)) }
})

import { GET } from '../route'

const TOKEN = 'A'.repeat(43)

beforeEach(() => {
  h.session = null
  vi.clearAllMocks()
})

describe('GET /api/partner/network', () => {
  it('rejects a request without the portal cookie', async () => {
    const response = await GET(new NextRequest('https://app.test/api/partner/network'))
    expect(response.status).toBe(401)
  })

  it('returns the shell for a live portal session and does not require the MU tables', async () => {
    h.session = 'd1'
    const response = await GET(new NextRequest('https://app.test/api/partner/network', {
      headers: { cookie: `${auth.PORTAL_COOKIE}=${TOKEN}` },
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(h.view)
  })
})
