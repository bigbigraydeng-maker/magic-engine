/**
 * watch-keywords tests — parse / read / build / orchestration.
 *
 * Mirrors the vi.hoisted / vi.mock style of the serp-capture orchestration test.
 * The supabase mock is a per-table builder: from('keyword_snapshots') exposes
 * select().eq().eq().eq().in() and upsert().select().
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetOrganicRanks, mockSelectIn, mockUpsert } = vi.hoisted(() => ({
  mockGetOrganicRanks: vi.fn(),
  mockSelectIn: vi.fn(),
  mockUpsert: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'keyword_snapshots') {
        return {
          select: vi.fn(() => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  in: (_kwCol: string, kws: string[]) => mockSelectIn(kws),
                }),
              }),
            }),
          })),
          upsert: vi.fn((rows: unknown, opts: unknown) => ({
            select: () => mockUpsert(rows, opts),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  },
}))

vi.mock('@/lib/dataforseo/serp', () => ({
  getOrganicRanks: mockGetOrganicRanks,
}))

import {
  buildWatchSnapshotRows,
  parseWatchKeywords,
  readOwnDomainRank,
  snapshotWatchedKeywordsForClient,
  type WatchRankReading,
} from '../watch-keywords'
import type { OrganicRankSnapshot } from '@/lib/dataforseo/serp'
import type { KeywordSnapshotClient } from '../keyword-snapshots'

const CLIENT: KeywordSnapshotClient = {
  id: 'client-1',
  domain: 'example.co.nz',
  semrush_db: 'nz',
}

const snap = (items: OrganicRankSnapshot['items'], cost: number | null = 0.002): OrganicRankSnapshot => ({
  query: 'q',
  depth: 100,
  fetchedAt: '2026-10-13T00:00:00.000Z',
  items,
  cost,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSelectIn.mockResolvedValue({ data: [], error: null })
  mockUpsert.mockResolvedValue({ data: [{ id: '1' }], error: null })
})

describe('parseWatchKeywords', () => {
  it('returns [] for null / string / object without the key / non-array value', () => {
    expect(parseWatchKeywords(null)).toEqual([])
    expect(parseWatchKeywords('x')).toEqual([])
    expect(parseWatchKeywords({})).toEqual([])
    expect(parseWatchKeywords({ rank_watch_keywords: 'a' })).toEqual([])
  })

  it('trims, lowercases, collapses whitespace, drops non-strings/empties and dedupes', () => {
    const result = parseWatchKeywords({
      rank_watch_keywords: ['  Guilin ', 'SILK  road', 'guilin', 5, '', null],
    })
    expect(result).toEqual(['guilin', 'silk road'])
  })

  it('caps at 10 distinct keywords', () => {
    const raw = Array.from({ length: 12 }, (_, i) => `kw ${i}`)
    const result = parseWatchKeywords({ rank_watch_keywords: raw })
    expect(result).toHaveLength(10)
    expect(result).toEqual(raw.slice(0, 10))
  })
})

describe('readOwnDomainRank', () => {
  it('picks the best own-domain rankGroup (not rankAbsolute) and its url', () => {
    const snapshot = snap([
      { domain: 'other.com', url: 'https://other.com/a', rankGroup: 1, rankAbsolute: 1 },
      { domain: 'www.example.co.nz', url: 'https://www.example.co.nz/low', rankGroup: 31, rankAbsolute: 40 },
      { domain: 'www.example.co.nz', url: 'https://www.example.co.nz/best', rankGroup: 14, rankAbsolute: 22 },
    ])
    const reading = readOwnDomainRank(snapshot, 'example.co.nz', 'alpha trip')
    expect(reading.status).toBe('ranked')
    expect(reading.position).toBe(14)
    expect(reading.url).toBe('https://www.example.co.nz/best')
  })

  it('returns not_in_top_100 with null position when no own-domain item exists', () => {
    const snapshot = snap([
      { domain: 'other.com', url: 'https://other.com/a', rankGroup: 1, rankAbsolute: 1 },
    ])
    const reading = readOwnDomainRank(snapshot, 'example.co.nz', 'alpha trip')
    expect(reading.status).toBe('not_in_top_100')
    expect(reading.position).toBeNull()
    expect(reading.url).toBeNull()
  })

  it('matches own domain when item.domain is null and only url carries www', () => {
    const snapshot = snap([
      { domain: null, url: 'https://www.example.co.nz/page', rankGroup: 7, rankAbsolute: 9 },
    ])
    const reading = readOwnDomainRank(snapshot, 'example.co.nz', 'alpha trip')
    expect(reading.status).toBe('ranked')
    expect(reading.position).toBe(7)
    expect(reading.url).toBe('https://www.example.co.nz/page')
  })
})

describe('buildWatchSnapshotRows', () => {
  it('skips fetch_failed, keeps null position, sets location_code 2554 and snapshot_date', () => {
    const measuredAt = new Date('2026-08-03T05:00:00.000Z')
    const readings: WatchRankReading[] = [
      { keyword: 'alpha trip', status: 'ranked', position: 14, url: 'https://www.example.co.nz/a', cost: 0.002 },
      { keyword: 'beta route', status: 'not_in_top_100', position: null, url: null, cost: 0.002 },
      { keyword: 'gamma tour', status: 'fetch_failed', position: null, url: null, cost: null, error: 'boom' },
    ]

    const rows = buildWatchSnapshotRows(CLIENT, readings, measuredAt)

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.keyword)).toEqual(['alpha trip', 'beta route'])

    const ranked = rows[0]
    expect(ranked.position).toBe(14)
    expect(ranked.location_code).toBe(2554)
    expect(ranked.snapshot_date).toBe('2026-08-03')
    expect(ranked.search_volume).toBeNull()
    expect(ranked.keyword_difficulty).toBeNull()

    const notInTop = rows[1]
    expect(notInTop.position).toBeNull()
    expect(notInTop.location_code).toBe(2554)
    expect(notInTop.snapshot_date).toBe('2026-08-03')
  })
})

describe('snapshotWatchedKeywordsForClient', () => {
  it('returns empty without any SERP or supabase call when there are no keywords', async () => {
    const result = await snapshotWatchedKeywordsForClient(CLIENT, [])
    expect(result.keywords_requested).toBe(0)
    expect(result.rows_written).toBe(0)
    expect(mockGetOrganicRanks).not.toHaveBeenCalled()
    expect(mockSelectIn).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('dry run fetches each keyword at depth 100, touches no DB, sums costs', async () => {
    mockGetOrganicRanks
      .mockResolvedValueOnce(snap([], 0.002))
      .mockResolvedValueOnce(snap([], 0.003))

    const result = await snapshotWatchedKeywordsForClient(CLIENT, ['alpha trip', 'beta route'], {
      dryRun: true,
    })

    expect(mockGetOrganicRanks).toHaveBeenCalledTimes(2)
    expect(mockGetOrganicRanks).toHaveBeenNthCalledWith(1, 'alpha trip', 'nz', { depth: 100 })
    expect(mockGetOrganicRanks).toHaveBeenNthCalledWith(2, 'beta route', 'nz', { depth: 100 })
    expect(mockSelectIn).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(result.rows_written).toBe(0)
    expect(result.cost_usd).toBeCloseTo(0.005)
  })

  it('skips keywords already snapshotted today and upserts the rest', async () => {
    mockSelectIn.mockResolvedValueOnce({ data: [{ keyword: 'alpha trip' }], error: null })
    mockGetOrganicRanks.mockResolvedValueOnce(snap([], 0.002))

    const result = await snapshotWatchedKeywordsForClient(CLIENT, ['alpha trip', 'beta route'])

    expect(result.skipped_already_snapshotted).toEqual(['alpha trip'])
    expect(mockGetOrganicRanks).toHaveBeenCalledTimes(1)
    expect(mockGetOrganicRanks).toHaveBeenCalledWith('beta route', 'nz', { depth: 100 })

    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = mockUpsert.mock.calls[0] as [Array<{ keyword: string }>, { onConflict: string }]
    expect(opts.onConflict).toBe('client_id,keyword,location_code,snapshot_date')
    expect(rows.map((r) => r.keyword)).toEqual(['beta route'])
    expect(result.rows_written).toBe(1)
  })

  it('records a fetch_failed reading with no row while the other keyword still gets a row', async () => {
    mockSelectIn.mockResolvedValueOnce({ data: [], error: null })
    mockGetOrganicRanks
      .mockRejectedValueOnce(new Error('DataForSEO SERP error: 500'))
      .mockResolvedValueOnce(snap([], 0.002))

    const result = await snapshotWatchedKeywordsForClient(CLIENT, ['alpha trip', 'beta route'])

    const failed = result.readings.find((r) => r.keyword === 'alpha trip')
    expect(failed?.status).toBe('fetch_failed')
    expect(failed?.error).toContain('500')

    const [rows] = mockUpsert.mock.calls[0] as [Array<{ keyword: string }>, { onConflict: string }]
    expect(rows.map((r) => r.keyword)).toEqual(['beta route'])
    expect(result.rows_written).toBe(1)
  })

  it('rejects when the upsert fails', async () => {
    mockSelectIn.mockResolvedValueOnce({ data: [], error: null })
    mockGetOrganicRanks.mockResolvedValueOnce(snap([], 0.002))
    mockUpsert.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })

    await expect(
      snapshotWatchedKeywordsForClient(CLIENT, ['alpha trip']),
    ).rejects.toThrow(/keyword_snapshots watch upsert failed/)
  })
})
