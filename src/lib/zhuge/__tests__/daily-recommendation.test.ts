/**
 * DAPE W5 — daily-recommendation tests
 *
 * Covers the pure ranker (short mode) used by the Kanban "AI 推荐今天做 3 件"
 * card. Tests pin behaviour for: score formula, due-date proximity, status
 * weighting, dimension diversity, and the 3-card cap.
 *
 * No LLM, no DB — all tests run on the in-memory ranker via fixtures.
 */

import { describe, it, expect } from 'vitest'
import {
  DAILY_RECOMMENDATION_MAX,
  dedupeCandidates,
  rankDailyRecommendations,
  scoreCandidate,
  scoreDueProximity,
  type DailyRecommendationCandidate,
} from '../daily-recommendation'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeCandidate(
  id: string,
  overrides: Partial<DailyRecommendationCandidate> = {},
): DailyRecommendationCandidate {
  return {
    id,
    client_id: 'client-1',
    title:       `Action ${id}`,
    description: `Do thing ${id}`,
    dimension:   'seo',
    status:      'pending',
    due_date:    null,
    sort_order:  0,
    created_at:  '2026-06-01T00:00:00Z',
    prescription_id: null,
    initiative_id:   null,
    source:          'zhuge',
    ...overrides,
  }
}

const NOW = new Date('2026-06-28T00:00:00Z')

// ── DAILY_RECOMMENDATION_MAX ─────────────────────────────────────────────────

describe('DAILY_RECOMMENDATION_MAX', () => {
  it('is 3 (DAPE spec §2.4.4)', () => {
    expect(DAILY_RECOMMENDATION_MAX).toBe(3)
  })
})

// ── scoreDueProximity ────────────────────────────────────────────────────────

describe('scoreDueProximity()', () => {
  it('returns 0 for null due_date', () => {
    expect(scoreDueProximity(null, NOW)).toBe(0)
  })

  it('returns 0 for unparseable due_date', () => {
    expect(scoreDueProximity('not a date', NOW)).toBe(0)
  })

  it('returns 5 for overdue (yesterday)', () => {
    expect(scoreDueProximity('2026-06-27', NOW)).toBe(5)
  })

  it('returns 5 for due today', () => {
    expect(scoreDueProximity('2026-06-28', NOW)).toBe(5)
  })

  it('returns 3 for due within 7 days (this week)', () => {
    expect(scoreDueProximity('2026-07-02', NOW)).toBe(3)
    expect(scoreDueProximity('2026-07-05', NOW)).toBe(3)
  })

  it('returns 1 for due within 30 days (this month)', () => {
    expect(scoreDueProximity('2026-07-20', NOW)).toBe(1)
  })

  it('returns 0 for due more than 30 days out', () => {
    expect(scoreDueProximity('2026-12-01', NOW)).toBe(0)
  })
})

// ── scoreCandidate ───────────────────────────────────────────────────────────

describe('scoreCandidate()', () => {
  it('scores pending > in_progress > completed/skipped', () => {
    const pending = scoreCandidate(makeCandidate('a', { status: 'pending' }), NOW)
    const inProg  = scoreCandidate(makeCandidate('b', { status: 'in_progress' }), NOW)
    const done    = scoreCandidate(makeCandidate('c', { status: 'completed' }), NOW)
    expect(pending.score).toBeGreaterThan(inProg.score)
    expect(inProg.score).toBeGreaterThan(done.score)
  })

  it('overdue pending scores higher than no-due pending', () => {
    const overdue   = scoreCandidate(makeCandidate('a', { status: 'pending', due_date: '2026-06-27' }), NOW)
    const noDueDate = scoreCandidate(makeCandidate('b', { status: 'pending', due_date: null }),         NOW)
    expect(overdue.score).toBeGreaterThan(noDueDate.score)
  })

  it('lower sort_order gives a small boost', () => {
    const first  = scoreCandidate(makeCandidate('a', { sort_order: 0 }), NOW)
    const tenth  = scoreCandidate(makeCandidate('b', { sort_order: 10 }), NOW)
    expect(first.score).toBeGreaterThan(tenth.score)
  })

  it('reason explains status + due proximity', () => {
    const overduePending = scoreCandidate(
      makeCandidate('a', { status: 'pending', due_date: '2026-06-27', dimension: 'seo' }),
      NOW,
    )
    expect(overduePending.reason).toContain('待处理')
    expect(overduePending.reason).toContain('已到期')
    expect(overduePending.reason).toContain('SEO')
  })

  it('reason falls back to "排序靠前" when status weight + due score are zero', () => {
    const completedNoDue = scoreCandidate(
      makeCandidate('a', { status: 'completed', due_date: null, dimension: null }),
      NOW,
    )
    expect(completedNoDue.reason).toBe('排序靠前')
  })

  it('score is clamped to 0..100', () => {
    const completed = scoreCandidate(makeCandidate('a', { status: 'completed' }), NOW)
    expect(completed.score).toBeGreaterThanOrEqual(0)
    expect(completed.score).toBeLessThanOrEqual(100)
  })
})

// ── rankDailyRecommendations ─────────────────────────────────────────────────

describe('rankDailyRecommendations()', () => {
  it('returns at most 3 cards', () => {
    const cands = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`item-${i}`, { status: 'pending' }),
    )
    const result = rankDailyRecommendations(cands, NOW)
    expect(result).toHaveLength(3)
  })

  it('returns empty array when no candidates', () => {
    expect(rankDailyRecommendations([], NOW)).toEqual([])
  })

  it('returns ≤3 cards when fewer than 3 candidates exist', () => {
    const cands = [makeCandidate('a'), makeCandidate('b')]
    const result = rankDailyRecommendations(cands, NOW)
    expect(result).toHaveLength(2)
  })

  it('prioritises overdue pending over no-due in_progress', () => {
    const cands = [
      makeCandidate('inprog-no-due', { status: 'in_progress', due_date: null }),
      makeCandidate('pending-overdue', { status: 'pending', due_date: '2026-06-27' }),
    ]
    const result = rankDailyRecommendations(cands, NOW)
    expect(result[0].id).toBe('pending-overdue')
  })

  it('prefers different dimensions for the 3 picks (diversity penalty)', () => {
    // Build 6 pending candidates: 3 seo, 3 ads.
    // All have identical base score, but ranker should pick at most 2 of each
    // dimension when an unused dimension is available with similar score.
    const cands: DailyRecommendationCandidate[] = []
    for (let i = 0; i < 3; i++) {
      cands.push(makeCandidate(`seo-${i}`, { dimension: 'seo', status: 'pending', sort_order: i }))
      cands.push(makeCandidate(`ads-${i}`, { dimension: 'ads', status: 'pending', sort_order: i }))
    }
    const result = rankDailyRecommendations(cands, NOW)
    expect(result).toHaveLength(3)
    const dims = result.map(r => r.dimension)
    // At least 2 distinct dimensions (diversity actively prefers spread)
    expect(new Set(dims).size).toBeGreaterThanOrEqual(2)
  })

  it('falls back to same-dimension picks when only one dimension has actionable items', () => {
    // Even with diversity penalty, the ranker must still return 3 cards when
    // all candidates share the same dimension (no other choice).
    const cands = Array.from({ length: 5 }, (_, i) =>
      makeCandidate(`seo-${i}`, { dimension: 'seo', status: 'pending', sort_order: i }),
    )
    const result = rankDailyRecommendations(cands, NOW)
    expect(result).toHaveLength(3)
    for (const r of result) expect(r.dimension).toBe('seo')
  })

  it('is deterministic — same input yields same picks', () => {
    const cands = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`item-${i}`, {
        status: i % 2 === 0 ? 'pending' : 'in_progress',
        dimension: ['seo', 'ads', 'ai_visibility', 'social'][i % 4],
        sort_order: i,
      }),
    )
    const a = rankDailyRecommendations(cands, NOW)
    const b = rankDailyRecommendations(cands, NOW)
    expect(a.map(x => x.id)).toEqual(b.map(x => x.id))
  })

  it('does not crash on candidates with null dimension', () => {
    const cands = [
      makeCandidate('a', { dimension: null, status: 'pending' }),
      makeCandidate('b', { dimension: 'seo', status: 'pending' }),
    ]
    const result = rankDailyRecommendations(cands, NOW)
    expect(result).toHaveLength(2)
  })

  it('returned items carry score and reason', () => {
    const cands = [makeCandidate('only', { status: 'pending', due_date: '2026-06-28' })]
    const result = rankDailyRecommendations(cands, NOW)
    expect(result).toHaveLength(1)
    expect(result[0].score).toBeGreaterThan(0)
    expect(typeof result[0].reason).toBe('string')
    expect(result[0].reason.length).toBeGreaterThan(0)
  })

  it('preserves prescription_id and initiative_id on returned items (no field dropping)', () => {
    // DAPE W5: callers may use prescription_id from recommendations to deep-link
    // into the prescription detail page. Ensure ranker doesn't drop these fields.
    const cand = makeCandidate('a', {
      status: 'pending',
      prescription_id: 'pres-xyz',
      initiative_id: 'init-abc',
    })
    const result = rankDailyRecommendations([cand], NOW)
    expect(result).toHaveLength(1)
    expect(result[0].prescription_id).toBe('pres-xyz')
    expect(result[0].initiative_id).toBe('init-abc')
  })
})

// ── dedupeCandidates (2026-08-01 Sungenix duplicate-cards incident) ──────────

describe('dedupeCandidates()', () => {
  it('collapses same (action_type, keyword) duplicates to the latest created_at', () => {
    const dups = [
      makeCandidate('d1', { action_type: 'seo.refresh_blog', steps_json: { keyword: 'how often apply sunscreen' }, created_at: '2026-07-29T04:01:00Z' }),
      makeCandidate('d2', { action_type: 'seo.refresh_blog', steps_json: { keyword: 'how often apply sunscreen' }, created_at: '2026-07-30T04:01:00Z' }),
      makeCandidate('d3', { action_type: 'seo.refresh_blog', steps_json: { keyword: 'how often apply sunscreen' }, created_at: '2026-07-31T04:01:00Z' }),
    ]
    const result = dedupeCandidates(dups)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('d3')
  })

  it('keeps cards of the same action_type with different keywords', () => {
    const cards = [
      makeCandidate('a', { action_type: 'seo.refresh_blog', steps_json: { keyword: 'kw-a' } }),
      makeCandidate('b', { action_type: 'seo.refresh_blog', steps_json: { keyword: 'kw-b' } }),
    ]
    expect(dedupeCandidates(cards)).toHaveLength(2)
  })

  it('never collapses keywordless cards with distinct descriptions (legacy manual cards)', () => {
    const cards = [
      makeCandidate('m1', { action_type: null, description: '救 SPC/Hybrid 主线页' }),
      makeCandidate('m2', { action_type: null, description: '首页 H1 + Hero + Schema' }),
    ]
    expect(dedupeCandidates(cards)).toHaveLength(2)
  })

  it('prefers the in_progress duplicate over a newer pending one', () => {
    const cards = [
      makeCandidate('started', { action_type: 'seo.refresh_blog', steps_json: { keyword: 'kw-a' }, status: 'in_progress', created_at: '2026-07-29T00:00:00Z' }),
      makeCandidate('newer',   { action_type: 'seo.refresh_blog', steps_json: { keyword: 'kw-a' }, status: 'pending',     created_at: '2026-07-31T00:00:00Z' }),
    ]
    const result = dedupeCandidates(cards)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('started')
  })
})
