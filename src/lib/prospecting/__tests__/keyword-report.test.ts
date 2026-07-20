import { describe, it, expect, vi, beforeEach } from 'vitest'

const getKeywordsForSite = vi.fn()
vi.mock('@/lib/dataforseo/labs', () => ({
  getKeywordsForSite: (...a: unknown[]) => getKeywordsForSite(...a),
}))

import { buildKeywordReport, difficultyBand } from '../keyword-report'

beforeEach(() => getKeywordsForSite.mockReset())

describe('difficultyBand', () => {
  it('bands DataForSEO 0–100 difficulty; null → medium', () => {
    expect(difficultyBand(null)).toBe('medium')
    expect(difficultyBand(0)).toBe('easy')
    expect(difficultyBand(29)).toBe('easy')
    expect(difficultyBand(30)).toBe('medium')
    expect(difficultyBand(59)).toBe('medium')
    expect(difficultyBand(60)).toBe('hard')
    expect(difficultyBand(100)).toBe('hard')
  })
})

describe('buildKeywordReport', () => {
  it('null domain → [] and never calls the paid API', async () => {
    expect(await buildKeywordReport(null, 'NZ')).toEqual([])
    expect(getKeywordsForSite).not.toHaveBeenCalled()
  })

  it('maps to a client-safe shape, drops zero/null volume, caps at limit, NZ location', async () => {
    getKeywordsForSite.mockResolvedValue([
      { keyword: 'kitchen renovation auckland', search_volume: 880, keyword_difficulty: 25 },
      { keyword: 'no volume', search_volume: 0, keyword_difficulty: 10 },
      { keyword: 'null volume', search_volume: null, keyword_difficulty: 10 },
      { keyword: 'bathroom reno cost', search_volume: 320, keyword_difficulty: 70 },
    ])
    const r = await buildKeywordReport('kaurikitchens.co.nz', 'NZ', 2)
    expect(r).toEqual([
      { phrase: 'kitchen renovation auckland', volume: 880, difficulty: 'easy' },
      { phrase: 'bathroom reno cost', volume: 320, difficulty: 'hard' },
    ])
    expect(getKeywordsForSite).toHaveBeenCalledWith('kaurikitchens.co.nz', 2554, 40) // NZ=2554
  })

  it('degrades to [] when the data source throws (e.g. DataForSEO 402)', async () => {
    getKeywordsForSite.mockImplementationOnce(() => { throw new Error('DataForSEO Labs keywords_for_site error: 402') })
    expect(await buildKeywordReport('x.co.nz', 'AU')).toEqual([])
  })
})
