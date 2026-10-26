import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upsertConnection: vi.fn(), confirmSocialConnectionWrite: vi.fn() }))
vi.mock('@/lib/platform-oauth/connection-store', () => ({ upsertConnection: mocks.upsertConnection,
  confirmSocialConnectionWrite: mocks.confirmSocialConnectionWrite }))

import { buildYoutubeState, isValidChannelId, persistYoutubeConnection, verifyYoutubeState } from '../oauth'

const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const CLIENT = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const base = {
  clientId: 'client-1',
  expectedChannelId: CHANNEL,
  accessToken: 'a',
  refreshToken: 'r',
  tokenExpiry: new Date(Date.now() + 3600_000),
  scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl',
}

function channelsResponse(id: string): Response {
  return new Response(JSON.stringify({ items: [{ id, snippet: { title: 'T' } }] }), { status: 200 })
}

beforeEach(() => { vi.clearAllMocks(); mocks.confirmSocialConnectionWrite.mockResolvedValue(true) })

describe('isValidChannelId', () => {
  it('accepts a UC id and rejects handles and junk', () => {
    expect(isValidChannelId(CHANNEL)).toBe(true)
    expect(isValidChannelId('@CTSToursNZ2027')).toBe(false)
    expect(isValidChannelId(null)).toBe(false)
  })
})

describe('YouTube consent context', () => {
  it('signs the actor, customer, target and short expiry', () => {
    const state = buildYoutubeState({ clientId: CLIENT, userId: ACTOR, targetChannelId: CHANNEL }, 'secret')
    expect(verifyYoutubeState(state, 'secret')).toMatchObject({ clientId: CLIENT, userId: ACTOR, targetChannelId: CHANNEL })
    expect(verifyYoutubeState(state, 'other')).toBeNull()
    expect(verifyYoutubeState(`${state}x`, 'secret')).toBeNull()
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 601000)
      expect(verifyYoutubeState(state, 'secret')).toBeNull()
    } finally { vi.useRealTimers() }
  })
})

describe('persistYoutubeConnection', () => {
  it('stores the connection when the channel matches exactly', async () => {
    const f = vi.fn().mockResolvedValue(channelsResponse(CHANNEL))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: true, channelTitle: 'T' })
    expect(mocks.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google_youtube', accountId: CHANNEL, clientId: 'client-1', tokenExpiry: base.tokenExpiry }),
    )
    expect(mocks.confirmSocialConnectionWrite).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'google_youtube', accountId: CHANNEL, clientId: 'client-1', tokenExpiry: base.tokenExpiry,
    }))
  })

  it('does not report success when the write cannot be read back', async () => {
    mocks.confirmSocialConnectionWrite.mockResolvedValueOnce(false)
    const f = vi.fn().mockResolvedValue(channelsResponse(CHANNEL))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: false, reason: 'save_unverified' })
  })

  it('stores nothing when the account manages a different channel', async () => {
    const f = vi.fn().mockResolvedValue(channelsResponse('UCotherotherotherother00'))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: false, reason: 'channel_mismatch' })
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('stores nothing when the user unticked the upload permission', async () => {
    const f = vi.fn()
    const input = { ...base, scope: 'https://www.googleapis.com/auth/youtube.readonly' }
    await expect(persistYoutubeConnection(input, f)).resolves.toEqual({ ok: false, reason: 'scope_missing' })
    expect(f).not.toHaveBeenCalled()
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('stores nothing when the user unticked the change-visibility permission', async () => {
    const f = vi.fn()
    const input = {
      ...base,
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
    }
    await expect(persistYoutubeConnection(input, f)).resolves.toEqual({ ok: false, reason: 'scope_missing' })
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('stores nothing when the channel lookup itself fails', async () => {
    const f = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: false, reason: 'channel_lookup_failed' })
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('rechecks context after channel lookup and before writing the grant', async () => {
    const f = vi.fn().mockResolvedValue(channelsResponse(CHANNEL))
    const guard = vi.fn().mockResolvedValue(false)
    await expect(persistYoutubeConnection({ ...base, beforeWrite: guard }, f))
      .resolves.toEqual({ ok: false, reason: 'context_changed' })
    expect(guard).toHaveBeenCalledOnce()
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('does not persist a token that expired while the final guard waited', async () => {
    const f = vi.fn().mockResolvedValue(channelsResponse(CHANNEL))
    const soon = new Date(Date.now() + 1000)
    const now = Date.now()
    const guard = vi.fn().mockImplementation(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(now + 2000)
      return true
    })
    try {
      await expect(persistYoutubeConnection({ ...base, tokenExpiry: soon, beforeWrite: guard }, f))
        .resolves.toEqual({ ok: false, reason: 'context_changed' })
      expect(mocks.upsertConnection).not.toHaveBeenCalled()
    } finally { vi.restoreAllMocks() }
  })
})
