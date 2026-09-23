import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  send: vi.fn(),
  permissions: vi.fn(),
  portalRows: [] as Array<{ id: string }>,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: mocks.portalRows }) }) }) }),
    auth: { admin: { generateLink: mocks.generateLink } },
  },
}))
vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions: mocks.permissions }))
vi.mock('@/lib/email/sender', () => ({ meMailFrom: () => 'Magic Engine <login@example.com>' }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))

import { POST } from '../route'

const NEXT = '/meta-ads-ai/a1000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APP_URL', 'https://app.magicengine.com.au')
  vi.stubEnv('RESEND_API_KEY', 're_test')
  mocks.permissions.mockReturnValue({ role: 'admin' })
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: 'hashed-secret', verification_type: 'magiclink' } },
    error: null,
  })
  mocks.send.mockResolvedValue({ error: null })
})

describe('POST /api/auth/magic-link', () => {
  it('emails a scanner-safe Magic Engine confirmation page that preserves next', async () => {
    const request = new NextRequest('https://app.magicengine.com.au/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'hello@magicengine.cloud',
        redirectTo: `https://app.magicengine.com.au/auth/implicit-callback?next=${encodeURIComponent(NEXT)}`,
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mocks.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: 'magiclink' }))
    expect(mocks.send).toHaveBeenCalledOnce()
    const mail = mocks.send.mock.calls[0][0]
    expect(mail.text).toContain('/auth/magic-landing?')
    expect(mail.text).toContain('hashed-secret')
    expect(mail.text).toContain(encodeURIComponent(NEXT))
    expect(mail.text).not.toContain('/auth/v1/verify')
  })

  it('keeps the generic response and sends nothing for an unknown email', async () => {
    mocks.permissions.mockReturnValue(null)
    const request = new NextRequest('https://app.magicengine.com.au/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'unknown@example.com',
        redirectTo: `https://app.magicengine.com.au/auth/implicit-callback?next=${encodeURIComponent(NEXT)}`,
      }),
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mocks.generateLink).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
