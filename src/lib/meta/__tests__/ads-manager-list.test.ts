import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAdsInAdSet } from '../ads-manager'

afterEach(() => vi.unstubAllGlobals())

function page(ids: string[], next?: string): Response {
  return new Response(JSON.stringify({
    data: ids.map((id) => ({ id, name: id, status: 'PAUSED', creative: { effective_object_story_id: `p_${id}` } })),
    ...(next ? { paging: { next } } : {}),
  }), { status: 200 })
}

describe('listAdsInAdSet', () => {
  it('follows the paging cursor so an ad past the first page is still seen', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page(['a1'], 'https://graph.example/next-1'))
      .mockResolvedValueOnce(page(['a2']))
    vi.stubGlobal('fetch', fetchMock)
    const ads = await listAdsInAdSet('as_1', 'token')
    expect(ads.map((a) => a.effectiveObjectStoryId)).toEqual(['p_a1', 'p_a2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://graph.example/next-1')
  })

  it('fails closed when a later page errors instead of returning a partial list', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(page(['a1'], 'https://graph.example/next-1'))
      .mockResolvedValueOnce(new Response('', { status: 500 })))
    await expect(listAdsInAdSet('as_1', 'token')).rejects.toThrow('listAdsInAdSet as_1: 500')
  })

  it('fails closed when the cursor never ends', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => page(['x'], 'https://graph.example/again')))
    await expect(listAdsInAdSet('as_1', 'token')).rejects.toThrow('more than 5000 ads')
  })
})
