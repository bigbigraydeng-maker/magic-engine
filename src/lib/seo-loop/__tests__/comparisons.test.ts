import { describe, it, expect } from 'vitest'
import {
  buildHeadToHead,
  buildOpportunityGap,
  buildStrikingDistance,
  type RankedKeyword,
} from '../comparisons'

const kw = (
  keyword: string,
  position: number | null,
  search_volume: number | null = 100,
  keyword_difficulty: number | null = 10,
): RankedKeyword => ({ keyword, position, search_volume, keyword_difficulty })

describe('buildHeadToHead', () => {
  it('only returns keywords where at least one competitor also ranks', () => {
    const rows = buildHeadToHead(
      [kw('china tours', 10), kw('cts auckland', 1)],
      { 'wendywutours.co.nz': [kw('china tours', 1)] },
    )
    expect(rows.map(r => r.keyword)).toEqual(['china tours'])
  })

  it('marks us behind when the competitor sits higher', () => {
    // Real CTS row: we are 10th for "china tours", Wendy Wu is 1st.
    const [row] = buildHeadToHead(
      [kw('china tours', 10, 260)],
      { 'wendywutours.co.nz': [kw('china tours', 1, 260)] },
    )
    expect(row.verdict).toBe('behind')
    expect(row.best_competitor_domain).toBe('wendywutours.co.nz')
    expect(row.best_competitor_position).toBe(1)
  })

  it('marks us ahead when we sit higher', () => {
    // Real CTS row: we are 1st for "china travel", Wendy Wu 7th.
    const [row] = buildHeadToHead(
      [kw('china travel', 1, 260)],
      { 'wendywutours.co.nz': [kw('china travel', 7, 260)] },
    )
    expect(row.verdict).toBe('ahead')
  })

  it('marks a tie when positions are equal', () => {
    const [row] = buildHeadToHead([kw('x', 5)], { 'a.com': [kw('x', 5)] })
    expect(row.verdict).toBe('tied')
  })

  it('treats an unranked own position as behind', () => {
    const [row] = buildHeadToHead([kw('x', null)], { 'a.com': [kw('x', 5)] })
    expect(row.verdict).toBe('behind')
  })

  it('picks the strongest competitor across several domains', () => {
    const [row] = buildHeadToHead(
      [kw('japan tours', 36, 590)],
      {
        'wendywutours.co.nz': [kw('japan tours', 2, 590)],
        'worldjourneys.co.nz': [kw('japan tours', 7, 590)],
      },
    )
    expect(row.best_competitor_position).toBe(2)
    expect(row.competitor_positions).toEqual({
      'wendywutours.co.nz': 2, 'worldjourneys.co.nz': 7,
    })
  })

  it('sorts by search volume descending', () => {
    const rows = buildHeadToHead(
      [kw('small', 5, 50), kw('big', 5, 5000)],
      { 'a.com': [kw('small', 1, 50), kw('big', 1, 5000)] },
    )
    expect(rows.map(r => r.keyword)).toEqual(['big', 'small'])
  })

  it('keeps the strongest position when a domain ranks twice for one keyword', () => {
    const [row] = buildHeadToHead(
      [kw('x', 9)],
      { 'a.com': [kw('x', 12), kw('x', 3)] },
    )
    expect(row.best_competitor_position).toBe(3)
  })

  it('ignores competitors with a null position', () => {
    expect(buildHeadToHead([kw('x', 5)], { 'a.com': [kw('x', null)] })).toEqual([])
  })
})

describe('buildOpportunityGap', () => {
  it('returns only keywords the competitor ranks for and we do not', () => {
    const rows = buildOpportunityGap(
      [kw('china tours', 10)],
      { 'a.com': [kw('china tours', 1), kw('vietnam tours', 2, 390)] },
    )
    expect(rows.map(r => r.keyword)).toEqual(['vietnam tours'])
  })

  it('ranks a keyword held by more competitors above a higher-volume one', () => {
    const rows = buildOpportunityGap([], {
      'a.com': [kw('shared', 3, 110), kw('solo', 1, 5000)],
      'b.com': [kw('shared', 5, 110)],
    })
    expect(rows[0].keyword).toBe('shared')
    expect(rows[0].competitor_count).toBe(2)
    expect(rows[0].best_competitor_position).toBe(3)
  })

  it('drops keywords below the volume floor', () => {
    const rows = buildOpportunityGap([], { 'a.com': [kw('thin', 1, 10)] })
    expect(rows).toEqual([])
  })

  it('honours a custom volume floor', () => {
    const rows = buildOpportunityGap(
      [], { 'a.com': [kw('thin', 1, 10)] }, { minVolume: 5 },
    )
    expect(rows.map(r => r.keyword)).toEqual(['thin'])
  })

  it('applies the eligibility gate', () => {
    // The gate is what keeps "carpet court" (a competitor brand) and
    // off-business categories out of the topic pipeline.
    const rows = buildOpportunityGap(
      [],
      { 'a.com': [kw('carpet court', 1, 27100), kw('hybrid flooring', 1, 590)] },
      { isEligible: k => k !== 'carpet court' },
    )
    expect(rows.map(r => r.keyword)).toEqual(['hybrid flooring'])
  })

  it('merges the same keyword across competitors instead of duplicating it', () => {
    const rows = buildOpportunityGap([], {
      'a.com': [kw('shared', 4, 300)],
      'b.com': [kw('shared', 2, 300)],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].competitor_positions).toEqual({ 'a.com': 4, 'b.com': 2 })
    expect(rows[0].best_competitor_position).toBe(2)
  })

  it('matches our keywords case-insensitively so we do not re-suggest them', () => {
    const rows = buildOpportunityGap(
      [kw('China Tours', 10)],
      { 'a.com': [kw('china tours', 1, 500)] },
    )
    expect(rows).toEqual([])
  })

  it('backfills difficulty from a later competitor when the first lacks it', () => {
    const rows = buildOpportunityGap([], {
      'a.com': [kw('shared', 4, 300, null)],
      'b.com': [kw('shared', 2, 300, 42)],
    })
    expect(rows[0].keyword_difficulty).toBe(42)
  })
})

describe('buildStrikingDistance', () => {
  it('returns only positions 11 to 20 inclusive', () => {
    const rows = buildStrikingDistance([
      kw('page-one', 10), kw('edge-low', 11),
      kw('edge-high', 20), kw('too-deep', 21),
    ])
    expect(rows.map(r => r.keyword).sort()).toEqual(['edge-high', 'edge-low'])
  })

  it('sorts by volume descending', () => {
    const rows = buildStrikingDistance([kw('small', 12, 50), kw('big', 15, 2400)])
    expect(rows.map(r => r.keyword)).toEqual(['big', 'small'])
  })

  it('ignores unranked keywords', () => {
    expect(buildStrikingDistance([kw('x', null)])).toEqual([])
  })

  it('honours custom bounds', () => {
    const rows = buildStrikingDistance([kw('x', 5)], 4, 6)
    expect(rows.map(r => r.keyword)).toEqual(['x'])
  })
})
