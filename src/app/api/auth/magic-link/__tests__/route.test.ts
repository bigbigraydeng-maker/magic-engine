import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateLink: vi.fn(),
  send: vi.fn(),
  permissions: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { generateLink: mocks.generateLink } },
  },
}))
vi.mock('@/lib/auth/whitelist', () => ({ getUserPermissions: mocks.permissions }))
vi.mock('@/lib/email/sender', () => ({ meMailFrom: () => 'Magic Engine <login@example.com>' }))
vi.mock('resend', () => ({ Resend: class { emails = { send: mocks.send } } }))

import { POST } from '../route'

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
  it('is retired with a no-store 410 and sends no email', async () => {
    const response = await POST()

    expect(response.status).toBe(410)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.generateLink).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('makes no Auth calls even for a known admin email', async () => {
    const response = await POST()

    expect(response.status).toBe(410)
    expect(mocks.permissions).not.toHaveBeenCalled()
    expect(mocks.generateLink).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
