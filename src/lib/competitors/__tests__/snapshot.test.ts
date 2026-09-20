import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'competitor_snapshots') return { insert: mockInsert }
      return {}
    }),
  },
}))

const mockGetClientCompetitorDomains = vi.fn()
vi.mock('@/lib/competitors/resolver', () => ({
  getClientCompetitorDomains: (...args: unknown[]) => mockGetClientCompetitorDomains(...args),
}))

const mockGetKeywordsForSite = vi.fn()
vi.mock('@/lib/dataforseo/labs', () => ({
  getKeywordsForSite: (...args: unknown[]) => mockGetKeywordsForSite(...args),
}))

// takeCompetitorSnapshot 导入 MAX_COMPETITOR_DOMAINS 用的是真实 watch.ts，不 mock——
// 这条断言（下面 '域名清单走 resolver...' 那条用例）本身就是在核对这个真实值有没有传对。

import { takeCompetitorSnapshot } from '../snapshot'

const CTS = 'c0000000-0000-0000-0000-000000000000'

beforeEach(() => {
  mockInsert.mockClear()
  mockGetClientCompetitorDomains.mockReset()
  mockGetKeywordsForSite.mockReset()
})

describe('takeCompetitorSnapshot', () => {
  it('域名清单走 resolver，且传的 max 跟 MAX_COMPETITOR_DOMAINS 一致（不能默认截断成 5）', async () => {
    mockGetClientCompetitorDomains.mockResolvedValue([])
    await takeCompetitorSnapshot(CTS, 'nz')
    expect(mockGetClientCompetitorDomains).toHaveBeenCalledWith(CTS, [], 50)
  })

  it('resolver 返回空域名列表 → 不打 DataForSEO、不写库，domainsScanned=0', async () => {
    mockGetClientCompetitorDomains.mockResolvedValue([])
    const outcome = await takeCompetitorSnapshot(CTS, 'nz')
    expect(outcome).toEqual({ domainsScanned: 0, keywordsWritten: 0 })
    expect(mockGetKeywordsForSite).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('按 min_volume=100 过滤，写进 competitor_snapshots 的行只带够格的关键词', async () => {
    mockGetClientCompetitorDomains.mockResolvedValue(['rival-a.co.nz', 'rival-b.co.nz'])
    mockGetKeywordsForSite.mockImplementation(async (domain: string) => {
      if (domain === 'rival-a.co.nz') {
        return [
          { keyword: 'kw-high', search_volume: 500, keyword_difficulty: 30, cpc: 1, competition: 0.5, intent: 'commercial', position: null },
          { keyword: 'kw-low', search_volume: 10, keyword_difficulty: 5, cpc: 0.5, competition: 0.2, intent: 'informational', position: null },
        ]
      }
      return [{ keyword: 'kw-mid', search_volume: 200, keyword_difficulty: 20, cpc: 0.8, competition: 0.3, intent: 'commercial', position: null }]
    })

    const outcome = await takeCompetitorSnapshot(CTS, 'nz')

    expect(outcome).toEqual({ domainsScanned: 2, keywordsWritten: 2 })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const row = mockInsert.mock.calls[0][0]
    expect(row).toMatchObject({
      client_id: CTS,
      production_package_id: null,
      competitor_domains: ['rival-a.co.nz', 'rival-b.co.nz'],
      semrush_db: 'nz',
      min_volume: 100,
      keywords_count: 2,
      units_consumed: 30, // 3 条原始结果 * 10，不是按过滤后的 2 条算
    })
    expect(row.top_keywords).toEqual([
      { keyword: 'kw-high', volume: 500, kd: 30 },
      { keyword: 'kw-mid', volume: 200, kd: 20 },
    ])
  })

  it('全部域名结果都拿到但都不够 min_volume → completed 语义交给调用方判(这里只报 keywordsWritten=0)', async () => {
    mockGetClientCompetitorDomains.mockResolvedValue(['rival-a.co.nz'])
    mockGetKeywordsForSite.mockResolvedValue([{ keyword: 'kw-low', search_volume: 5, keyword_difficulty: 1, cpc: 0.1, competition: 0.1, intent: 'informational', position: null }])

    const outcome = await takeCompetitorSnapshot(CTS, 'au')
    expect(outcome).toEqual({ domainsScanned: 1, keywordsWritten: 0 })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ keywords_count: 0, top_keywords: [] })
  })

  it('没传 db（客户没配市场）默认按 au 算，location_code 用 au 的 2036', async () => {
    mockGetClientCompetitorDomains.mockResolvedValue(['rival-a.com.au'])
    mockGetKeywordsForSite.mockResolvedValue([])

    await takeCompetitorSnapshot(CTS, null)

    expect(mockGetKeywordsForSite).toHaveBeenCalledWith('rival-a.com.au', 2036, 50)
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ semrush_db: 'au' })
  })

  it('写库失败 → 抛异常（由调用方 runOneClientWatch 转成 failed 回执，不在这里吞掉）', async () => {
    mockGetClientCompetitorDomains.mockResolvedValue(['rival-a.co.nz'])
    mockGetKeywordsForSite.mockResolvedValue([])
    mockInsert.mockResolvedValueOnce({ error: { message: 'db down' } })

    await expect(takeCompetitorSnapshot(CTS, 'nz')).rejects.toThrow('db down')
  })
})
