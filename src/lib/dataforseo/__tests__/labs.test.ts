import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getKeywordsForSite } from '../labs'

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
