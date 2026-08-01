/**
 * getGbpReviewsByIdentity tests — DataForSEO 计划 阶段 2.
 * depth 语义（=条数，不是 10 条一单位）、place_id/keyword 互斥、档案双来源解析。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/validation-utils', () => ({
  validateEnvVar: vi.fn((name: string) => `test-${name}`),
}))

import { getGbpReviewsByIdentity } from '../business-data'

function makeResponse(result: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ tasks: [{ result: [result] }] }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getGbpReviewsByIdentity', () => {
  it('sends place_id (not keyword) when configured, with depth = review count', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ items: [] }))

    await getGbpReviewsByIdentity({ place_id: 'ChIJ_x', keyword: 'should be ignored' }, 30)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Array<Record<string, unknown>>
    expect(body[0].place_id).toBe('ChIJ_x')
    expect(body[0].keyword).toBeUndefined()
    expect(body[0].depth).toBe(30) // depth = 条数（旧 getGoogleReviews 的 /10 是既有 bug）
  })

  it('numeric identity is sent as cid, not place_id (GBP connector stores cid)', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ items: [] }))

    await getGbpReviewsByIdentity({ place_id: '18353373651244656739' }, 30)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Array<Record<string, unknown>>
    expect(body[0].cid).toBe('18353373651244656739')
    expect(body[0].place_id).toBeUndefined()
  })

  it('falls back to keyword when no place_id; returns null with neither', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ items: [] }))
    await getGbpReviewsByIdentity({ keyword: 'Oztop Building Supplies' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Array<Record<string, unknown>>
    expect(body[0].keyword).toBe('Oztop Building Supplies')
    expect(body[0].place_id).toBeUndefined()

    expect(await getGbpReviewsByIdentity({})).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1) // 无身份不发请求
  })

  it('parses listing profile + review ids from the reviews response', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({
      rating: { value: 4.7, votes_count: 88 },
      reviews_count: 90,
      items: [
        { review_id: 'rid-1', rating: { value: 5 }, review_text: ' great ', timestamp: '2026-07-30', author_name: 'Amy' },
        { review_id: null, rating: { value: null }, review_text: 'no rating — dropped' },
      ],
    }))

    const result = await getGbpReviewsByIdentity({ place_id: 'ChIJ_x' }, 30)

    expect(result?.profile).toEqual({ rating: 4.7, review_count: 90 })
    expect(result?.reviews).toHaveLength(1)
    expect(result?.reviews[0]).toMatchObject({ review_id: 'rid-1', rating: 5, text: 'great', author: 'Amy' })
  })

  it('returns null profile when listing rating absent; throws on HTTP error', async () => {
    mockFetch.mockReturnValueOnce(makeResponse({ items: [] }))
    const result = await getGbpReviewsByIdentity({ place_id: 'ChIJ_x' })
    expect(result?.profile).toBeNull()

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(getGbpReviewsByIdentity({ place_id: 'ChIJ_x' })).rejects.toThrow(/500/)
  })
})
