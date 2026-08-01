/**
 * getGbpReviewsByIdentity / getTripadvisorSnapshot tests — DataForSEO 计划 阶段 2.
 * 队列模式（task_post → task_get，评论类端点无 live，实测 404）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/validation-utils', () => ({
  validateEnvVar: vi.fn((name: string) => `test-${name}`),
}))

import { getGbpReviewsByIdentity, getTripadvisorSnapshot } from '../business-data'

function jsonResponse(payload: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}

/** task_post 成功 → task_get 一次到位（20000） */
function queueHappyPath(result: unknown) {
  mockFetch
    .mockReturnValueOnce(jsonResponse({ tasks: [{ id: 'task-1', status_code: 20100 }] }))
    .mockReturnValueOnce(jsonResponse({ tasks: [{ status_code: 20000, result: [result] }] }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getGbpReviewsByIdentity (queue mode)', () => {
  it('task_post carries cid for numeric identity, place_id for ChIJ, keyword otherwise', async () => {
    queueHappyPath({ items: [] })
    await getGbpReviewsByIdentity({ place_id: '18353373651244656739' }, 30, { locationCode: 2554 })
    let body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Array<Record<string, unknown>>
    expect(mockFetch.mock.calls[0][0]).toContain('google/reviews/task_post')
    expect(body[0].cid).toBe('18353373651244656739')
    expect(body[0].place_id).toBeUndefined()
    expect(body[0].depth).toBe(30)
    expect(body[0].location_code).toBe(2554)

    vi.clearAllMocks()
    queueHappyPath({ items: [] })
    await getGbpReviewsByIdentity({ place_id: 'ChIJ_x' }, 30)
    body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Array<Record<string, unknown>>
    expect(body[0].place_id).toBe('ChIJ_x')
    expect(body[0].cid).toBeUndefined()

    vi.clearAllMocks()
    expect(await getGbpReviewsByIdentity({})).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled() // 无身份不发请求
  })

  it('polls task_get and parses profile + reviews (author = profile_name)', async () => {
    queueHappyPath({
      rating: { value: 5, votes_count: 29 },
      reviews_count: 29,
      items: [
        { review_id: 'rid-1', rating: { value: 5 }, review_text: ' great ', timestamp: '2026-05-29 04:07:03 +00:00', profile_name: 'Aaron' },
        { review_id: null, rating: { value: null }, review_text: 'no rating — dropped' },
      ],
    })

    const result = await getGbpReviewsByIdentity({ place_id: 'ChIJ_x' }, 30)

    expect(mockFetch.mock.calls[1][0]).toContain('google/reviews/task_get/task-1')
    expect(result?.profile).toEqual({ rating: 5, review_count: 29 })
    expect(result?.reviews).toHaveLength(1)
    expect(result?.reviews[0]).toMatchObject({ review_id: 'rid-1', rating: 5, text: 'great', author: 'Aaron' })
  })

  it('throws when task_post is rejected or task_get reports terminal failure', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ tasks: [{ id: null, status_code: 40000, status_message: 'Bad Request' }] }),
    )
    await expect(getGbpReviewsByIdentity({ place_id: 'ChIJ_x' })).rejects.toThrow(/task_post rejected/)

    vi.clearAllMocks()
    mockFetch
      .mockReturnValueOnce(jsonResponse({ tasks: [{ id: 'task-2', status_code: 20100 }] }))
      .mockReturnValueOnce(jsonResponse({ tasks: [{ status_code: 40501, status_message: 'Task Error' }] }))
    await expect(getGbpReviewsByIdentity({ place_id: 'ChIJ_x' })).rejects.toThrow(/task failed: 40501/)
  })
})

describe('getTripadvisorSnapshot (queue mode)', () => {
  const taItem = (title: string, ratingValue: number, votes: number) => ({
    type: 'tripadvisor_search_organic',
    title,
    url: `https://ta/${title}`,
    rating: { value: ratingValue, votes_count: votes }, // rating 是对象（实测确认）
    reviews_count: votes,
  })

  it('posts keyword + REQUIRED location_name; matches listing by title, never item[0]', async () => {
    queueHappyPath({
      // 第一条是竞品 —— 盲取 item[0] 就把 Haka Tours 的评分记到客户头上
      items: [taItem('Haka Tours', 4.5, 236), taItem('CTS Tours New Zealand', 4.8, 40)],
    })

    const result = await getTripadvisorSnapshot('CTS Tours', { locationName: 'New Zealand' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Array<Record<string, unknown>>
    expect(mockFetch.mock.calls[0][0]).toContain('tripadvisor/search/task_post')
    expect(body[0].location_name).toBe('New Zealand')
    expect(result).toEqual({
      name: 'CTS Tours New Zealand',
      url: 'https://ta/CTS Tours New Zealand',
      rating: 4.8,
      review_count: 40,
    })
  })

  it('returns null when no title-matching listing exists (competitors only)', async () => {
    queueHappyPath({ items: [taItem('Haka Tours', 4.5, 236), taItem('Red Carpet Tours', 5, 534)] })
    expect(await getTripadvisorSnapshot('CTS Tours', { locationName: 'New Zealand' })).toBeNull()
  })
})

describe('pollBusinessDataTask behaviour (via getGbpReviewsByIdentity)', () => {
  it('keeps polling through queue codes (40602) until 20000', async () => {
    vi.useFakeTimers()
    try {
      mockFetch
        .mockReturnValueOnce(jsonResponse({ tasks: [{ id: 'task-q', status_code: 20100 }] }))
        .mockReturnValueOnce(jsonResponse({ tasks: [{ status_code: 40602, status_message: 'In Queue' }] }))
        .mockReturnValueOnce(jsonResponse({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }))

      const promise = getGbpReviewsByIdentity({ place_id: 'ChIJ_x' }, 30)
      await vi.advanceTimersByTimeAsync(10_000) // 一个轮询周期
      const result = await promise

      expect(result).not.toBeNull()
      expect(mockFetch).toHaveBeenCalledTimes(3) // post + 2 次 poll
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries transient codes (40602 rate-ish) but times out at the deadline', async () => {
    vi.useFakeTimers()
    try {
      mockFetch.mockReturnValueOnce(jsonResponse({ tasks: [{ id: 'task-t', status_code: 20100 }] }))
      // 之后每次 poll 都返回排队中
      mockFetch.mockReturnValue(jsonResponse({ tasks: [{ status_code: 40602 }] }))

      const promise = getGbpReviewsByIdentity({ place_id: 'ChIJ_x' }, 30)
      const assertion = expect(promise).rejects.toThrow(/timed out/)
      await vi.advanceTimersByTimeAsync(250_000) // 越过 240s deadline
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
