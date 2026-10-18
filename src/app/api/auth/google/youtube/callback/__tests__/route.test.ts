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
  vi.stubGlobal('fetch', vi.fn())
})

describe('GET youtube callback', () => {
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
