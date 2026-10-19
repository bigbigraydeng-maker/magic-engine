import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), target: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOnboardingClientAccess: mocks.access }))
vi.mock('@/lib/youtube-publish/store', () => ({ readClientChannelTarget: mocks.target }))

import { GET } from '../route'
import { YOUTUBE_STATE_COOKIE, verifyYoutubeState } from '@/lib/youtube-publish/oauth'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const req = (suffix = '') => new NextRequest(`http://localhost:3001/api/auth/google/youtube/start?clientId=${CLIENT}${suffix}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-test')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret-test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  mocks.access.mockResolvedValue({ ok: true, user: { id: ACTOR } })
  mocks.target.mockResolvedValue({ kind: 'empty' })
})

describe('YouTube customer OAuth start', () => {
  it('refuses other customers before reading a channel', async () => {
    mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await GET(req())).status).toBe(403)
    expect(mocks.target).not.toHaveBeenCalled()
  })

  it('allows first-time customer consent without a preconfigured channel', async () => {
    const response = await GET(req())
    expect(response.status).toBe(302)
    const url = new URL(response.headers.get('location') ?? '')
    const state = url.searchParams.get('state') ?? ''
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('scope')).toContain('youtube.upload')
    expect(verifyYoutubeState(state, 'secret-test')).toMatchObject({ clientId: CLIENT, userId: ACTOR, targetChannelId: null })
    expect(response.cookies.get(YOUTUBE_STATE_COOKIE)?.value).toBe(state)
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('pins configured channel rather than accepting a query override', async () => {
    mocks.target.mockResolvedValue({ kind: 'configured', channelId: CHANNEL })
    const response = await GET(req('&channelId=UCattackerAttackerAttack1'))
    const state = new URL(response.headers.get('location') ?? '').searchParams.get('state') ?? ''
    expect(verifyYoutubeState(state, 'secret-test')?.targetChannelId).toBe(CHANNEL)
  })

  it('rejects missing or invalid client targets and missing app credentials', async () => {
    mocks.target.mockResolvedValueOnce({ kind: 'missing' }).mockResolvedValueOnce({ kind: 'invalid' })
    expect(new URL((await GET(req())).headers.get('location') ?? '').searchParams.get('youtube')).toBe('target_review')
    expect(new URL((await GET(req())).headers.get('location') ?? '').searchParams.get('youtube')).toBe('target_review')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    expect(new URL((await GET(req())).headers.get('location') ?? '').searchParams.get('youtube')).toBe('unavailable')
  })
})
