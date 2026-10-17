import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ upsertConnection: vi.fn() }))
vi.mock('@/lib/platform-oauth/connection-store', () => ({ upsertConnection: mocks.upsertConnection }))

import { isValidChannelId, persistYoutubeConnection } from '../oauth'

const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const base = {
  clientId: 'client-1',
  expectedChannelId: CHANNEL,
  accessToken: 'a',
  refreshToken: 'r',
  expiresInSec: 3600,
  scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
}

function channelsResponse(id: string): Response {
  return new Response(JSON.stringify({ items: [{ id, snippet: { title: 'T' } }] }), { status: 200 })
}

beforeEach(() => vi.clearAllMocks())

describe('isValidChannelId', () => {
  it('accepts a UC id and rejects handles and junk', () => {
    expect(isValidChannelId(CHANNEL)).toBe(true)
    expect(isValidChannelId('@CTSToursNZ2027')).toBe(false)
    expect(isValidChannelId(null)).toBe(false)
  })
})

describe('persistYoutubeConnection', () => {
  it('stores the connection when the channel matches exactly', async () => {
    const f = vi.fn().mockResolvedValue(channelsResponse(CHANNEL))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: true, channelTitle: 'T' })
    expect(mocks.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google_youtube', accountId: CHANNEL, clientId: 'client-1' }),
    )
  })

  it('stores nothing when the account manages a different channel', async () => {
    const f = vi.fn().mockResolvedValue(channelsResponse('UCotherotherotherother00'))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: false, reason: 'channel_mismatch' })
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('stores nothing when the channel lookup itself fails', async () => {
    const f = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }))
    await expect(persistYoutubeConnection(base, f)).resolves.toEqual({ ok: false, reason: 'channel_lookup_failed' })
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })
})
