import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getKeywordsForSite, getKeywordIdeas } from '../labs'

vi.mock('@/lib/validation-utils', () => ({ validateEnvVar: () => 'test' }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockItems(items: unknown[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ tasks: [{ result: [{ items }] }] }),
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
