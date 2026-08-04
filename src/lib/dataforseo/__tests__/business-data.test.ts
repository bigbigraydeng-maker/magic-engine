import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGoogleReviews } from '../business-data'

vi.mock('@/lib/validation-utils', () => ({
  validateEnvVar: () => 'test',
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeMockResponse(items: unknown[]) {
  return Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        tasks: [{ result: [{ items }] }],
      }),
  } as Response)
}

function sentDepth(): number {
  const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
  return body[0].depth
}

describe('getGoogleReviews', () => {
  beforeEach(() => mockFetch.mockReset())

  it('requests depth = limit when limit is a multiple of 10 (depth is a review count, not a unit count)', async () => {
    mockFetch.mockReturnValue(makeMockResponse([]))

    await getGoogleReviews('Oztop Building Supplies', 20)

    expect(sentDepth()).toBe(20)
  })

  it('rounds depth up to the next multiple of 10', async () => {
    mockFetch.mockReturnValue(makeMockResponse([]))

    await getGoogleReviews('Oztop Building Supplies', 15)

    expect(sentDepth()).toBe(20)
  })

  it('defaults to depth 10 when limit is omitted', async () => {
    mockFetch.mockReturnValue(makeMockResponse([]))

    await getGoogleReviews('Oztop Building Supplies')

    expect(sentDepth()).toBe(10)
  })

  it('parses reviews and truncates the result to limit', async () => {
    mockFetch.mockReturnValue(
      makeMockResponse([
        { rating: { value: 5 }, review_text: 'Great ', timestamp: '2026-07-01', author_name: 'A' },
        { rating: { value: 1 }, review_text: 'Bad',    timestamp: '2026-07-02', author_name: 'B' },
        { rating: { value: 4 }, review_text: 'Third — should be dropped', timestamp: null, author_name: null },
      ]),
    )

    const reviews = await getGoogleReviews('Oztop Building Supplies', 2)

    expect(reviews).toEqual([
      { rating: 5, text: 'Great', date: '2026-07-01', author: 'A' },
      { rating: 1, text: 'Bad',   date: '2026-07-02', author: 'B' },
    ])
  })

  it('returns null when no reviews are found', async () => {
    mockFetch.mockReturnValue(makeMockResponse([]))

    const reviews = await getGoogleReviews('Nonexistent Business')

    expect(reviews).toBeNull()
  })
})
