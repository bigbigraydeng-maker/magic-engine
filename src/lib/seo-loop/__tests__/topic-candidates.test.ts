import { describe, it, expect } from 'vitest'
import { selectTopicCandidates } from '../topic-candidates'
import type { OpportunityGapRow, StrikingDistanceRow } from '../comparisons'

const gapRow = (keyword: string, volume = 500): OpportunityGapRow => ({
  keyword,
  search_volume: volume,
  keyword_difficulty: 10,
  intent: 'informational',
  competitor_positions: { 'wendywutours.co.nz': 3 },
  competitor_count: 1,
  best_competitor_position: 3,
})

const strikingRow = (keyword: string, position = 14): StrikingDistanceRow => ({
  keyword, position, search_volume: 1600, keyword_difficulty: 29,
})

describe('selectTopicCandidates', () => {
  it('fills from the opportunity gap first', () => {
    const out = selectTopicCandidates({
      gap: [gapRow('a'), gapRow('b'), gapRow('c'), gapRow('d')],
      striking: [strikingRow('s')],
    })
    expect(out).toHaveLength(3)
    expect(out.map(c => c.source)).toEqual(
      ['opportunity_gap', 'opportunity_gap', 'opportunity_gap'],
    )
  })

  it('falls through to striking distance when the gap runs out', () => {
    const out = selectTopicCandidates({
      gap: [gapRow('a')],
      striking: [strikingRow('s1'), strikingRow('s2')],
    })
    expect(out.map(c => c.source)).toEqual(
      ['opportunity_gap', 'striking_distance', 'striking_distance'],
    )
  })

  it('falls through to AI visibility last', () => {
    const out = selectTopicCandidates({
      gap: [], striking: [],
      aiGaps: [{ question: 'best china tour from nz', brand_rank: null, keyword_difficulty: 5 }],
    })
    expect(out.map(c => c.source)).toEqual(['ai_visibility_gap'])
  })

  it('numbers priority from 1 in output order', () => {
    const out = selectTopicCandidates({
      gap: [gapRow('a')], striking: [strikingRow('s')],
    })
    expect(out.map(c => c.priority)).toEqual([1, 2])
  })

  it('never returns more than the limit', () => {
    const out = selectTopicCandidates(
      { gap: [gapRow('a'), gapRow('b'), gapRow('c'), gapRow('d')], striking: [] },
      2,
    )
    expect(out).toHaveLength(2)
  })

  it('deduplicates a keyword that appears in two sources', () => {
    const out = selectTopicCandidates({
      gap: [gapRow('overlap')],
      striking: [strikingRow('overlap')],
    })
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('opportunity_gap')
  })

  it('excludes AI candidates above the difficulty ceiling', () => {
    const out = selectTopicCandidates({
      gap: [], striking: [],
      aiGaps: [{ question: 'too hard', brand_rank: null, keyword_difficulty: 80 }],
    })
    expect(out).toEqual([])
  })

  it('keeps AI candidates with unknown difficulty', () => {
    const out = selectTopicCandidates({
      gap: [], striking: [],
      aiGaps: [{ question: 'unknown kd', brand_rank: null }],
    })
    expect(out).toHaveLength(1)
  })

  it('records my_position as null for gap keywords and a number for striking', () => {
    const out = selectTopicCandidates({
      gap: [gapRow('g')], striking: [strikingRow('s', 14)],
    })
    expect(out[0].my_position).toBeNull()
    expect(out[1].my_position).toBe(14)
  })

  it('names the competitors that rank, strongest first', () => {
    const row = gapRow('g')
    row.competitor_positions = { 'slow.com': 9, 'fast.com': 2 }
    row.competitor_count = 2
    const [candidate] = selectTopicCandidates({ gap: [row], striking: [] })
    expect(candidate.competitors_ranking).toEqual(['fast.com', 'slow.com'])
    expect(candidate.reason).toContain('fast.com 第 2 名')
  })

  it('explains a not-mentioned AI gap differently from a low-ranked one', () => {
    const [notMentioned] = selectTopicCandidates({
      gap: [], striking: [], aiGaps: [{ question: 'q1', brand_rank: null }],
    })
    const [lowRanked] = selectTopicCandidates({
      gap: [], striking: [], aiGaps: [{ question: 'q2', brand_rank: 7 }],
    })
    expect(notMentioned.reason).toContain('完全没提到我们')
    expect(lowRanked.reason).toContain('第 7 位')
  })

  it('returns an empty list when there is nothing to suggest', () => {
    expect(selectTopicCandidates({ gap: [], striking: [] })).toEqual([])
  })
})
