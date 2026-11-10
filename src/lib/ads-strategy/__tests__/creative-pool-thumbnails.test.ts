import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))

import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { candidateVideoIds, loadCreativeThumbnails, pickThumbnailUrl } from '../creative-pool-thumbnails'

const mockToken = vi.mocked(getMetaTokenForClient)

function metaFetch(byId: Record<string, { status?: number; body: unknown } | 'throw'>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const id = new URL(url).pathname.split('/').pop() ?? ''
    const hit = byId[id]
    if (hit === 'throw') throw new Error('network down')
    if (!hit) return Response.json({ error: { code: 100 } }, { status: 400 })
    return Response.json(hit.body, { status: hit.status ?? 200 })
  })
}

beforeEach(() => {
  mockToken.mockReset()
  mockToken.mockResolvedValue('tok')
})

describe('candidateVideoIds', () => {
  it('exact numeric ref first, then numeric aliases; skips non-numeric work-order refs', () => {
    expect(candidateVideoIds({ ref: '111', alias_refs: ['222', 'wo-1', '111'] })).toEqual(['111', '222'])
    expect(candidateVideoIds({ ref: 'wo-1', alias_refs: ['555'] })).toEqual(['555'])
    expect(candidateVideoIds({ ref: 'wo-1' })).toEqual([])
  })
})

describe('pickThumbnailUrl', () => {
  it('prefers the is_preferred thumbnail, then the first, then picture', () => {
    expect(pickThumbnailUrl({ thumbnails: { data: [{ uri: 'a' }, { uri: 'b', is_preferred: true }] } })).toBe('b')
    expect(pickThumbnailUrl({ thumbnails: { data: [{ uri: 'a' }] } })).toBe('a')
    expect(pickThumbnailUrl({ thumbnails: { data: [] }, picture: 'p' })).toBe('p')
    expect(pickThumbnailUrl({})).toBeNull()
  })
})

describe('loadCreativeThumbnails', () => {
  it('returns thumbnail, title and rounded duration keyed by ref; token goes in the header, not the URL', async () => {
    const fetchFn = metaFetch({
      '111': { body: { thumbnails: { data: [{ uri: 'https://cdn/x.jpg', is_preferred: true }] }, title: ' Harbour ', length: 14.6 } },
    })
    const out = await loadCreativeThumbnails('c1', [{ ref: '111' }], fetchFn)
    expect(out).toEqual({ '111': { thumbnailUrl: 'https://cdn/x.jpg', title: 'Harbour', durationSeconds: 15 } })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toContain('fields=picture%2Cthumbnails%7Buri%2Cis_preferred%7D%2Ctitle%2Clength')
    expect(url).not.toContain('tok')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(init?.method).toBe('GET')
  })

  it('falls back to an alias id when the exact id cannot be read', async () => {
    const fetchFn = metaFetch({ '222': { body: { picture: 'https://cdn/alias.jpg' } } })
    const out = await loadCreativeThumbnails('c1', [{ ref: '111', alias_refs: ['222'] }], fetchFn)
    expect(out['111'].thumbnailUrl).toBe('https://cdn/alias.jpg')
    expect(fetchFn.mock.calls.map(c => c[0].split('?')[0].split('/').pop())).toEqual(['111', '222'])
  })

  it('uses the exact id and does not call the alias when the exact id answers', async () => {
    const fetchFn = metaFetch({ '111': { body: { picture: 'exact' } }, '222': { body: { picture: 'alias' } } })
    const out = await loadCreativeThumbnails('c1', [{ ref: '111', alias_refs: ['222'] }], fetchFn)
    expect(out['111'].thumbnailUrl).toBe('exact')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('fails soft: Meta error, thrown fetch and empty body just leave the video out', async () => {
    const fetchFn = metaFetch({
      '1': { status: 400, body: { error: { code: 190 } } },
      '2': 'throw',
      '3': { body: {} },
      '4': { body: { picture: 'ok' } },
    })
    const out = await loadCreativeThumbnails('c1', [{ ref: '1' }, { ref: '2' }, { ref: '3' }, { ref: '4' }], fetchFn)
    expect(Object.keys(out)).toEqual(['4'])
  })

  it('returns {} without calling Meta when the client has no token or token lookup throws', async () => {
    const fetchFn = metaFetch({})
    mockToken.mockResolvedValueOnce(null)
    expect(await loadCreativeThumbnails('c1', [{ ref: '1' }], fetchFn)).toEqual({})
    mockToken.mockRejectedValueOnce(new Error('db down'))
    expect(await loadCreativeThumbnails('c1', [{ ref: '1' }], fetchFn)).toEqual({})
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('skips entries that have no numeric id at all (no token lookup either)', async () => {
    const fetchFn = metaFetch({})
    expect(await loadCreativeThumbnails('c1', [{ ref: 'wo-1' }], fetchFn)).toEqual({})
    expect(mockToken).not.toHaveBeenCalled()
  })
})
