/**
 * Unit tests for the pure topic-picking logic in weekly-blog.ts (22.E.S16).
 *
 * DB/AI-touching orchestration (runWeeklyBlogBatch, runForClient) is a thin
 * composition of already-tested lib pieces and is exercised at integration
 * time; here we pin the dedupe semantics that decide WHAT gets written.
 */

import { describe, it, expect } from 'vitest'
import { pickFreshTopics } from '../weekly-blog'
import type { BlogOpportunity } from '@/types/magic-engine'

function opp(partial: Partial<BlogOpportunity>): BlogOpportunity {
  return {
    query_id: 'q1',
    query_text: 'best china tours from nz',
    weakness_score: 0.8,
    engines_missing: ['openai'],
    total_runs_checked: 10,
    last_run_at: null,
    mode: 'unified',
    ...partial,
  }
}

describe('pickFreshTopics', () => {
  it('keeps order and passes everything when nothing overlaps', () => {
    const picked = pickFreshTopics(
      [opp({ query_id: 'a' }), opp({ query_id: 'b', query_text: 'other topic' })],
      ['completely unrelated subject'],
    )
    expect(picked.map((p) => p.query_id)).toEqual(['a', 'b'])
  })

  it('drops an opportunity whose query_text matches a blocked term (case-insensitive)', () => {
    const picked = pickFreshTopics(
      [
        opp({ query_id: 'a', query_text: 'Best China Tours From NZ' }),
        opp({ query_id: 'b', query_text: 'yangtze river cruise guide' }),
      ],
      ['best china tours from nz'],
    )
    expect(picked.map((p) => p.query_id)).toEqual(['b'])
  })

  it('drops on substring overlap in either direction', () => {
    const picked = pickFreshTopics(
      [
        opp({ query_id: 'a', query_text: 'q-text', primary_keyword: 'spc flooring' }),
        opp({ query_id: 'b', query_text: 'laminate care tips' }),
      ],
      ['spc flooring buying guide australia'],
    )
    expect(picked.map((p) => p.query_id)).toEqual(['b'])
  })

  it('matches on primary_keyword even when query_text differs', () => {
    const picked = pickFreshTopics(
      [opp({ query_id: 'a', query_text: 'unique question', primary_keyword: 'hybrid flooring' })],
      ['hybrid flooring'],
    )
    expect(picked).toEqual([])
  })

  it('short blocked terms only block on exact equality, not substring', () => {
    // "nz" appears inside "best china tours from nz" but must NOT nuke it.
    const picked = pickFreshTopics(
      [
        opp({ query_id: 'a', query_text: 'best china tours from nz' }),
        opp({ query_id: 'b', query_text: 'nz' }),
      ],
      ['nz'],
    )
    expect(picked.map((p) => p.query_id)).toEqual(['a'])
  })

  it('short candidate keywords do not blanket-match long blocked topics', () => {
    const picked = pickFreshTopics(
      [opp({ query_id: 'a', query_text: 'q', primary_keyword: 'spc' })],
      ['spc flooring buying guide australia'],
    )
    // "spc" (len<4) only blocks on equality — the long topic is not equal.
    expect(picked.map((p) => p.query_id)).toEqual(['a'])
  })

  it('drops opportunities with no usable text instead of waving them through', () => {
    const picked = pickFreshTopics(
      [opp({ query_id: 'a', query_text: '   ', primary_keyword: undefined })],
      [],
    )
    expect(picked).toEqual([])
  })

  it('returns empty for an empty opportunity list', () => {
    expect(pickFreshTopics([], [])).toEqual([])
  })

  it('ignores empty/whitespace blocked terms', () => {
    const picked = pickFreshTopics([opp({ query_id: 'a' })], ['', '   '])
    expect(picked.map((p) => p.query_id)).toEqual(['a'])
  })
})
