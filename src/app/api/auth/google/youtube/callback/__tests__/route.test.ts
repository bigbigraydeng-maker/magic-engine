import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), target: vi.fn(), claim: vi.fn(),
  discover: vi.fn(), persist: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOnboardingClientAccess: mocks.access }))
vi.mock('@/lib/youtube-publish/store', () => ({ readClientChannelTarget: mocks.target,
  claimClientChannelTarget: mocks.claim }))
vi.mock('@/lib/youtube-publish/client', () => ({ discoverSingleAuthorizedChannel: mocks.discover }))
vi.mock('@/lib/youtube-publish/oauth', async (orig) => ({
  ...(await orig<typeof import('@/lib/youtube-publish/oauth')>()), persistYoutubeConnection: mocks.persist,
}))

import { GET } from '../route'
import { buildYoutubeState, YOUTUBE_STATE_COOKIE } from '@/lib/youtube-publish/oauth'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const SECOND = 'UCzJJDRx88y0IuZXJJQuGNFw'
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl'

let target: { kind: string; channelId?: string }
function request(channelId: string | null = null, query = 'code=auth-code') {
  const state = buildYoutubeState({ clientId: CLIENT, userId: ACTOR, targetChannelId: channelId }, 'secret-test')
  return new NextRequest(`https://app.example.com/api/auth/google/youtube/callback?state=${encodeURIComponent(state)}&${query}`,
    { headers: { cookie: `${YOUTUBE_STATE_COOKIE}=${state}` } })
}
const outcome = (response: Response) => new URL(response.headers.get('location') ?? '').searchParams.get('youtube')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-test')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret-test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  target = { kind: 'empty' }
  mocks.target.mockImplementation(async () => target)
  mocks.access.mockResolvedValue({ ok: true, user: { id: ACTOR } })
  mocks.discover.mockResolvedValue({ id: CHANNEL, title: 'Celine' })
  mocks.claim.mockImplementation(async (_clientId: string, id: string) => {
    if (target.kind !== 'empty') return false
    target = { kind: 'configured', channelId: id }
    return true
  })
  mocks.persist.mockImplementation(async (input: { beforeWrite: () => Promise<boolean> }) =>
    await input.beforeWrite() ? { ok: true, channelTitle: 'Celine' } : { ok: false, reason: 'context_changed' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: SCOPES,
  }) }))
})

describe('YouTube customer OAuth callback', () => {
  it('auto-binds exactly one channel then saves the grant', async () => {
    const response = await GET(request())
    expect(outcome(response)).toBe('connected')
    expect(mocks.claim).toHaveBeenCalledWith(CLIENT, CHANNEL)
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ expectedChannelId: CHANNEL }))
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('retains an existing exact target without claiming another', async () => {
    target = { kind: 'configured', channelId: CHANNEL }
    expect(outcome(await GET(request(CHANNEL)))).toBe('connected')
    expect(mocks.discover).not.toHaveBeenCalled()
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it.each([['none', 'no_channel'], ['multiple', 'multiple_channels']])('refuses %s discovered channels', async (result, expected) => {
    mocks.discover.mockResolvedValue(result)
    expect(outcome(await GET(request()))).toBe(expected)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it('a concurrent channel claim cannot adopt the winner or persist the loser grant', async () => {
    mocks.claim.mockImplementation(async () => { target = { kind: 'configured', channelId: SECOND }; return false })
    expect(outcome(await GET(request()))).toBe('target_changed')
    expect(target.channelId).toBe(SECOND)
  })

  it('detects target or actor changes during provider wait before writing', async () => {
    mocks.discover.mockImplementationOnce(async () => { target = { kind: 'configured', channelId: SECOND }; return { id: CHANNEL, title: 'A' } })
    expect(outcome(await GET(request()))).toBe('target_changed')
    target = { kind: 'empty' }
    mocks.access.mockResolvedValueOnce({ ok: true, user: { id: ACTOR } })
      .mockResolvedValue({ ok: true, user: { id: OTHER } })
    expect(outcome(await GET(request()))).toBe('target_changed')
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('rejects state expiry during the last target read, before the grant write', async () => {
    const callback = request()
    const now = Date.now()
    let reads = 0
    mocks.target.mockImplementation(async () => {
      if (++reads === 4) vi.spyOn(Date, 'now').mockReturnValue(now + 601000)
      return target
    })
    try {
      expect(outcome(await GET(callback))).toBe('target_changed')
      expect(mocks.claim).toHaveBeenCalledOnce()
    } finally { vi.restoreAllMocks() }
  })

  it('rejects access revocation during the last target read', async () => {
    let reads = 0
    mocks.target.mockImplementation(async () => {
      if (++reads === 4) mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
      return target
    })
    expect(outcome(await GET(request()))).toBe('target_changed')
    expect(mocks.claim).toHaveBeenCalledOnce()
  })

  it('does not claim a first-time channel if access is revoked during the pre-claim target read', async () => {
    let reads = 0
    mocks.target.mockImplementation(async () => {
      if (++reads === 2) mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
      return target
    })
    expect(outcome(await GET(request()))).toBe('target_changed')
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('rejects token expiry during provider waits', async () => {
    const callback = request()
    const now = Date.now()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      access_token: 'access', refresh_token: 'refresh', expires_in: 1, scope: SCOPES,
    }) }))
    mocks.discover.mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now + 2000)
      return { id: CHANNEL, title: 'Celine' }
    })
    try { expect(outcome(await GET(callback))).toBe('target_changed') }
    finally { vi.restoreAllMocks() }
  })

  it('rejects app credential change during provider waits', async () => {
    mocks.discover.mockImplementationOnce(async () => {
      vi.stubEnv('GOOGLE_CLIENT_ID', 'changed')
      return { id: CHANNEL, title: 'Celine' }
    })
    expect(outcome(await GET(request()))).toBe('target_changed')
  })

  it('requires the same actor even on trusted cancellation', async () => {
    mocks.access.mockResolvedValue({ ok: true, user: { id: OTHER } })
    expect(outcome(await GET(request(null, 'error=access_denied')))).toBe('bad_state')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancellation clears the matched state without exchanging tokens', async () => {
    const response = await GET(request(null, 'error=access_denied'))
    expect(outcome(response)).toBe('cancelled')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an old callback does not clear a newer state cookie', async () => {
    const response = await GET(new NextRequest('https://app.example.com/api/auth/google/youtube/callback?state=old',
      { headers: { cookie: `${YOUTUBE_STATE_COOKIE}=new` } }))
    expect(outcome(response)).toBe('bad_state')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not accept the retired root-path state cookie', async () => {
    const state = buildYoutubeState({ clientId: CLIENT, userId: ACTOR, targetChannelId: null }, 'secret-test')
    const callback = new NextRequest(`https://app.example.com/api/auth/google/youtube/callback?state=${state}&code=auth-code`,
      { headers: { cookie: `youtube_oauth_state=${state}` } })
    expect(outcome(await GET(callback))).toBe('bad_state')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires a refresh token and does not claim a channel when exchange is incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'a', expires_in: 3600, scope: SCOPES }) }))
    expect(outcome(await GET(request()))).toBe('verify_failed')
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('a failed grant write after successful claim stays configured and reports unfinished', async () => {
    mocks.persist.mockImplementationOnce(async (input: { beforeWrite: () => Promise<boolean> }) => {
      await input.beforeWrite()
      throw new Error('secret provider response')
    })
    expect(outcome(await GET(request()))).toBe('save_failed')
    expect(target).toEqual({ kind: 'configured', channelId: CHANNEL })
    const response = await GET(request(CHANNEL))
    expect(outcome(response)).toBe('connected')
    expect(mocks.claim).toHaveBeenCalledTimes(1)
  })

  it('does not return connected when the grant write cannot be read back', async () => {
    target = { kind: 'configured', channelId: CHANNEL }
    mocks.persist.mockResolvedValueOnce({ ok: false, reason: 'save_unverified' })
    expect(outcome(await GET(request(CHANNEL)))).toBe('save_failed')
  })
})
