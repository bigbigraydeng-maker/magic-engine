import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/meta/asset-upload', () => ({
  uploadImageToMeta: vi.fn(async () => ({ ok: true, asset: { kind: 'image', hash: 'hash1' } })),
}))

import { uploadImageToMeta } from '@/lib/meta/asset-upload'
import { metaCreativeClient } from '../runtime'

describe('meta creative client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('uploads, then posts the creative, then posts a paused ad with no budget', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cr1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ad9' }), { status: 200 }))
    const client = metaCreativeClient('tok')
    const image = await client.uploadImage({
      accountId: 'act_111111',
      storageUrl: 'https://cdn.example/poster.jpg',
      filename: 'poster.jpg',
    })
    const creative = await client.createCreative({
      accountId: 'act_111111',
      name: 'Spring image',
      story: { page_id: 'pg1' },
    })
    const ad = await client.createAd({
      accountId: 'act_111111',
      adSetId: '111',
      name: 'Spring image',
      creativeId: 'cr1',
      status: 'PAUSED',
    })
    expect(image).toEqual({ ok: true, id: 'hash1' })
    expect(creative).toEqual({ ok: true, id: 'cr1' })
    expect(ad).toEqual({ ok: true, id: 'ad9' })
    expect(uploadImageToMeta).toHaveBeenCalledTimes(1)
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls[0]).toContain('/act_111111/adcreatives')
    expect(urls[1]).toContain('/act_111111/ads')
    const adBody = String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body ?? '')
    expect(adBody).toContain('status=PAUSED')
    expect(adBody).not.toContain('daily_budget')
    expect(adBody).not.toContain('adset_budget')
  })

  it('reports a creative HTTP failure and does not post the ad', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 400 }))
    const client = metaCreativeClient('tok')
    const creative = await client.createCreative({
      accountId: 'act_111111',
      name: 'Spring image',
      story: { page_id: 'pg1' },
    })
    expect(creative).toEqual({ ok: false, error: 'HTTP 400' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
