import { describe, expect, it, vi } from 'vitest'
import { discoverSingleAuthorizedChannel } from '../client'

const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'
const record = { id: CHANNEL, snippet: { title: 'Celine' } }
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const lookup = (body: unknown) => vi.fn().mockResolvedValue(response(body)) as typeof fetch

describe('single YouTube channel discovery', () => {
  it('accepts only one valid channel on a complete provider page', async () => {
    const fetcher = lookup({ items: [record], pageInfo: { totalResults: 1 } })
    expect(await discoverSingleAuthorizedChannel('token', fetcher)).toEqual({ id: CHANNEL, title: 'Celine' })
    expect(vi.mocked(fetcher).mock.calls[0][0]).toContain('maxResults=2')
  })

  it('distinguishes no channel and multiple channels', async () => {
    expect(await discoverSingleAuthorizedChannel('token', lookup({ items: [], pageInfo: { totalResults: 0 } }))).toBe('none')
    expect(await discoverSingleAuthorizedChannel('token', lookup({ items: [record, record], pageInfo: { totalResults: 2 } }))).toBe('multiple')
  })

  it('does not infer uniqueness from pagination or an inconsistent total', async () => {
    expect(await discoverSingleAuthorizedChannel('token', lookup({ items: [record], nextPageToken: 'more', pageInfo: { totalResults: 2 } }))).toBe('multiple')
    expect(await discoverSingleAuthorizedChannel('token', lookup({ items: [record], nextPageToken: 'more', pageInfo: { totalResults: 1 } }))).toBe('multiple')
    expect(await discoverSingleAuthorizedChannel('token', lookup({ items: [record] }))).toBe('multiple')
  })

  it('rejects malformed channel identities instead of filtering bad rows', async () => {
    await expect(discoverSingleAuthorizedChannel('token', lookup({ items: [{ id: 'bad' }], pageInfo: { totalResults: 1 } }))).rejects.toThrow()
    await expect(discoverSingleAuthorizedChannel('token', lookup({ items: 'bad', pageInfo: { totalResults: 1 } }))).rejects.toThrow()
  })
})
