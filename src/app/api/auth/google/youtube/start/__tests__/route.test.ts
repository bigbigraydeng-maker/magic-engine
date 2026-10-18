import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireGlobalAdmin: vi.fn(), getClientChannelId: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: mocks.requireGlobalAdmin }))
vi.mock('@/lib/youtube-publish/store', () => ({ getClientChannelId: mocks.getClientChannelId }))

import { GET } from '../route'
import { YOUTUBE_STATE_COOKIE } from '@/lib/youtube-publish/oauth'

const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'

function req(qs: string) {
  return new NextRequest(`http://localhost:3001/api/auth/google/youtube/start${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GOOGLE_CLIENT_ID = 'goog'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  mocks.requireGlobalAdmin.mockResolvedValue({ ok: true })
  mocks.getClientChannelId.mockResolvedValue(CHANNEL)
})

describe('GET /api/auth/google/youtube/start', () => {
  it('400 without clientId', async () => {
    expect((await GET(req(''))).status).toBe(400)
  })

  it('passes through an auth failure (internal admins only)', async () => {
    mocks.requireGlobalAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await GET(req('?clientId=c1'))).status).toBe(403)
  })

  it('409 when the client has no channel configured', async () => {
    mocks.getClientChannelId.mockResolvedValue(null)
    expect((await GET(req('?clientId=c1'))).status).toBe(409)
  })

  it('ignores a channelId in the query: the channel comes from client configuration', async () => {
    const res = await GET(req('?clientId=c1&channelId=UCattackerAttackerAttack'))
    expect(res.headers.get('set-cookie') ?? '').toContain(`:c1:${CHANNEL}`)
    expect(res.headers.get('set-cookie') ?? '').not.toContain('UCattacker')
  })

  it('redirects to Google with youtube scopes and sets the state cookie carrying the channel', async () => {
    const res = await GET(req('?clientId=c1'))
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location') ?? '')
    expect(loc.searchParams.get('scope')).toContain('youtube.upload')
    expect(loc.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/google/youtube/callback')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${YOUTUBE_STATE_COOKIE}=`)
    expect(cookie).toContain(`:c1:${CHANNEL}`)
  })
})
