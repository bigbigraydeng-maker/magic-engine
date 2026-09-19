import { describe, expect, it } from 'vitest'
import { deriveMetaCycleAction, SKIP_DIFFICULTY_FLOOR } from '../action-mapping'
import type { MetaCycleCandidate } from '../types'

function candidate(overrides: Partial<MetaCycleCandidate> = {}): MetaCycleCandidate {
  return {
    pageUrl: 'https://example.com/blog/foo',
    slug: 'foo',
    keyword: 'foo keyword',
    source: 'gsc',
    position: 8,
    impressions: 100,
    ctr: 0.05,
    searchVolume: 500,
    keywordDifficulty: 30,
    ...overrides,
  }
}

describe('deriveMetaCycleAction (PM 2026-09-20 精简: title_rewrite / skip only)', () => {
  it('prescribes title_rewrite for a ranking page under the difficulty floor', () => {
    const result = deriveMetaCycleAction(candidate({ position: 8 }))
    expect(result.actionType).toBe('title_rewrite')
    expect(result.auto).toBe(true)
  })

  it('prescribes title_rewrite even when position is null (defensive — fromGscPages always sets it, but the decision function should not crash on missing data)', () => {
    const result = deriveMetaCycleAction(candidate({ position: null }))
    expect(result.actionType).toBe('title_rewrite')
    expect(result.auto).toBe(true)
  })

  it('skips keywords above the difficulty floor', () => {
    const result = deriveMetaCycleAction(candidate({ keywordDifficulty: SKIP_DIFFICULTY_FLOOR + 1 }))
    expect(result.actionType).toBe('skip')
    expect(result.auto).toBe(false)
  })

  it('does not skip a candidate at exactly the difficulty floor', () => {
    const result = deriveMetaCycleAction(candidate({ keywordDifficulty: SKIP_DIFFICULTY_FLOOR }))
    expect(result.actionType).toBe('title_rewrite')
  })

  it('treats a null difficulty as 0 (auto-eligible, not skipped)', () => {
    const result = deriveMetaCycleAction(candidate({ keywordDifficulty: null }))
    expect(result.actionType).toBe('title_rewrite')
  })
})
