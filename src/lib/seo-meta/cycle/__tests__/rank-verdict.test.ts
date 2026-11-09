import { describe, expect, it } from 'vitest'
import { decideRankVerdict, type DecideInput, type StoredBaseline, type StoredRankSample } from '../rank-verdict'
import type { RankStatus } from '../rank-check'

const DEPTH = 30
const RANKED_10: StoredBaseline = { status: 'ranked', rank_group: 10, depth: DEPTH }
const UNRANKED: StoredBaseline = { status: 'not_in_top_n', rank_group: null, depth: DEPTH }

function sample(day: number, status: RankStatus, rank: number | null, depth = DEPTH): StoredRankSample {
  return {
    day: `2026-10-${String(day).padStart(2, '0')}`,
    status,
    rank_group: rank,
    url: status === 'ranked' ? 'https://example.co.nz/p' : null,
    depth,
    fetched_at: '2026-10-22T00:00:00.000Z',
    cost: 0.01,
  }
}

const ranked = (day: number, rank: number) => sample(day, 'ranked', rank)
const absent = (day: number) => sample(day, 'not_in_top_n', null)
const failed = (day: number) => sample(day, 'fetch_failed', null)

function input(overrides: Partial<DecideInput>): DecideInput {
  return { baseline: RANKED_10, samples: [], revertedAt: null, supersededByLaterChange: false, liveTitleOk: true, ...overrides }
}

function verdictOf(overrides: Partial<DecideInput>) {
  const r = decideRankVerdict(input(overrides))
  if (r.kind !== 'final') throw new Error(`expected final, got pending (${JSON.stringify(r)})`)
  return r
}

describe('decideRankVerdict — sample counting', () => {
  it('stays pending until 3 valid samples exist', () => {
    expect(decideRankVerdict(input({ samples: [ranked(22, 7), ranked(24, 7)] }))).toEqual({ kind: 'pending', valid_samples: 2, attempts: 2 })
  })

  it('does not count fetch_failed samples as valid, and does not write a verdict from the other two', () => {
    const r = decideRankVerdict(input({ samples: [ranked(22, 3), absent(24), failed(26)] }))
    expect(r).toEqual({ kind: 'pending', valid_samples: 2, attempts: 3 })
  })

  it('gives up as not_measured:fetch_failed after 5 attempts without 3 valid samples', () => {
    const r = verdictOf({ samples: [ranked(22, 3), failed(24), failed(26), absent(28), failed(30)] })
    expect(r.verdict).toBe('not_measured')
    expect(r.detail.reason).toBe('fetch_failed')
    expect(r.detail.valid_samples).toBe(2)
  })

  it('ignores samples taken at a different depth than the baseline', () => {
    const r = decideRankVerdict(input({ samples: [ranked(22, 7), ranked(24, 7), sample(26, 'ranked', 7, 10)] }))
    expect(r).toEqual({ kind: 'pending', valid_samples: 2, attempts: 3 })
  })
})

describe('decideRankVerdict — ranked baseline, ranked samples', () => {
  it('rank_moved_up needs median move >= 3 places AND the same direction on every sample', () => {
    const r = verdictOf({ samples: [ranked(22, 7), ranked(24, 6), ranked(26, 7)] })
    expect(r.verdict).toBe('rank_moved_up')
    expect(r.detail.median_delta).toBe(-3)
  })

  it('rank_moved_down mirrors it (larger rank number = worse)', () => {
    expect(verdictOf({ samples: [ranked(22, 14), ranked(24, 15), ranked(26, 14)] }).verdict).toBe('rank_moved_down')
  })

  it('a 2-place move is no_detectable_change', () => {
    const r = verdictOf({ samples: [ranked(22, 12), ranked(24, 12), ranked(26, 12)] })
    expect(r.verdict).toBe('no_detectable_change')
    expect(r.detail.median_delta).toBe(2)
  })

  it('a big median move that is NOT the same direction on all samples is no_detectable_change', () => {
    expect(verdictOf({ samples: [ranked(22, 14), ranked(24, 14), ranked(26, 9)] }).verdict).toBe('no_detectable_change')
  })

  it('a sample equal to baseline breaks direction consistency', () => {
    expect(verdictOf({ samples: [ranked(22, 7), ranked(24, 10), ranked(26, 6)] }).verdict).toBe('no_detectable_change')
  })
})

describe('decideRankVerdict — "not in the top N" is a state, not a number', () => {
  it('ranked ↔ not-ranked flipping across samples is unstable, never a move', () => {
    expect(verdictOf({ samples: [ranked(22, 7), absent(24), ranked(26, 7)] }).verdict).toBe('unstable')
  })

  it('ranked at baseline, absent on all 3 samples → dropped_out', () => {
    expect(verdictOf({ samples: [absent(22), absent(24), absent(26)] }).verdict).toBe('dropped_out')
  })

  it('absent at baseline, ranked on all 3 samples → entered_top_n', () => {
    expect(verdictOf({ baseline: UNRANKED, samples: [ranked(22, 25), ranked(24, 24), ranked(26, 26)] }).verdict).toBe('entered_top_n')
  })

  it('absent at baseline and on every sample → not_measured:never_ranked, NOT no_detectable_change', () => {
    const r = verdictOf({ baseline: UNRANKED, samples: [absent(22), absent(24), absent(26)] })
    expect(r.verdict).toBe('not_measured')
    expect(r.detail.reason).toBe('never_ranked')
  })

  it('never reports a numeric rank for an absent sample', () => {
    const r = verdictOf({ samples: [absent(22), absent(24), absent(26)] })
    expect(r.detail.sample_ranks).toEqual([null, null, null])
  })
})

describe('decideRankVerdict — rows that cannot be judged at all', () => {
  const full = [ranked(22, 7), ranked(24, 7), ranked(26, 7)]

  it('reverted row → not_measured:reverted, whatever the samples say', () => {
    const r = verdictOf({ samples: full, revertedAt: '2026-10-05T00:00:00Z' })
    expect(r).toMatchObject({ verdict: 'not_measured', detail: { reason: 'reverted' } })
  })

  it('a later change to the same page → not_measured:superseded', () => {
    expect(verdictOf({ samples: full, supersededByLaterChange: true }).detail.reason).toBe('superseded')
  })

  it('no baseline (never recorded, or the baseline fetch failed) → not_measured:no_baseline', () => {
    expect(verdictOf({ baseline: { status: null, rank_group: null, depth: null }, samples: full }).detail.reason).toBe('no_baseline')
    expect(verdictOf({ baseline: { status: 'fetch_failed', rank_group: null, depth: DEPTH }, samples: full }).detail.reason).toBe('no_baseline')
  })

  it('an inconsistent "ranked" baseline without a rank is never guessed at', () => {
    expect(verdictOf({ baseline: { status: 'ranked', rank_group: null, depth: DEPTH }, samples: full }).detail.reason).toBe('no_baseline')
  })

  it('baseline where a different own page ranked → not_measured:baseline_other_own_page', () => {
    expect(verdictOf({ baseline: { status: 'other_own_page', rank_group: null, depth: DEPTH }, samples: full }).detail.reason).toBe('baseline_other_own_page')
  })

  it('a different own page ranking on a sample → not_measured:url_changed, not a rank move', () => {
    const r = verdictOf({ samples: [ranked(22, 7), sample(24, 'other_own_page', null), ranked(26, 7)] })
    expect(r).toMatchObject({ verdict: 'not_measured', detail: { reason: 'url_changed' } })
  })

  it('the live page title not being the one we wrote → not_measured:live_title_mismatch (merged PR ≠ live page)', () => {
    expect(verdictOf({ samples: [], liveTitleOk: false }).detail.reason).toBe('live_title_mismatch')
  })

  it('could-not-check live title (null) does not block the verdict (baseline 10 → 7,7,7 is still a move)', () => {
    expect(verdictOf({ samples: full, liveTitleOk: null }).verdict).toBe('rank_moved_up')
  })
})

describe('decideRankVerdict — never speaks in causal verdict words', () => {
  it('only ever returns verdicts from the DB CHECK list, none implying effectiveness', () => {
    const outcomes = [
      verdictOf({ samples: [ranked(22, 7), ranked(24, 7), ranked(26, 7)] }).verdict,
      verdictOf({ samples: [ranked(22, 10), ranked(24, 10), ranked(26, 10)] }).verdict,
      verdictOf({ samples: [absent(22), absent(24), absent(26)] }).verdict,
    ]
    for (const v of outcomes) expect(v).not.toMatch(/improved|regressed|effective|worked/)
  })
})
