import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireGlobalAdmin: vi.fn(), getClientChannelId: vi.fn(), persist: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: mocks.requireGlobalAdmin }))
vi.mock('@/lib/youtube-publish/store', () => ({ getClientChannelId: mocks.getClientChannelId }))
vi.mock('@/lib/youtube-publish/oauth', async (orig) => ({
  ...(await orig<typeof import('@/lib/youtube-publish/oauth')>()),
  persistYoutubeConnection: mocks.persist,
}))

import { GET } from '../route'
import { YOUTUBE_STATE_COOKIE } from '@/lib/youtube-publish/oauth'

const CONFIGURED = 'UCmJJDRx88y0IuZXJJQuGNFw'
const FORGED = 'UCattackerAttackerAttack1'

function req(channel: string) {
  return new NextRequest('http://localhost/cb?code=c&state=n', {
    headers: { cookie: `${YOUTUBE_STATE_COOKIE}=n:c1:${channel}` },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireGlobalAdmin.mockResolvedValue({ ok: true })
  mocks.getClientChannelId.mockResolvedValue(CONFIGURED)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
  vi.stubGlobal('fetch', vi.fn())
})

describe('GET youtube callback', () => {
  it('returns a trusted cancellation to client settings and clears state without exchanging tokens', async () => {
    const response = await GET(new NextRequest('https://example.test/cb?error=access_denied&state=n', {
      headers: { cookie: `${YOUTUBE_STATE_COOKIE}=n:c1:${CONFIGURED}` },
    }))
    expect(response.headers.get('location')).toContain('/clients/c1/settings?youtube=error&reason=authorization_cancelled')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('does not use a forged cancellation state to redirect into a customer', async () => {
    const response = await GET(new NextRequest('https://example.test/cb?error=access_denied&state=forged', {
      headers: { cookie: `${YOUTUBE_STATE_COOKIE}=n:c1:${CONFIGURED}` },
    }))
    expect(response.status).toBe(400)
    expect(mocks.requireGlobalAdmin).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refuses non-admins before any token exchange', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await GET(req(CONFIGURED))).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('a forged cookie channel that differs from client configuration is refused', async () => {
    expect((await GET(req(FORGED))).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
})
