import { afterEach, describe, expect, it, vi } from 'vitest'
import { listSentCampaigns } from '../client'

const KEY = 'abc123-us14'

afterEach(() => vi.unstubAllGlobals())

function stub() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ campaigns: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return () => new URL(String((fetchMock.mock.calls[0] as unknown[])[0]))
}

describe('listSentCampaigns', () => {
  it('can be limited to one audience (the API key is shared by every client)', async () => {
    const url = stub()
    await listSentCampaigns(KEY, { sinceSentAt: '2026-10-21T00:00:00Z', listId: 'aud-cts', count: 100 })
    expect(url().searchParams.get('list_id')).toBe('aud-cts')
    expect(url().searchParams.get('since_send_time')).toBe('2026-10-21T00:00:00Z')
    expect(url().searchParams.get('status')).toBe('sent')
    expect(url().searchParams.get('count')).toBe('100')
  })

  it('without a list id it behaves as before (the other callers are unchanged)', async () => {
    const url = stub()
    await listSentCampaigns(KEY, { sinceSentAt: '2026-10-21T00:00:00Z' })
    expect(url().searchParams.has('list_id')).toBe(false)
    expect(url().searchParams.get('count')).toBe('100')
  })
})
