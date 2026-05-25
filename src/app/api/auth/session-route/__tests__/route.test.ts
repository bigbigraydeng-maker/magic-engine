import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: mocks.getUser },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}))

import { GET } from '../route'

function request(next = '/dashboard') {
  return new NextRequest(`http://localhost:3001/api/auth/session-route?next=${encodeURIComponent(next)}`)
}

function accessRows(rows: Array<{ client_id: string; access_type: string }>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: rows }),
  }
}

describe('/api/auth/session-route', () => {
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS
    delete process.env.ADMIN_EMAIL_DOMAIN
    delete process.env.CLIENT_VIEWERS
    mocks.getUser.mockReset()
    mocks.from.mockReset()
  })

  it('routes admin users to dashboard before portal bindings', async () => {
    process.env.ADMIN_EMAILS = 'admin@magiclab.com'
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'admin@magiclab.com' } } })

    const res = await GET(request('/prospect'))
    const body = await res.json() as { redirect: string }

    expect(body.redirect).toBe('/dashboard')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('preserves dashboard deep links for admin users', async () => {
    process.env.ADMIN_EMAILS = 'admin@magiclab.com'
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'admin@magiclab.com' } } })

    const res = await GET(request('/dashboard/clients'))
    const body = await res.json() as { redirect: string }

    expect(body.redirect).toBe('/dashboard/clients')
  })

  it('still routes non-admin portal users to their portal', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { email: 'client@example.com' } } })
    mocks.from.mockReturnValueOnce(accessRows([
      { client_id: 'client-123', access_type: 'portal' },
    ]))

    const res = await GET(request('/dashboard'))
    const body = await res.json() as { redirect: string }

    expect(body.redirect).toBe('/portal/client-123')
  })
})
