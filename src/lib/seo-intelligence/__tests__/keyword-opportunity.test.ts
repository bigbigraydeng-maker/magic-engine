import { describe, expect, it } from 'vitest'
import type { LabsKeyword } from '@/lib/dataforseo/labs-types'
import {
  MAX_SEEDS,
  bandOf,
  buildOpportunityRows,
  estimateMaxCostUsd,
  pickSeeds,
  summariseOpportunity,
} from '../keyword-opportunity'
import type { ExcludedCounts, OwnRank, SeedIdeas } from '../keyword-opportunity'

const idea = (
  keyword: string,
  search_volume: number | null,
  keyword_difficulty: number | null = 20,
  intent = 'commercial',
  cpc: number | null = 1.5,
): LabsKeyword => ({ keyword, search_volume, keyword_difficulty, cpc, competition: null, intent })

const seed = (name: string, ideas: LabsKeyword[], status: SeedIdeas['status'] = 'ok'): SeedIdeas => ({ seed: name, status, ideas })

const opts = { brandRoot: 'ctstours', brandAliases: ['cts'], competitorDomains: ['wendywutours.co.nz'] }

const noExcluded = (): ExcludedCounts => ({ brand: 0, competitorBrand: 0, noVolume: 0, lowVolume: 0 })

describe('pickSeeds', () => {
  it('trims, drops empty / non-string / over-long items, de-dupes case-insensitively and caps at MAX_SEEDS', () => {
    const raw = [
      '  china visa  ',
      '',
      '   ',
      42,
      null,
      'x'.repeat(81),
      'CHINA VISA',
      'nz tours',
      ...Array.from({ length: 20 }, (_, i) => `seed ${i}`),
    ]
    const seeds = pickSeeds(raw)
    expect(seeds[0]).toBe('china visa')
    expect(seeds[1]).toBe('nz tours')
    expect(seeds).toHaveLength(MAX_SEEDS)
    expect(seeds.filter(s => s.toLowerCase() === 'china visa')).toHaveLength(1)
  })

  it('returns [] for anything that is not an array', () => {
    expect(pickSeeds(null)).toEqual([])
    expect(pickSeeds('china visa')).toEqual([])
    expect(pickSeeds({ 0: 'china visa' })).toEqual([])
  })
})

describe('estimateMaxCostUsd', () => {
  it('is one call per seed plus one item per idea, rounded to 4 decimals', () => {
    expect(estimateMaxCostUsd(12, 300)).toBe(0.48)
  })
})

describe('buildOpportunityRows', () => {
  it('counts a null-volume idea as noVolume and never emits it as a row', () => {
    const { rows, excluded } = buildOpportunityRows([seed('china visa', [idea('china visa nz', null)])], [], opts)
    expect(rows).toEqual([])
    expect(excluded.noVolume).toBe(1)
  })

  it('excludes brand and competitor-brand phrases, counted separately', () => {
    const { rows, excluded } = buildOpportunityRows(
      [seed('tours', [idea('cts tours nz', 500), idea('wendy wu tours china', 500), idea('nz tour packages', 500)])],
      [],
      opts,
    )
    expect(rows.map(r => r.keyword)).toEqual(['nz tour packages'])
    expect(excluded.brand).toBe(1)
    expect(excluded.competitorBrand).toBe(1)
  })

  it('collapses re-ordered variants into one row, keeping the volume once and listing both seeds', () => {
    const results = [seed('china visa', [idea('china visa nz', 390)]), seed('nz visa', [idea('nz china visa', 390)])]
    const { rows } = buildOpportunityRows(results, [], opts)
    expect(rows).toHaveLength(1)
    expect(rows[0].volume).toBe(390)
    expect(rows[0].seeds).toEqual(['china visa', 'nz visa'])
  })

  it('drops below-minVolume phrases and honours a raised minVolume', () => {
    const results = [seed('tours', [idea('nz tour packages', 40), idea('nz tour deals', 80)])]
    const low = buildOpportunityRows(results, [], opts)
    expect(low.rows.map(r => r.keyword)).toEqual(['nz tour deals'])
    expect(low.excluded.lowVolume).toBe(1)
    const high = buildOpportunityRows(results, [], { ...opts, minVolume: 100 })
    expect(high.rows).toEqual([])
    expect(high.excluded.lowVolume).toBe(2)
  })

  it('reads ownPosition and band from the tracked snapshot, including tracked-but-not-ranking', () => {
    const results = [seed('tours', [idea('nz tour packages', 500), idea('nz tour deals', 400), idea('nz tour guides', 300)])]
    const own: OwnRank[] = [
      { keyword: 'nz tour packages', position: 18 },
      { keyword: 'nz tour deals', position: null },
    ]
    const { rows } = buildOpportunityRows(results, own, opts)
    const byKeyword = new Map(rows.map(r => [r.keyword, r]))
    expect(byKeyword.get('nz tour packages')).toMatchObject({ ownPosition: 18, band: 'p11_30' })
    expect(byKeyword.get('nz tour deals')).toMatchObject({ ownPosition: null, band: 'not_tracked' })
    expect(byKeyword.get('nz tour guides')).toMatchObject({ ownPosition: null, band: 'not_tracked' })
  })

  it('lets an error seed contribute nothing while still reporting its status', () => {
    const results = [seed('tours', [idea('nz tour packages', 500)]), seed('broken', [], 'error')]
    const { rows } = buildOpportunityRows(results, [], opts)
    expect(rows.map(r => r.keyword)).toEqual(['nz tour packages'])
    const summary = summariseOpportunity(rows, noExcluded(), results)
    expect(summary.seed_status).toEqual([
      { seed: 'tours', status: 'ok', ideas: 1 },
      { seed: 'broken', status: 'error', ideas: 0 },
    ])
  })
})

describe('bandOf', () => {
  it('maps positions to bands and null to not_tracked', () => {
    expect(bandOf(null)).toBe('not_tracked')
    expect(bandOf(3)).toBe('top3')
    expect(bandOf(10)).toBe('p4_10')
    expect(bandOf(30)).toBe('p11_30')
    expect(bandOf(31)).toBe('p31_plus')
  })
})

describe('summariseOpportunity', () => {
  it('totals volume, splits buyer vs research, keeps top_buyer out of the top 10 and orders the ceilings', () => {
    const results = [
      seed('tours', [
        idea('nz tour packages', 500, 20, 'commercial'),
        idea('nz tour deals', 400, 20, 'transactional'),
        idea('nz tour guides', 300, 20, 'informational'),
        idea('nz tour maps', 200, 20, 'informational'),
      ]),
    ]
    const own: OwnRank[] = [
      { keyword: 'nz tour packages', position: 2 },
      { keyword: 'nz tour deals', position: 18 },
    ]
    const { rows, excluded } = buildOpportunityRows(results, own, opts)
    const summary = summariseOpportunity(rows, excluded, results)

    expect(summary.rows_total).toBe(4)
    expect(summary.volume_total).toBe(1400)
    expect(summary.by_band.top3).toEqual({ keywords: 1, volume: 500 })
    expect(summary.by_band.p11_30).toEqual({ keywords: 1, volume: 400 })
    expect(summary.by_band.not_tracked).toEqual({ keywords: 2, volume: 500 })
    expect(summary.buyer).toEqual({ keywords: 2, volume: 900, not_top10_volume: 400 })
    expect(summary.research).toEqual({ keywords: 2, volume: 500, not_top10_volume: 500 })
    expect(summary.top_buyer.map(r => r.keyword)).toEqual(['nz tour deals'])
    expect(summary.top_research.map(r => r.keyword)).toEqual(['nz tour guides', 'nz tour maps'])
    expect(summary.ceiling_gain_to_p3).toBeGreaterThanOrEqual(summary.ceiling_gain_to_p5)
    expect(summary.ceiling_gain_to_p5).toBeGreaterThanOrEqual(0)
  })

  it('adds nothing to either ceiling for a row already at position 2', () => {
    const results = [seed('tours', [idea('nz tour packages', 500, 20, 'commercial')])]
    const own: OwnRank[] = [{ keyword: 'nz tour packages', position: 2 }]
    const { rows, excluded } = buildOpportunityRows(results, own, opts)
    const summary = summariseOpportunity(rows, excluded, results)
    expect(summary.ceiling_gain_to_p5).toBe(0)
    expect(summary.ceiling_gain_to_p3).toBe(0)
  })

  it('a row already on page 1 (position 8) adds nothing either — only rows outside the top 10 count as upside', () => {
    const results = [seed('tours', [idea('nz tour packages', 500, 20, 'commercial'), idea('nz tour deals', 400, 20, 'commercial')])]
    const own: OwnRank[] = [{ keyword: 'nz tour packages', position: 8 }, { keyword: 'nz tour deals', position: 18 }]
    const { rows, excluded } = buildOpportunityRows(results, own, opts)
    const onlyPage1 = summariseOpportunity(rows.filter(r => r.ownPosition === 8), excluded, results)
    expect(onlyPage1.ceiling_gain_to_p5).toBe(0)
    expect(onlyPage1.ceiling_gain_to_p3).toBe(0)
    const both = summariseOpportunity(rows, excluded, results)
    expect(both.ceiling_gain_to_p5).toBe(Math.round(400 * (0.07 - 0.012)))
  })
})
