import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireDashboardClientAccess,
}))

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
  mocks.requireDashboardClientAccess.mockResolvedValue({ ok: true })
})

describe('GET /api/auth/google/youtube/start', () => {
  it('400 without clientId', async () => {
    expect((await GET(req(`?channelId=${CHANNEL}`))).status).toBe(400)
  })

  it('400 for a handle instead of a channel id', async () => {
    expect((await GET(req('?clientId=c1&channelId=@CTSToursNZ2027'))).status).toBe(400)
  })

  it('passes through an auth failure', async () => {
    mocks.requireDashboardClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthenticated' })
    expect((await GET(req(`?clientId=c1&channelId=${CHANNEL}`))).status).toBe(401)
  })

  it('redirects to Google with youtube scopes and sets the state cookie carrying the channel', async () => {
    const res = await GET(req(`?clientId=c1&channelId=${CHANNEL}`))
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location') ?? '')
    expect(loc.searchParams.get('scope')).toContain('youtube.upload')
    expect(loc.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/auth/google/youtube/callback')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${YOUTUBE_STATE_COOKIE}=`)
    expect(cookie).toContain(`:c1:${CHANNEL}`)
  })
})
