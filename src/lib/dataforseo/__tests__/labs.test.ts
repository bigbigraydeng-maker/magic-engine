import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DataForSeoTaskError,
  getDomainMetrics,
  getKeywordsForSite,
  getKeywordIdeas,
  bulkKeywordVolume,
} from '../labs'

vi.mock('@/lib/validation-utils', () => ({ validateEnvVar: () => 'test' }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockItems(items: unknown[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ tasks: [{ status_code: 20000, result: [{ items }] }] }),
  } as Response)
}

describe('getKeywordsForSite — real parser (no mock of the fn itself)', () => {
  beforeEach(() => mockFetch.mockReset())

  // Regression guard: a 2026 bulk edit read a nested `it.keyword_data` the API
  // never returns, so this silently returned [] (hidden by ignoreBuildErrors).
  // Feed the real FLAT keywords_for_site shape and assert it actually maps.
  it('maps the flat keywords_for_site items (NOT [])', async () => {
    mockFetch.mockReturnValue(mockItems([
      { keyword: 'kitchen renovation auckland', keyword_info: { search_volume: 880, cpc: 4.2, competition: 0.5 }, keyword_properties: { keyword_difficulty: 25 } },
      { keyword: 'bathroom reno cost',          keyword_info: { search_volume: 320, cpc: null, competition: null }, keyword_properties: { keyword_difficulty: 70 } },
    ]))

    const r = await getKeywordsForSite('kaurikitchens.co.nz', 2554, 40)

    expect(r).toHaveLength(2) // the whole point — a nested-read regression makes this 0
    expect(r[0]).toMatchObject({ keyword: 'kitchen renovation auckland', search_volume: 880, keyword_difficulty: 25 })
    expect(r[1]).toMatchObject({ keyword: 'bathroom reno cost', search_volume: 320, keyword_difficulty: 70 })
  })

  it('throws on a non-ok response so callers (buildKeywordReport) can degrade', async () => {
    mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 402 } as Response))
    await expect(getKeywordsForSite('x.co.nz', 2036)).rejects.toThrow('402')
  })
})

describe('getKeywordIdeas — real parser (no mock of the fn itself)', () => {
  beforeEach(() => mockFetch.mockReset())

  // Same guard as above, for the sibling endpoint: its response type USED to
  // declare a nested `keyword_data` the API never returns. The type was wrong
  // and the reads were flat, so only tsc complained — nothing would have caught
  // the reverse mistake (nested reads) at runtime. Lock the flat shape.
  it('maps the flat keyword_ideas items (NOT [])', async () => {
    mockFetch.mockReturnValue(mockItems([
      { keyword: 'spc flooring brisbane', keyword_info: { search_volume: 590, cpc: 3.1, competition: 0.4 }, keyword_properties: { keyword_difficulty: 18 }, search_intent_info: { main_intent: 'commercial' } },
      { keyword: 'hybrid flooring price',  keyword_info: { search_volume: 210, cpc: null, competition: null }, keyword_properties: { keyword_difficulty: 44 } },
    ]))

    const r = await getKeywordIdeas('spc flooring', 2036, 15)

    expect(r).toHaveLength(2) // a nested-read regression makes this 0
    expect(r[0]).toMatchObject({ keyword: 'spc flooring brisbane', search_volume: 590, keyword_difficulty: 18, cpc: 3.1 })
    expect(r[1]).toMatchObject({ keyword: 'hybrid flooring price', search_volume: 210, keyword_difficulty: 44 })
  })

  it('filters to question-form keywords when questionsOnly is set', async () => {
    mockFetch.mockReturnValue(mockItems([
      { keyword: 'how to lay spc flooring', keyword_info: { search_volume: 140, cpc: null, competition: null } },
      { keyword: 'spc flooring brisbane',   keyword_info: { search_volume: 590, cpc: null, competition: null } },
    ]))

    const r = await getKeywordIdeas('spc flooring', 2036, 15, true)

    expect(r).toHaveLength(1)
    expect(r[0].keyword).toBe('how to lay spc flooring')
  })

  it('throws on a non-ok response so callers can degrade', async () => {
    mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 402 } as Response))
    await expect(getKeywordIdeas('spc flooring', 2036)).rejects.toThrow('402')
  })
})

describe('bulkKeywordVolume — 端点必须是真实存在的那个', () => {
  beforeEach(() => mockFetch.mockReset())

  // 2026-08-26 实测：原来打的 bulk_keyword_search_volume 在 DataForSEO 恒定 404，
  // 而唯一调用方把它包在空 catch 里，于是"静默永远失败"——历史上每份 discovery
  // 报告的关键词 volume/KD/CPC 全是 null。这条锁住端点，别再改回去。
  it('打的是 keyword_overview，不是那个不存在的 bulk_keyword_search_volume', async () => {
    mockFetch.mockReturnValue(mockItems([
      { keyword: 'hbay water', keyword_info: { search_volume: 260, cpc: 0.08, competition: 0.2 }, keyword_properties: { keyword_difficulty: 12 } },
    ]))

    await bulkKeywordVolume(['hbay water'], 2554)

    const url = String(mockFetch.mock.calls[0][0])
    expect(url).toContain('/dataforseo_labs/google/keyword_overview/live')
    expect(url).not.toContain('bulk_keyword_search_volume')
  })

  // keyword_overview 把难度放在 keyword_properties 下，不是顶层。
  // 读错层级不会报错，只会让 KD 静默变成 null —— 正是本次要修的那类毛病。
  it('难度从 keyword_properties 读，不是顶层', async () => {
    mockFetch.mockReturnValue(mockItems([
      { keyword: 'bottled water nz', keyword_info: { search_volume: 320, cpc: 0.45, competition: 0.7 }, keyword_properties: { keyword_difficulty: 34 } },
    ]))

    const r = await bulkKeywordVolume(['bottled water nz'], 2554)

    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ keyword: 'bottled water nz', search_volume: 320, keyword_difficulty: 34, cpc: 0.45 })
  })

  it('空数组直接返回，不发请求', async () => {
    const r = await bulkKeywordVolume([], 2554)
    expect(r).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // 2026-08-28 Codex #1187：HTTP 200 + task-level 40210（余额耗尽）会被
  // 老代码解释成"响应正常但没关键词"，静默返回 []。锁住严格抛错行为。
  it('抛出 task 级错误而不是静默返回 []（余额耗尽/参数无效场景）', async () => {
    mockFetch.mockReturnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        tasks: [{
          status_code: 40210,
          status_message: 'You have exhausted your account credits',
        }],
      }),
    } as Response))
    const promise = bulkKeywordVolume(['test'])
    await expect(promise).rejects.toThrow(/40210/)
    await expect(promise).rejects.toBeInstanceOf(DataForSeoTaskError)
    await expect(promise).rejects.toMatchObject({ errorCode: 40210 })
  })

  // 严格路径决策的锁：畸形响应（网关抢答、代理裁剪）里 status_code 缺失
  // 也必须抛错，不能因为 undefined 被解释成"成功但空"。
  it('task-status 字段缺失时也抛错（畸形响应场景，锁死"选严格路径"决策）', async () => {
    mockFetch.mockReturnValue(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ tasks: [{}] }),
    } as Response))
    await expect(bulkKeywordVolume(['test'])).rejects.toThrow(/missing/)
  })
})

describe('getDomainMetrics — provider failures are not zeros', () => {
  beforeEach(() => mockFetch.mockReset())

  const overviewResponse = {
    ok: true,
    json: () => Promise.resolve({
      tasks: [{ status_code: 20000, result: [{ items: [{ metrics: { organic: { count: 12, etv: 340 } } }] }] }],
    }),
  } as Response
  const rankResponse = {
    ok: true,
    json: () => Promise.resolve({ tasks: [{ result: [{ rank: 420 }] }] }),
  } as Response

  it('throws when the domain overview provider fails instead of returning zero metrics', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 503 } as Response))
    mockFetch.mockReturnValueOnce(Promise.resolve(rankResponse))

    await expect(getDomainMetrics('example.com')).rejects.toThrow('domain overview unavailable')
  })

  it('throws when the backlink provider fails instead of returning authority_score zero', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve(overviewResponse))
    mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 429 } as Response))

    await expect(getDomainMetrics('example.com')).rejects.toThrow('backlink rank unavailable')
  })

  it('throws on an HTTP 200 task-level error (e.g. 40210) instead of returning 0/0', async () => {
    mockFetch.mockReturnValueOnce(Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ tasks: [{ status_code: 40210, status_message: 'Insufficient funds' }] }),
    } as Response))
    mockFetch.mockReturnValueOnce(Promise.resolve(rankResponse))

    await expect(getDomainMetrics('example.com')).rejects.toThrow('task error 40210')
  })
})
