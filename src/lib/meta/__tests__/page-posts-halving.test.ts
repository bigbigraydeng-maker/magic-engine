import { describe, it, expect } from 'vitest'
import { fetchPagePosts, fetchPageReels, halveLimit, isReduceDataError, type HalvingStats } from '../page-posts'

const REDUCE = { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } }
const limitOf = (url: string) => new URL(url).searchParams.get('limit')

function scripted(responses: Array<{ status: number; body: unknown }>) {
  const urls: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    const r = responses[Math.min(urls.length - 1, responses.length - 1)]
    return new Response(JSON.stringify(r.body), { status: r.status })
  }) as typeof fetch
  return { fetcher, urls }
}

describe('halveLimit / isReduceDataError', () => {
  it('halves down to the floor then stops', () => {
    expect([100, 50, 25, 12, 6].map(halveLimit)).toEqual([50, 25, 12, 6, 5])
    expect(halveLimit(5)).toBeNull()
  })
  it('recognises Graph code 1 as raw text and as an object', () => {
    expect(isReduceDataError(JSON.stringify(REDUCE))).toBe(true)
    expect(isReduceDataError(REDUCE.error)).toBe(true)
    expect(isReduceDataError(JSON.stringify({ error: { code: 190, message: 'token' } }))).toBe(false)
  })
})

describe('fetchPagePosts halving retry', () => {
  it('🔴 "reduce the amount of data" (HTTP 500) → halves the page size until it succeeds', async () => {
    const { fetcher, urls } = scripted([
      { status: 500, body: REDUCE },
      { status: 500, body: REDUCE },
      { status: 200, body: { data: [{ id: 'P_1', created_time: '2026-10-01T00:00:00Z' }] } },
    ])
    const stats: HalvingStats = { halvings: 0, finalLimit: 100 }
    const posts = await fetchPagePosts('P', 'tok', 100, { fetcher, stats })
    expect(urls.map(limitOf)).toEqual(['100', '50', '25'])
    expect(stats).toEqual({ halvings: 2, finalLimit: 25 })
    expect(posts.map(p => p.fullId)).toEqual(['P_1'])
  })

  it('code 1 inside an HTTP 200 body is retried the same way', async () => {
    const { fetcher, urls } = scripted([{ status: 200, body: REDUCE }, { status: 200, body: { data: [] } }])
    await fetchPagePosts('P', 'tok', 100, { fetcher })
    expect(urls.map(limitOf)).toEqual(['100', '50'])
  })

  it('gives up at the floor and throws (so the run is recorded as failed)', async () => {
    const { fetcher, urls } = scripted([{ status: 500, body: REDUCE }])
    await expect(fetchPagePosts('P', 'tok', 100, { fetcher })).rejects.toThrow(/fetchPagePosts P: 500/)
    expect(urls.map(limitOf)).toEqual(['100', '50', '25', '12', '6', '5'])
  })

  it('other errors are not retried', async () => {
    const { fetcher, urls } = scripted([{ status: 400, body: { error: { code: 190, message: 'expired' } } }])
    await expect(fetchPagePosts('P', 'tok', 100, { fetcher })).rejects.toThrow()
    expect(urls).toHaveLength(1)
  })
})

describe('fetchPageReels halving retry', () => {
  it('halves on code 1 and returns the reels once it works', async () => {
    const { fetcher, urls } = scripted([
      { status: 500, body: REDUCE },
      { status: 200, body: { data: [{ id: 'R1', created_time: '2026-10-01T00:00:00Z' }] } },
    ])
    const reels = await fetchPageReels('P', 'tok', 100, { fetcher })
    expect(urls.map(limitOf)).toEqual(['100', '50'])
    expect(reels.map(r => r.fullId)).toEqual(['R1'])
  })
})
