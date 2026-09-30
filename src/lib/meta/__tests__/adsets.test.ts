import { afterEach, describe, expect, it, vi } from 'vitest'
import { listAdSetsInCampaign } from '../adsets'

afterEach(() => vi.unstubAllGlobals())

describe('listAdSetsInCampaign', () => {
  it('walks every Meta cursor before returning a complete set', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'a', name: 'A', status: 'ACTIVE' }], paging: { next: 'https://graph.facebook.com/v21.0/next?after=x' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'b', name: 'B', status: 'PAUSED' }] })))
    vi.stubGlobal('fetch', fetch)
    await expect(listAdSetsInCampaign('123', 'token')).resolves.toEqual([
      { id: 'a', name: 'A', status: 'ACTIVE' }, { id: 'b', name: 'B', status: 'PAUSED' },
    ])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fails closed when Meta returns an untrusted continuation URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'a', name: 'A', status: 'ACTIVE' }], paging: { next: 'https://attacker.example/steal-token' },
    }))))
    await expect(listAdSetsInCampaign('123', 'token')).resolves.toBeNull()
  })
})
