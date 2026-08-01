/**
 * Reputation capture tests — pure helpers + orchestration failure semantics.
 * DataForSEO 计划 阶段 2.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGbpReviews, mockGmbInfo, mockTripadvisor, mockFlip, mockSnapUpsert, mockReviewUpsert } =
  vi.hoisted(() => ({
    mockGbpReviews: vi.fn(),
    mockGmbInfo: vi.fn(),
    mockTripadvisor: vi.fn(),
    mockFlip: vi.fn(),
    mockSnapUpsert: vi.fn(),
    mockReviewUpsert: vi.fn(),
  }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'review_items') {
        return {
          update: vi.fn(() => ({ eq: () => ({ eq: () => mockFlip() }) })),
          upsert: vi.fn((rows: unknown, opts: unknown) => ({
            select: () => mockReviewUpsert({ rows, opts }),
          })),
        }
      }
      if (table === 'reputation_snapshots') {
        return {
          upsert: vi.fn((rows: unknown) => ({ select: () => mockSnapUpsert(rows) })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  },
}))

vi.mock('@/lib/dataforseo/business-data', () => ({
  getGbpReviewsByIdentity: mockGbpReviews,
  getGmbInfo: mockGmbInfo,
  getTripadvisorInfo: mockTripadvisor,
}))

import {
  parseCompetitorGbp,
  buildEntities,
  gbpKeywordFor,
  reviewUid,
  hasReputationIdentity,
  captureReputationForClient,
  type ReputationClient,
} from '../snapshots'

const CLIENT: ReputationClient = {
  id: 'client-cts',
  name: 'CTS Tours NZ',
  city: 'Auckland',
  country: 'NZ',
  gbp_place_id: 'ChIJ_cts',
  tripadvisor_keyword: null,
  competitor_gbp: [{ name: 'Rival Tours', place_id: 'ChIJ_rival' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFlip.mockResolvedValue({ error: null })
  mockSnapUpsert.mockResolvedValue({ data: [{ id: 's1' }], error: null })
  mockReviewUpsert.mockResolvedValue({ data: [{ id: 'r1' }], error: null })
  mockGmbInfo.mockResolvedValue(null)
  mockTripadvisor.mockResolvedValue(null)
})

describe('parseCompetitorGbp', () => {
  it('keeps only entries with non-empty name AND place_id', () => {
    expect(parseCompetitorGbp([
      { name: 'A', place_id: 'p1' },
      { name: '', place_id: 'p2' },
      { name: 'C' },
      'garbage',
      null,
    ])).toEqual([{ name: 'A', place_id: 'p1' }])
    expect(parseCompetitorGbp(null)).toEqual([])
    expect(parseCompetitorGbp('not-an-array')).toEqual([])
  })
})

describe('buildEntities / gbpKeywordFor / hasReputationIdentity', () => {
  it('client first, then competitors', () => {
    const entities = buildEntities(CLIENT)
    expect(entities).toHaveLength(2)
    expect(entities[0]).toMatchObject({ entity_type: 'client', place_id: 'ChIJ_cts' })
    expect(entities[1]).toMatchObject({ entity_type: 'competitor', name: 'Rival Tours' })
  })

  it('keyword falls back to name city country, skipping nulls', () => {
    expect(gbpKeywordFor(CLIENT)).toBe('CTS Tours NZ Auckland NZ')
    expect(gbpKeywordFor({ name: 'X', city: null, country: null })).toBe('X')
  })

  it('identity gate: nothing configured = false', () => {
    expect(hasReputationIdentity(CLIENT)).toBe(true)
    expect(hasReputationIdentity({
      ...CLIENT, gbp_place_id: null, tripadvisor_keyword: null, competitor_gbp: [],
    })).toBe(false)
    expect(hasReputationIdentity({
      ...CLIENT, gbp_place_id: '  ', tripadvisor_keyword: null, competitor_gbp: 'junk',
    })).toBe(false)
  })
})

describe('reviewUid', () => {
  const base = { review_id: null, rating: 5, text: 'Great trip to China!', date: '2026-07-01', author: 'Amy' }

  it('prefers the API review_id', () => {
    expect(reviewUid({ ...base, review_id: 'rid-1' })).toBe('rid-1')
  })

  it('hash fallback is stable and input-sensitive', () => {
    expect(reviewUid(base)).toBe(reviewUid({ ...base }))
    expect(reviewUid(base)).not.toBe(reviewUid({ ...base, author: 'Bob' }))
    expect(reviewUid(base)).toMatch(/^h_/)
  })
})

describe('captureReputationForClient', () => {
  const gbpResponse = {
    profile: { rating: 4.8, review_count: 120 },
    reviews: [
      { review_id: 'rid-1', rating: 5, text: 'great', date: '2026-07-30', author: 'Amy' },
    ],
  }

  it('flips is_new before inserting, writes snapshots + reviews with ignoreDuplicates', async () => {
    mockGbpReviews.mockResolvedValue(gbpResponse)

    const result = await captureReputationForClient(CLIENT)

    expect(mockFlip).toHaveBeenCalledTimes(1)
    expect(result.entities_captured).toBe(2)
    expect(result.snapshots_written).toBe(1) // mock 返回 1 行
    expect(result.reviews_written).toBe(1)

    const snapRows = mockSnapUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(snapRows).toHaveLength(2)
    expect(snapRows[0]).toMatchObject({ entity_type: 'client', source: 'gbp', rating: 4.8 })
    expect(snapRows[1]).toMatchObject({ entity_type: 'competitor', entity_name: 'Rival Tours' })

    const { opts } = mockReviewUpsert.mock.calls[0][0] as { opts: { ignoreDuplicates?: boolean } }
    expect(opts.ignoreDuplicates).toBe(true)
  })

  it('single entity failure is counted, not fatal', async () => {
    mockGbpReviews
      .mockResolvedValueOnce(gbpResponse)
      .mockRejectedValueOnce(new Error('DataForSEO 500'))

    const result = await captureReputationForClient(CLIENT)
    expect(result.entities_captured).toBe(1)
    expect(result.entities_failed).toBe(1)
    expect(result.snapshots_written).toBe(1)
  })

  it('tripadvisor snapshot rides along when keyword configured', async () => {
    mockGbpReviews.mockResolvedValue(gbpResponse)
    mockTripadvisor.mockResolvedValue({ name: 'CTS Tours', url: 'x', rating: 4.5, review_count: 40 })

    const withTa = { ...CLIENT, tripadvisor_keyword: 'CTS Tours New Zealand' }
    const result = await captureReputationForClient(withTa)

    const snapRows = mockSnapUpsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(snapRows.some(r => r.source === 'tripadvisor' && r.rating === 4.5)).toBe(true)
    expect(result.entities_captured).toBe(3)
  })

  it('throws when snapshot upsert fails (data must not be silently lost)', async () => {
    mockGbpReviews.mockResolvedValue(gbpResponse)
    mockSnapUpsert.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })

    await expect(captureReputationForClient(CLIENT)).rejects.toThrow(/upsert failed/)
  })

  it('throws when ALL entities fail (silent all-empty must not look completed)', async () => {
    mockGbpReviews.mockRejectedValue(new Error('DataForSEO 500'))
    await expect(captureReputationForClient(CLIENT)).rejects.toThrow(/all 2 entities failed/)
  })

  it('client GBP fallback uses name-city-country keyword, never the place_id string', async () => {
    // 评论响应无档案 → 走 getGmbInfo 兜底；client 实体必须用 keyword 而不是 place_id
    mockGbpReviews.mockResolvedValue({ profile: null, reviews: [] })
    mockGmbInfo.mockResolvedValue({ rating: 4.0, review_count: 10 })

    await captureReputationForClient(CLIENT)

    const calledWith = mockGmbInfo.mock.calls.map(c => c[0] as string)
    expect(calledWith).toContain('CTS Tours NZ Auckland NZ') // client 实体
    expect(calledWith).toContain('Rival Tours')              // 竞品实体
    expect(calledWith.some(k => k.startsWith('ChIJ'))).toBe(false)
  })

  it('throws when the is_new flip fails (stale "new" flags must not survive)', async () => {
    mockFlip.mockResolvedValueOnce({ error: { message: 'timeout' } })
    await expect(captureReputationForClient(CLIENT)).rejects.toThrow(/is_new flip failed/)
    expect(mockGbpReviews).not.toHaveBeenCalled() // 花钱调用发生在闸后
  })
})
