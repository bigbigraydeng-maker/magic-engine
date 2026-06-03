/**
 * Unit tests for src/lib/seo-patrol/rules.ts — SEO patrol rule engine (P22.E).
 *
 * Each rule is tested for: (a) the happy path that fires, (b) the boundary
 * case that must NOT fire, and (c) data-missing cases. Mutation-resistant:
 * thresholds are exercised on both sides so loosening a comparison breaks a test.
 */

import { describe, it, expect } from 'vitest'
import {
  runSeoPatrolRules,
  SEO_PATROL_RULES,
  SEO_PATROL_THRESHOLDS,
  ctrBenchmarkForPosition,
} from '../rules'
import type { KeywordSignal, PageSignal, SeoPatrolInput } from '../types'

const CLIENT = 'client-1'

function kw(partial: Partial<KeywordSignal>): KeywordSignal {
  return {
    keyword: 'test keyword',
    position: null,
    priorPosition: null,
    searchVolume: null,
    keywordDifficulty: null,
    gscCtr: null,
    covered: false,
    ...partial,
  }
}

function page(partial: Partial<PageSignal>): PageSignal {
  return {
    url: 'https://example.com/post',
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 5,
    hasInternalLink: false,
    discoveredNotIndexed: false,
    daysNotIndexed: null,
    ...partial,
  }
}

function input(partial: Partial<SeoPatrolInput>): SeoPatrolInput {
  return { clientId: CLIENT, keywords: [], pages: [], ...partial }
}

// ── Registry sanity ─────────────────────────────────────────────────────────────

describe('SEO_PATROL_RULES registry', () => {
  it('registers exactly 5 rules with unique ids', () => {
    expect(SEO_PATROL_RULES).toHaveLength(5)
    const ids = SEO_PATROL_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(5)
  })

  it('every rule carries a seo.* suggestedActionType', () => {
    for (const rule of SEO_PATROL_RULES) {
      expect(rule.suggestedActionType).toMatch(/^seo\./)
    }
  })
})

// ── R1: low CTR title ───────────────────────────────────────────────────────────

describe('R1 low_ctr_title', () => {
  it('fires when rank is P3 and CTR is well below benchmark', () => {
    // P3 benchmark = 0.11, ratio 0.6 → threshold 0.066. CTR 0.02 is below.
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 3, gscCtr: 0.02 })] }),
    ).filter((f) => f.ruleId === 'low_ctr_title')

    expect(found).toHaveLength(1)
    expect(found[0].keyword).toBe('test keyword')
    expect(found[0].ctrBenchmark).toBe(0.11)
    expect(found[0].suggestedActionType).toBe('seo.refresh_blog')
  })

  it('does NOT fire when CTR meets the benchmark ratio', () => {
    // P3 benchmark 0.11 × 0.6 = 0.066. CTR 0.10 is above → healthy.
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 3, gscCtr: 0.10 })] }),
    ).filter((f) => f.ruleId === 'low_ctr_title')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire for position 1 (outside the P2-P3 band lower bound)', () => {
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 1, gscCtr: 0.001 })] }),
    ).filter((f) => f.ruleId === 'low_ctr_title')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire for position 4 (outside the P2-P3 band upper bound)', () => {
    // Guards LOW_CTR_MAX_POSITION: widening the band to e.g. 100 must break this.
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 4, gscCtr: 0.001 })] }),
    ).filter((f) => f.ruleId === 'low_ctr_title')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire when GSC CTR is unknown', () => {
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 2, gscCtr: null })] }),
    ).filter((f) => f.ruleId === 'low_ctr_title')
    expect(found).toHaveLength(0)
  })
})

// ── R2: missing internal link ────────────────────────────────────────────────────

describe('R2 missing_internal_link', () => {
  it('fires when an impression-heavy page has no internal link', () => {
    const found = runSeoPatrolRules(
      input({ pages: [page({ impressions: 200, hasInternalLink: false })] }),
    ).filter((f) => f.ruleId === 'missing_internal_link')
    expect(found).toHaveLength(1)
    expect(found[0].url).toBe('https://example.com/post')
  })

  it('does NOT fire when the page already has an internal link', () => {
    const found = runSeoPatrolRules(
      input({ pages: [page({ impressions: 200, hasInternalLink: true })] }),
    ).filter((f) => f.ruleId === 'missing_internal_link')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire below the impressions threshold', () => {
    const below = SEO_PATROL_THRESHOLDS.MIN_IMPRESSIONS_FOR_LINK - 1
    const found = runSeoPatrolRules(
      input({ pages: [page({ impressions: below, hasInternalLink: false })] }),
    ).filter((f) => f.ruleId === 'missing_internal_link')
    expect(found).toHaveLength(0)
  })

  it('fires when impressions exactly equal the threshold (trigger-side boundary)', () => {
    // Guards the comparison operator: flipping `<` to `<=` must break this.
    const found = runSeoPatrolRules(
      input({
        pages: [
          page({
            impressions: SEO_PATROL_THRESHOLDS.MIN_IMPRESSIONS_FOR_LINK,
            hasInternalLink: false,
          }),
        ],
      }),
    ).filter((f) => f.ruleId === 'missing_internal_link')
    expect(found).toHaveLength(1)
  })
})

// ── R3: stale content ────────────────────────────────────────────────────────────

describe('R3 stale_content', () => {
  it('fires when ranking dropped more than the threshold', () => {
    // prior #4 → now #9 = drop of 5 (> 3)
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 9, priorPosition: 4 })] }),
    ).filter((f) => f.ruleId === 'stale_content')
    expect(found).toHaveLength(1)
    expect(found[0].positionDelta).toBe(5)
  })

  it('does NOT fire for a drop at the threshold boundary', () => {
    // drop of exactly 3 must not fire (rule is strictly greater-than)
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 7, priorPosition: 4 })] }),
    ).filter((f) => f.ruleId === 'stale_content')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire when the ranking improved', () => {
    const found = runSeoPatrolRules(
      input({ keywords: [kw({ position: 2, priorPosition: 8 })] }),
    ).filter((f) => f.ruleId === 'stale_content')
    expect(found).toHaveLength(0)
  })
})

// ── R4: keyword opportunity ──────────────────────────────────────────────────────

describe('R4 keyword_opportunity', () => {
  it('fires for a high-volume low-KD uncovered keyword', () => {
    const found = runSeoPatrolRules(
      input({
        keywords: [kw({ covered: false, searchVolume: 500, keywordDifficulty: 15 })],
      }),
    ).filter((f) => f.ruleId === 'keyword_opportunity')
    expect(found).toHaveLength(1)
    expect(found[0].searchVolume).toBe(500)
    expect(found[0].suggestedActionType).toBe('seo.publish_blog')
  })

  it('does NOT fire when the keyword is already covered', () => {
    const found = runSeoPatrolRules(
      input({
        keywords: [kw({ covered: true, searchVolume: 500, keywordDifficulty: 15 })],
      }),
    ).filter((f) => f.ruleId === 'keyword_opportunity')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire when KD is above the ceiling', () => {
    const tooHard = SEO_PATROL_THRESHOLDS.OPPORTUNITY_MAX_KD + 1
    const found = runSeoPatrolRules(
      input({
        keywords: [kw({ covered: false, searchVolume: 500, keywordDifficulty: tooHard })],
      }),
    ).filter((f) => f.ruleId === 'keyword_opportunity')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire below the volume floor', () => {
    const tooLow = SEO_PATROL_THRESHOLDS.OPPORTUNITY_MIN_VOLUME - 1
    const found = runSeoPatrolRules(
      input({
        keywords: [kw({ covered: false, searchVolume: tooLow, keywordDifficulty: 10 })],
      }),
    ).filter((f) => f.ruleId === 'keyword_opportunity')
    expect(found).toHaveLength(0)
  })

  it('fires when KD exactly equals the ceiling (trigger-side boundary)', () => {
    // KD = 30, rule is `> 30` → false → fires. Flipping to `>= 30` must break this.
    const found = runSeoPatrolRules(
      input({
        keywords: [
          kw({
            covered: false,
            searchVolume: 500,
            keywordDifficulty: SEO_PATROL_THRESHOLDS.OPPORTUNITY_MAX_KD,
          }),
        ],
      }),
    ).filter((f) => f.ruleId === 'keyword_opportunity')
    expect(found).toHaveLength(1)
  })

  it('fires when volume exactly equals the floor (trigger-side boundary)', () => {
    // volume = 100, rule is `< 100` → false → fires. Flipping to `<= 100` must break this.
    const found = runSeoPatrolRules(
      input({
        keywords: [
          kw({
            covered: false,
            searchVolume: SEO_PATROL_THRESHOLDS.OPPORTUNITY_MIN_VOLUME,
            keywordDifficulty: 10,
          }),
        ],
      }),
    ).filter((f) => f.ruleId === 'keyword_opportunity')
    expect(found).toHaveLength(1)
  })
})

// ── R5: not indexed ──────────────────────────────────────────────────────────────

describe('R5 not_indexed', () => {
  it('fires when a page is not indexed beyond the day threshold', () => {
    const found = runSeoPatrolRules(
      input({
        pages: [page({ discoveredNotIndexed: true, daysNotIndexed: 14 })],
      }),
    ).filter((f) => f.ruleId === 'not_indexed')
    expect(found).toHaveLength(1)
  })

  it('does NOT fire at the day-threshold boundary', () => {
    const found = runSeoPatrolRules(
      input({
        pages: [
          page({
            discoveredNotIndexed: true,
            daysNotIndexed: SEO_PATROL_THRESHOLDS.NOT_INDEXED_MIN_DAYS,
          }),
        ],
      }),
    ).filter((f) => f.ruleId === 'not_indexed')
    expect(found).toHaveLength(0)
  })

  it('does NOT fire when the page is indexed normally', () => {
    const found = runSeoPatrolRules(
      input({
        pages: [page({ discoveredNotIndexed: false, daysNotIndexed: null })],
      }),
    ).filter((f) => f.ruleId === 'not_indexed')
    expect(found).toHaveLength(0)
  })
})

// ── CTR benchmark curve ──────────────────────────────────────────────────────────

describe('ctrBenchmarkForPosition', () => {
  it('returns 0 for unranked / invalid positions', () => {
    expect(ctrBenchmarkForPosition(null)).toBe(0)
    expect(ctrBenchmarkForPosition(0)).toBe(0)
  })

  it('decreases monotonically as position worsens', () => {
    const p1 = ctrBenchmarkForPosition(1)
    const p3 = ctrBenchmarkForPosition(3)
    const p10 = ctrBenchmarkForPosition(10)
    expect(p1).toBeGreaterThan(p3)
    expect(p3).toBeGreaterThan(p10)
  })
})
