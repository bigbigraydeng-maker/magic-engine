/**
 * captureSerpForClient orchestration tests — upsert / local_pack_rank 回写
 * 的失败语义与日期键（魏征 🔴2/🟡5 复审补齐）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetLatestSnapshot, mockGetSerpPage, mockUpsert, mockUpdateIn } = vi.hoisted(() => ({
  mockGetLatestSnapshot: vi.fn(),
  mockGetSerpPage: vi.fn(),
  mockUpsert: vi.fn(),
  mockUpdateIn: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'serp_ai_overview_snapshots') {
        return { upsert: vi.fn((rows: unknown) => ({ select: () => mockUpsert(rows) })) }
      }
      if (table === 'keyword_snapshots') {
        return {
          update: vi.fn((patch: unknown) => ({
            eq: () => ({
              eq: () => ({
                eq: (_col: string, snapshotDate: string) => ({
                  in: (_kwCol: string, kws: string[]) => mockUpdateIn({ patch, snapshotDate, kws }),
                }),
              }),
            }),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  },
}))

vi.mock('@/lib/dataforseo/serp', () => ({
  getSerpPage: mockGetSerpPage,
}))

vi.mock('../keyword-snapshots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../keyword-snapshots')>()
  return { ...actual, getLatestKeywordSnapshotForClient: mockGetLatestSnapshot }
})

import { captureSerpForClient, type SerpCaptureClient } from '../serp-capture'

const CLIENT: SerpCaptureClient = {
  id: 'client-cts',
  domain: 'ctstours.co.nz',
  semrush_db: 'nz',
  name: 'CTS Tours NZ',
  brand_aliases: ['cts tours'],
}

const kwRow = (keyword: string) => ({
  keyword,
  position: 5,
  search_volume: 100,
  keyword_difficulty: 20,
  cpc: null,
  competition: null,
  intent: 'informational',
  local_pack_rank: null,
})

const serpWithPack = {
  query: 'q',
  organic_results: [],
  paid_advertiser_domains: [],
  ai_overview_text: null,
  ai_overview_sources: [],
  local_pack: [
    { name: 'CTS Tours', domain: 'ctstours.co.nz', rating: null, review_count: null, address: null },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsert.mockResolvedValue({ data: [{ id: '1' }], error: null })
  mockUpdateIn.mockResolvedValue({ error: null })
})

describe('captureSerpForClient', () => {
  it('returns zeros without firing SERP calls when snapshot is empty', async () => {
    mockGetLatestSnapshot.mockResolvedValueOnce({
      domain: CLIENT.domain, snapshot_date: null, keywords: [],
    })
    const result = await captureSerpForClient(CLIENT)
    expect(result.keywords_captured).toBe(0)
    expect(mockGetSerpPage).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('writes snapshot rows and local_pack_rank keyed by the SNAPSHOT date, not today', async () => {
    mockGetLatestSnapshot.mockResolvedValueOnce({
      domain: CLIENT.domain,
      snapshot_date: '2026-07-27', // 上周快照 —— 步 1 本周 0 词的场景
      keywords: [kwRow('china tours auckland'), kwRow('china travel agency')],
    })
    mockGetSerpPage.mockResolvedValue(serpWithPack)

    const result = await captureSerpForClient(CLIENT)

    expect(result.keywords_captured).toBe(2)
    expect(result.serp_rows_written).toBe(1) // mockUpsert 返回 1 行
    expect(result.local_pack_hits).toBe(2)
    expect(result.keywords_failed).toBe(0)

    const upsertedRows = mockUpsert.mock.calls[0][0] as Array<{ snapshot_date: string }>
    expect(upsertedRows.every(r => r.snapshot_date === '2026-07-27')).toBe(true)
    expect(mockUpdateIn).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotDate: '2026-07-27', patch: { local_pack_rank: 1 } }),
    )
  })

  it('single keyword SERP failures are counted, not fatal', async () => {
    mockGetLatestSnapshot.mockResolvedValueOnce({
      domain: CLIENT.domain,
      snapshot_date: '2026-08-03',
      keywords: [kwRow('kw-ok'), kwRow('kw-bad')],
    })
    mockGetSerpPage
      .mockResolvedValueOnce({ ...serpWithPack, local_pack: undefined })
      .mockRejectedValueOnce(new Error('DataForSEO SERP error: 500'))

    const result = await captureSerpForClient(CLIENT)
    expect(result.keywords_captured).toBe(1)
    expect(result.keywords_failed).toBe(1)
    expect(result.local_pack_hits).toBe(0)
    expect(mockUpdateIn).not.toHaveBeenCalled()
  })

  it('throws when the snapshot upsert fails (data must not be silently lost)', async () => {
    mockGetLatestSnapshot.mockResolvedValueOnce({
      domain: CLIENT.domain,
      snapshot_date: '2026-08-03',
      keywords: [kwRow('kw')],
    })
    mockGetSerpPage.mockResolvedValue(serpWithPack)
    mockUpsert.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })

    await expect(captureSerpForClient(CLIENT)).rejects.toThrow(/upsert failed/)
  })

  it('throws when the local_pack_rank update fails', async () => {
    mockGetLatestSnapshot.mockResolvedValueOnce({
      domain: CLIENT.domain,
      snapshot_date: '2026-08-03',
      keywords: [kwRow('kw')],
    })
    mockGetSerpPage.mockResolvedValue(serpWithPack)
    mockUpdateIn.mockResolvedValueOnce({ error: { message: 'timeout' } })

    await expect(captureSerpForClient(CLIENT)).rejects.toThrow(/local_pack_rank update failed/)
  })
})
