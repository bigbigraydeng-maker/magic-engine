import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { fetchYouTubeObservation } from './youtube-metadata'
const fetchMock = vi.fn()
beforeEach(() => { vi.stubEnv('YOUTUBE_API_KEY', 'test-only-key'); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('public YouTube counters', () => {
  it('has honest missing-key, unavailable and provider-error states', async () => {
    vi.stubEnv('YOUTUBE_API_KEY', '')
    expect((await fetchYouTubeObservation('abcdefghijk')).status).toBe('missing_key')
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('YOUTUBE_API_KEY', 'test-only-key')
    fetchMock.mockResolvedValueOnce({ ok: false })
    expect((await fetchYouTubeObservation('abcdefghijk')).status).toBe('upstream_error')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
    expect((await fetchYouTubeObservation('abcdefghijk')).status).toBe('unavailable')
  })
  it('preserves real zero, rejects invalid/absent statistics and disables caching', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ statistics: { viewCount: '0' } }] }) })
    expect(await fetchYouTubeObservation('abcdefghijk')).toMatchObject({ status: 'ok', views: 0, likes: null })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ statistics: { viewCount: '-1', likeCount: 'NaN' } }] }) })
    expect(await fetchYouTubeObservation('abcdefghijk')).toMatchObject({ views: null, likes: null })
  })
  it('returns API data with a read timestamp, never exposes request errors', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ statistics: { viewCount: '234', likeCount: '5' } }] }) })
    expect(await fetchYouTubeObservation('abcdefghijk')).toMatchObject({ status: 'ok', views: 234, likes: 5, observedAt: expect.any(String) })
    fetchMock.mockRejectedValueOnce(new Error('private detail'))
    expect(await fetchYouTubeObservation('abcdefghijk')).toEqual({ status: 'upstream_error', views: null, likes: null, observedAt: null })
  })
})
