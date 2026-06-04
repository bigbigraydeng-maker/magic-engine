/**
 * Unit tests for the pure functions in src/lib/seo-patrol/job.ts (P22.E.S2b).
 *
 * Covers the two deterministic transforms that turn raw snapshot rows into
 * kanban-ready actions:
 *   - assembleSeoPatrolInput: snapshot rows → SeoPatrolInput (CTR merge, prior
 *     position join, covered flag)
 *   - findingsToActions: findings → ranked PriorityAction[] capped at 3
 *
 * DB-touching functions (loadSeoPatrolInput, runSeoPatrol) are not unit-tested
 * here — they are thin Supabase wrappers verified at build + integration time.
 */

import { describe, it, expect } from 'vitest'
import { assembleSeoPatrolInput, findingsToActions } from '../job'
import type { SeoPatrolFinding } from '../types'

function finding(partial: Partial<SeoPatrolFinding>): SeoPatrolFinding {
  return {
    clientId: 'c1',
    ruleId: 'keyword_opportunity',
    keyword: 'kw',
    url: null,
    position: null,
    ctr: null,
    ctrBenchmark: null,
    searchVolume: null,
    keywordDifficulty: null,
    positionDelta: null,
    suggestedActionType: 'seo.publish_blog',
    description: 'desc',
    ...partial,
  }
}

// ── assembleSeoPatrolInput ───────────────────────────────────────────────────────

describe('assembleSeoPatrolInput', () => {
  it('merges GSC CTR onto the matching keyword (case-insensitive)', () => {
    const input = assembleSeoPatrolInput(
      'c1',
      [{ keyword: 'Best Tours NZ', position: 3, search_volume: 200, keyword_difficulty: 12, snapshot_date: '2026-06-04' }],
      [],
      [{ query: 'best tours nz', clicks: 5, impressions: 300, ctr: 0.017, position: 3 }],
    )
    expect(input.keywords).toHaveLength(1)
    expect(input.keywords[0].gscCtr).toBeCloseTo(0.017)
  })

  it('joins prior position from the previous snapshot', () => {
    const input = assembleSeoPatrolInput(
      'c1',
      [{ keyword: 'kw', position: 9, search_volume: null, keyword_difficulty: null, snapshot_date: '2026-06-04' }],
      [{ keyword: 'kw', position: 4, search_volume: null, keyword_difficulty: null, snapshot_date: '2026-05-28' }],
      [],
    )
    expect(input.keywords[0].priorPosition).toBe(4)
  })

  it('marks a ranked keyword as covered, an unranked one as not', () => {
    const input = assembleSeoPatrolInput(
      'c1',
      [
        { keyword: 'ranked', position: 5, search_volume: null, keyword_difficulty: null, snapshot_date: '2026-06-04' },
        { keyword: 'unranked', position: null, search_volume: null, keyword_difficulty: null, snapshot_date: '2026-06-04' },
      ],
      [],
      [],
    )
    const ranked = input.keywords.find((k) => k.keyword === 'ranked')!
    const unranked = input.keywords.find((k) => k.keyword === 'unranked')!
    expect(ranked.covered).toBe(true)
    expect(unranked.covered).toBe(false)
  })

  it('leaves gscCtr null when no GSC query matches', () => {
    const input = assembleSeoPatrolInput(
      'c1',
      [{ keyword: 'no gsc data', position: 2, search_volume: null, keyword_difficulty: null, snapshot_date: '2026-06-04' }],
      [],
      [{ query: 'something else', clicks: 1, impressions: 1, ctr: 0.5, position: 1 }],
    )
    expect(input.keywords[0].gscCtr).toBeNull()
  })

  it('always returns empty pages (R2/R5 data not yet collected)', () => {
    const input = assembleSeoPatrolInput('c1', [], [], [])
    expect(input.pages).toEqual([])
  })
})

// ── findingsToActions ────────────────────────────────────────────────────────────

describe('findingsToActions', () => {
  it('caps output at 3 actions even with more findings', () => {
    const findings = [
      finding({ ruleId: 'low_ctr_title', keyword: 'a' }),
      finding({ ruleId: 'stale_content', keyword: 'b' }),
      finding({ ruleId: 'keyword_opportunity', keyword: 'c' }),
      finding({ ruleId: 'missing_internal_link', url: 'd' }),
      finding({ ruleId: 'not_indexed', url: 'e' }),
    ]
    const actions = findingsToActions(findings)
    expect(actions).toHaveLength(3)
  })

  it('orders actions by rule priority (low_ctr before opportunity)', () => {
    const findings = [
      finding({ ruleId: 'keyword_opportunity', keyword: 'opp', description: 'OPP', suggestedActionType: 'seo.publish_blog' }),
      finding({ ruleId: 'low_ctr_title', keyword: 'ctr', description: 'CTR', suggestedActionType: 'seo.refresh_blog' }),
    ]
    const actions = findingsToActions(findings)
    // low_ctr_title has RULE_RANK 1, keyword_opportunity 3 → CTR finding comes first
    expect(actions[0].why_now).toBe('CTR')
    expect(actions[0].action_type).toBe('seo.refresh_blog')
    expect(actions[0].rank).toBe(1)
    expect(actions[1].why_now).toBe('OPP')
    expect(actions[1].rank).toBe(2)
  })

  it('sets dimension=seo and execution_mode=in_house on every action', () => {
    const actions = findingsToActions([finding({})])
    expect(actions[0].dimension).toBe('seo')
    expect(actions[0].execution_mode).toBe('in_house')
  })

  it('carries the finding description into why_now and a traceable evidence ref', () => {
    const actions = findingsToActions([
      finding({ ruleId: 'low_ctr_title', keyword: 'best tours', description: 'rewrite title' }),
    ])
    expect(actions[0].why_now).toBe('rewrite title')
    expect(actions[0].evidence_refs[0]).toBe('seo_patrol:low_ctr_title:best tours')
  })

  it('uses url as the subject when keyword is null', () => {
    const actions = findingsToActions([
      finding({ ruleId: 'not_indexed', keyword: null, url: 'https://x.com/p' }),
    ])
    expect(actions[0].evidence_refs[0]).toBe('seo_patrol:not_indexed:https://x.com/p')
  })

  it('returns an empty array for no findings', () => {
    expect(findingsToActions([])).toEqual([])
  })

  it('attaches metadata carrying the real keyword so the Content Workbench can prefill it', () => {
    // Regression guard for the FDE-feedback bug where the studio prefilled
    // the action-type label ("Publish Blog") instead of the rule's keyword.
    const actions = findingsToActions([
      finding({
        ruleId: 'keyword_opportunity',
        keyword: 'chengdu panda tours',
        searchVolume: 280,
        keywordDifficulty: 19,
      }),
    ])
    expect(actions).toHaveLength(1)
    const meta = actions[0].metadata as Record<string, unknown> | undefined
    expect(meta).toBeDefined()
    expect(meta?.keyword).toBe('chengdu panda tours')
    expect(meta?.rule_id).toBe('keyword_opportunity')
    expect(meta?.search_volume).toBe(280)
  })

  it('attaches metadata for stale-content findings (keyword + position context)', () => {
    const actions = findingsToActions([
      finding({
        ruleId: 'stale_content',
        keyword: 'great wall tours',
        position: 10,
        positionDelta: 6,
      }),
    ])
    const meta = actions[0].metadata as Record<string, unknown> | undefined
    expect(meta?.keyword).toBe('great wall tours')
    expect(meta?.position).toBe(10)
    expect(meta?.rule_id).toBe('stale_content')
  })

  it('derives prior_position from position - position_delta for stale_content (S9 regression guard)', () => {
    // Phase 22.E.S9 — expected-impact stale_content branch needs prior_position
    // to compute recovered clicks. job.ts derives it from (position - positionDelta).
    const actions = findingsToActions([
      finding({
        ruleId: 'stale_content',
        keyword: 'great wall tours',
        position: 10,
        positionDelta: 6,
      }),
    ])
    const meta = actions[0].metadata as Record<string, unknown> | undefined
    expect(meta?.prior_position).toBe(4)  // 10 - 6 = 4
    expect(meta?.position_delta).toBe(6)
  })

  it('keeps prior_position null when finding has no positionDelta', () => {
    // Defensive: keyword_opportunity findings have no positionDelta, so
    // prior_position must stay null instead of being miscalculated.
    const actions = findingsToActions([
      finding({
        ruleId: 'keyword_opportunity',
        keyword: 'milford sound',
        position: null,
        positionDelta: null,
      }),
    ])
    const meta = actions[0].metadata as Record<string, unknown> | undefined
    expect(meta?.prior_position).toBeNull()
    expect(meta?.position_delta).toBeNull()
  })

  it('carries ctr / ctr_benchmark for low_ctr_title findings (S9 regression guard)', () => {
    const actions = findingsToActions([
      finding({
        ruleId: 'low_ctr_title',
        keyword: 'cts tours',
        position: 3,
        ctr: 0.02,
        ctrBenchmark: 0.11,
      }),
    ])
    const meta = actions[0].metadata as Record<string, unknown> | undefined
    expect(meta?.ctr).toBeCloseTo(0.02, 4)
    expect(meta?.ctr_benchmark).toBeCloseTo(0.11, 4)
  })
})
