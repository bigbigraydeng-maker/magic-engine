/**
 * Unit tests for the pure functions in src/lib/seo-patrol/job.ts (P22.E.S2b).
 *
 * Covers the two deterministic transforms that turn raw snapshot rows into
 * kanban-ready actions:
 *   - assembleSeoPatrolInput: snapshot rows → SeoPatrolInput (CTR merge, prior
 *     position join, covered flag)
 *   - findingsToActions: findings → ranked PriorityAction[] capped at 3
 *
 * loadCardSuppression is tested here against the table-modelled fake, so its
 * filters really run; the per-client wiring of runSeoPatrolForClient is tested in
 * job-wiring.test.ts. loadSeoPatrolInput and runSeoPatrol are not unit-tested.
 */

import { describe, it, expect } from 'vitest'
import {
  assembleSeoPatrolInput,
  findingsToActions,
  buildCardSuppression,
  planPatrolCards,
  loadCardSuppression,
  WEEKLY_CARD_CAP_PER_CLIENT,
  type PatrolCardRow,
} from '../job'
import { executionItemDedupKey } from '@/lib/zhuge/action-persister'
import { makeFakeSupabase } from '@/lib/memory/__tests__/fake-supabase'
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

  it('dedupes duplicate findings for the same (rule, subject) — one card per keyword', () => {
    // Duplicate snapshot rows can fire the same rule twice for one keyword;
    // that must not become two identical kanban cards (Sungenix 2026-08-01).
    const actions = findingsToActions([
      finding({ ruleId: 'stale_content', keyword: 'how often apply sunscreen', suggestedActionType: 'seo.refresh_blog' }),
      finding({ ruleId: 'stale_content', keyword: 'How Often Apply Sunscreen', suggestedActionType: 'seo.refresh_blog' }),
      finding({ ruleId: 'stale_content', keyword: 'phoenix beauty eastwood', suggestedActionType: 'seo.refresh_blog' }),
    ])
    expect(actions).toHaveLength(2)
    expect(actions.map((a) => (a.metadata as { keyword: string }).keyword)).toEqual([
      'how often apply sunscreen',
      'phoenix beauty eastwood',
    ])
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

  it('skips a target whose card key is blocked and fills the slot with the next finding', () => {
    const first = finding({ ruleId: 'low_ctr_title', keyword: 'blocked kw', suggestedActionType: 'seo.refresh_blog' })
    const second = finding({ ruleId: 'stale_content', keyword: 'second kw', suggestedActionType: 'seo.refresh_blog' })
    const third = finding({ ruleId: 'keyword_opportunity', keyword: 'third kw', suggestedActionType: 'seo.publish_blog' })
    const blockedKeys = new Set([
      executionItemDedupKey(first.suggestedActionType, first.keyword, first.url),
    ])
    const actions = findingsToActions([first, second, third], { blockedKeys })
    const keywords = actions.map((a) => (a.metadata as { keyword: string }).keyword)
    expect(keywords).not.toContain('blocked kw')
    expect(keywords).toContain('second kw')
    expect(keywords).toContain('third kw')
  })

  it('respects a limit below the daily cap, and a limit of 0 gives no card', () => {
    const findings = [
      finding({ ruleId: 'low_ctr_title', keyword: 'a' }),
      finding({ ruleId: 'stale_content', keyword: 'b' }),
      finding({ ruleId: 'keyword_opportunity', keyword: 'c' }),
      finding({ ruleId: 'missing_internal_link', url: 'd' }),
      finding({ ruleId: 'not_indexed', url: 'e' }),
    ]
    expect(findingsToActions(findings, { limit: 1 })).toHaveLength(1)
    expect(findingsToActions(findings, { limit: 0 })).toEqual([])
  })

  it('keeps one card per card key even across different rules', () => {
    const actions = findingsToActions([
      finding({ ruleId: 'low_ctr_title', keyword: null, url: 'https://x.com/p', suggestedActionType: 'seo.refresh_blog' }),
      finding({ ruleId: 'stale_content', keyword: null, url: 'https://x.com/p', suggestedActionType: 'seo.refresh_blog' }),
    ])
    expect(actions).toHaveLength(1)
  })
})

// ── buildCardSuppression ─────────────────────────────────────────────────────────

describe('buildCardSuppression', () => {
  const NOW = new Date('2026-09-26T00:00:00Z')

  function cardRow(partial: Partial<PatrolCardRow>): PatrolCardRow {
    return {
      action_type: 'seo.refresh_blog',
      status: 'pending',
      source: 'zhuge',
      steps_json: { keyword: 'kw', rule_id: 'stale_content' },
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      ...partial,
    }
  }

  it('blocks the keys of pending and in_progress rows', () => {
    const { blockedKeys } = buildCardSuppression(
      [
        cardRow({ status: 'pending', steps_json: { keyword: 'pending kw' } }),
        cardRow({ status: 'in_progress', steps_json: { keyword: 'in progress kw' } }),
      ],
      NOW,
    )
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'pending kw', undefined))).toBe(true)
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'in progress kw', undefined))).toBe(true)
  })

  it('holds a recently completed/skipped target back, but not an old or superseded one', () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 86_400_000).toISOString()
    const twentyDaysAgo = new Date(NOW.getTime() - 20 * 86_400_000).toISOString()
    const { blockedKeys } = buildCardSuppression(
      [
        cardRow({ status: 'completed', updated_at: threeDaysAgo, steps_json: { keyword: 'recent done' } }),
        cardRow({ status: 'skipped', updated_at: twentyDaysAgo, steps_json: { keyword: 'old skipped' } }),
        cardRow({ status: 'superseded', updated_at: threeDaysAgo, steps_json: { keyword: 'superseded kw' } }),
      ],
      NOW,
    )
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'recent done', undefined))).toBe(true)
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'old skipped', undefined))).toBe(false)
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'superseded kw', undefined))).toBe(false)
  })

  it('counts only zhuge patrol cards created within 7 days', () => {
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 86_400_000).toISOString()
    const { openedLast7Days } = buildCardSuppression(
      [
        cardRow({ steps_json: { keyword: 'counted 1', rule_id: 'stale_content' } }),
        cardRow({ steps_json: { keyword: 'counted 2', rule_id: 'low_ctr_title' } }),
        cardRow({ source: 'fde', steps_json: { keyword: 'fde card', rule_id: 'stale_content' } }),
        cardRow({ steps_json: { keyword: 'no rule id' } }),
        cardRow({ created_at: eightDaysAgo, steps_json: { keyword: 'old card', rule_id: 'stale_content' } }),
      ],
      NOW,
    )
    expect(openedLast7Days).toBe(2)
  })

  it('blocks the same key for a row carrying steps_json.page_url as for a finding with that url', () => {
    const { blockedKeys } = buildCardSuppression(
      [cardRow({ steps_json: { page_url: 'https://x.com/p' } })],
      NOW,
    )
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', null, 'https://x.com/p'))).toBe(true)
  })

  it('counts distinct targets, so duplicate cards of one target count once', () => {
    const { openedLast7Days } = buildCardSuppression(
      [
        cardRow({ status: 'pending', steps_json: { keyword: 'dup', rule_id: 'stale_content' } }),
        cardRow({ status: 'superseded', steps_json: { keyword: 'dup', rule_id: 'stale_content' } }),
        cardRow({ status: 'completed', steps_json: { keyword: 'dup', rule_id: 'stale_content' } }),
        cardRow({ steps_json: { keyword: 'other', rule_id: 'stale_content' } }),
      ],
      NOW,
    )
    expect(openedLast7Days).toBe(2)
  })

  it('looks back 7 days minus 1 hour', () => {
    // Opened during the same daily run one week ago (6 days 23.5 hours back): trimmed out.
    const sameRunLastWeek = new Date(NOW.getTime() - 7 * 86_400_000 + 30 * 60_000).toISOString()
    // 6 days 22 hours back: still inside the window.
    const withinWindow = new Date(NOW.getTime() - 7 * 86_400_000 + 2 * 3_600_000).toISOString()
    const trimmed = buildCardSuppression(
      [cardRow({ created_at: sameRunLastWeek, steps_json: { keyword: 'edge', rule_id: 'stale_content' } })],
      NOW,
    )
    const counted = buildCardSuppression(
      [cardRow({ created_at: withinWindow, steps_json: { keyword: 'edge', rule_id: 'stale_content' } })],
      NOW,
    )
    expect(trimmed.openedLast7Days).toBe(0)
    expect(counted.openedLast7Days).toBe(1)
  })

  it('holds a completed new-article card for 90 days and other closed cards for 14', () => {
    const sixtyDaysAgo = new Date(NOW.getTime() - 60 * 86_400_000).toISOString()
    const ninetyOneDaysAgo = new Date(NOW.getTime() - 91 * 86_400_000).toISOString()
    const { blockedKeys } = buildCardSuppression(
      [
        cardRow({ action_type: 'seo.publish_blog', status: 'completed', updated_at: sixtyDaysAgo, steps_json: { keyword: 'published' } }),
        cardRow({ action_type: 'seo.publish_blog', status: 'skipped', updated_at: sixtyDaysAgo, steps_json: { keyword: 'skipped article' } }),
        cardRow({ action_type: 'seo.refresh_blog', status: 'completed', updated_at: sixtyDaysAgo, steps_json: { keyword: 'refreshed' } }),
        cardRow({ action_type: 'seo.publish_blog', status: 'completed', updated_at: ninetyOneDaysAgo, steps_json: { keyword: 'old article' } }),
      ],
      NOW,
    )
    expect(blockedKeys.has(executionItemDedupKey('seo.publish_blog', 'published', undefined))).toBe(true)
    expect(blockedKeys.has(executionItemDedupKey('seo.publish_blog', 'skipped article', undefined))).toBe(false)
    expect(blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'refreshed', undefined))).toBe(false)
    expect(blockedKeys.has(executionItemDedupKey('seo.publish_blog', 'old article', undefined))).toBe(false)
  })
})

// ── planPatrolCards ──────────────────────────────────────────────────────────────

describe('planPatrolCards', () => {
  it('withholds everything when the rolling weekly cap is already reached', () => {
    const findings = [
      finding({ ruleId: 'low_ctr_title', keyword: 'a' }),
      finding({ ruleId: 'stale_content', keyword: 'b' }),
    ]
    const plan = planPatrolCards(findings, {
      blockedKeys: new Set([executionItemDedupKey('seo.publish_blog', 'b', null)]),
      openedLast7Days: WEEKLY_CARD_CAP_PER_CLIENT,
    })
    expect(plan.actions).toEqual([])
    expect(plan.withheldReason).toBe('weekly_cap')
    expect(plan.heldExistingCard).toBe(1)
  })

  it('opens at most the remaining weekly slots', () => {
    const findings = [
      finding({ ruleId: 'low_ctr_title', keyword: 'a' }),
      finding({ ruleId: 'stale_content', keyword: 'b' }),
      finding({ ruleId: 'keyword_opportunity', keyword: 'c' }),
    ]
    const plan = planPatrolCards(findings, { blockedKeys: new Set(), openedLast7Days: 2 })
    expect(plan.actions).toHaveLength(1)
    expect(plan.withheldReason).toBe('weekly_cap')
  })

  it('does not report the weekly cap when every finding already has a card', () => {
    const findings = [
      finding({ ruleId: 'low_ctr_title', keyword: 'a' }),
      finding({ ruleId: 'stale_content', keyword: 'b' }),
    ]
    const plan = planPatrolCards(findings, {
      blockedKeys: new Set([
        executionItemDedupKey('seo.publish_blog', 'a', null),
        executionItemDedupKey('seo.publish_blog', 'b', null),
      ]),
      openedLast7Days: WEEKLY_CARD_CAP_PER_CLIENT,
    })
    expect(plan.actions).toEqual([])
    expect(plan.withheldReason).toBeNull()
    expect(plan.heldExistingCard).toBe(2)
  })

  it('does not report the weekly cap when the remaining slots cover every new target', () => {
    const findings = [
      finding({ ruleId: 'low_ctr_title', keyword: 'a' }),
      finding({ ruleId: 'stale_content', keyword: 'b' }),
    ]
    const plan = planPatrolCards(findings, { blockedKeys: new Set(), openedLast7Days: 1 })
    expect(plan.actions).toHaveLength(2)
    expect(plan.withheldReason).toBeNull()
  })
})

// ── loadCardSuppression ──────────────────────────────────────────────────────────

describe('loadCardSuppression', () => {
  const NOW = new Date('2026-09-26T00:00:00Z')

  let rowSeq = 0
  function seoRow(partial: Record<string, unknown>): Record<string, unknown> {
    rowSeq++
    return {
      id: `seo-row-${rowSeq}`,
      client_id: 'c1',
      dimension: 'seo',
      action_type: 'seo.refresh_blog',
      status: 'pending',
      source: 'zhuge',
      steps_json: { keyword: 'kw' },
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      ...partial,
    }
  }

  it('ignores rows for another client and for other dimensions', async () => {
    const supabase = makeFakeSupabase({
      execution_items: [
        {
          id: 'r1',
          client_id: 'c1',
          dimension: 'seo',
          action_type: 'seo.refresh_blog',
          status: 'pending',
          source: 'zhuge',
          steps_json: { keyword: 'mine' },
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
        {
          id: 'r2',
          client_id: 'other',
          dimension: 'seo',
          action_type: 'seo.refresh_blog',
          status: 'pending',
          source: 'zhuge',
          steps_json: { keyword: 'theirs' },
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
        {
          id: 'r3',
          client_id: 'c1',
          dimension: 'ads',
          action_type: 'seo.refresh_blog',
          status: 'pending',
          source: 'zhuge',
          steps_json: { keyword: 'ads row' },
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        },
      ],
    })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'mine', undefined))).toBe(true)
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'theirs', undefined))).toBe(false)
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'ads row', undefined))).toBe(false)
  })

  it('fails closed when the read errors', async () => {
    const supabase = makeFakeSupabase({ execution_items: [] }, { failSelectOn: ['execution_items'] })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(false)
  })

  it('fails closed when the read comes back full at the row limit', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      client_id: 'c1',
      dimension: 'seo',
      action_type: 'seo.refresh_blog',
      status: 'pending',
      source: 'zhuge',
      steps_json: { keyword: `kw-${i}` },
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    }))
    const supabase = makeFakeSupabase({ execution_items: rows })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('row limit')
  })

  it('holds a card created 120 days ago and skipped 3 days ago', async () => {
    const supabase = makeFakeSupabase({
      execution_items: [
        seoRow({
          status: 'skipped',
          created_at: new Date(NOW.getTime() - 120 * 86_400_000).toISOString(),
          updated_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
          steps_json: { keyword: 'late skip' },
        }),
      ],
    })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'late skip', undefined))).toBe(true)
  })

  it('holds an open card however old, including one a person made by hand', async () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 86_400_000).toISOString()
    const supabase = makeFakeSupabase({
      execution_items: [
        seoRow({
          status: 'pending',
          source: 'fde',
          created_at: thirtyDaysAgo,
          updated_at: thirtyDaysAgo,
          steps_json: { keyword: 'manual' },
        }),
        seoRow({
          status: 'in_progress',
          source: 'zhuge',
          created_at: thirtyDaysAgo,
          updated_at: thirtyDaysAgo,
          steps_json: { keyword: 'working', rule_id: 'stale_content' },
        }),
      ],
    })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'manual', undefined))).toBe(true)
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'working', undefined))).toBe(true)
    expect(result.value.openedLast7Days).toBe(0)
  })

  it('holds a new-article card completed 60 days ago but not a card skipped 20 days ago', async () => {
    const supabase = makeFakeSupabase({
      execution_items: [
        seoRow({
          action_type: 'seo.publish_blog',
          status: 'completed',
          updated_at: new Date(NOW.getTime() - 60 * 86_400_000).toISOString(),
          steps_json: { keyword: 'article' },
        }),
        seoRow({
          status: 'skipped',
          updated_at: new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
          steps_json: { keyword: 'passed' },
        }),
      ],
    })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.publish_blog', 'article', undefined))).toBe(true)
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'passed', undefined))).toBe(false)
  })

  it('counts a superseded patrol card created 2 days ago toward the weekly cap', async () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString()
    const supabase = makeFakeSupabase({
      execution_items: [
        seoRow({
          status: 'superseded',
          created_at: twoDaysAgo,
          updated_at: twoDaysAgo,
          steps_json: { keyword: 'replaced', rule_id: 'stale_content' },
        }),
      ],
    })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.openedLast7Days).toBe(1)
    expect(result.value.blockedKeys.has(executionItemDedupKey('seo.refresh_blog', 'replaced', undefined))).toBe(false)
  })

  it('does not count a patrol card created 8 days ago even if it was updated today', async () => {
    const supabase = makeFakeSupabase({
      execution_items: [
        seoRow({
          status: 'superseded',
          created_at: new Date(NOW.getTime() - 8 * 86_400_000).toISOString(),
          updated_at: NOW.toISOString(),
          steps_json: { keyword: 'old', rule_id: 'stale_content' },
        }),
      ],
    })
    const result = await loadCardSuppression(supabase, 'c1', NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.openedLast7Days).toBe(0)
  })
})
