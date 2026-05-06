/**
 * Tests for scorer.ts (Phase 8.D.1.3)
 *
 * scoreCandidate maps a Candidate (the output of analyzer.crossSignals)
 * to a number 0-100. Rules in spirit:
 *   - unified mode (AI weak + SEO opportunity together) > geo_only > seo_only
 *   - higher search volume increases score
 *   - lower keyword difficulty (KD) increases score
 *   - upgrade_page is bumped when the existing page is empty or missing GEO
 */

import { describe, it, expect } from 'vitest'
import { scoreCandidate, derivePriorityBucket } from './scorer'
import type { Candidate } from './analyzer'

function baseCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    action_type: 'new_blog',
    content_mode: 'unified',
    proposed_title: 't',
    rationale: 'r',
    keyword_volume: 200,
    keyword_kd: 30,
    ...overrides,
  }
}

describe('scoreCandidate', () => {
  it('unified mode scores higher than geo_only and seo_only with same KW data', () => {
    const u = scoreCandidate(baseCandidate({ content_mode: 'unified' }))
    const g = scoreCandidate(baseCandidate({ content_mode: 'geo_only' }))
    const s = scoreCandidate(baseCandidate({ content_mode: 'seo_only' }))
    expect(u).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(s)
  })

  it('higher search volume yields higher score', () => {
    const lo = scoreCandidate(baseCandidate({ keyword_volume: 50 }))
    const hi = scoreCandidate(baseCandidate({ keyword_volume: 5000 }))
    expect(hi).toBeGreaterThan(lo)
  })

  it('lower KD yields higher score', () => {
    const easy = scoreCandidate(baseCandidate({ keyword_kd: 10 }))
    const hard = scoreCandidate(baseCandidate({ keyword_kd: 80 }))
    expect(easy).toBeGreaterThan(hard)
  })

  it('upgrade_page with missing GEO block scores higher than upgrade with GEO', () => {
    const noGeo = scoreCandidate(
      baseCandidate({
        action_type: 'upgrade_page',
        existing_word_count: 1200,
        existing_has_geo_block: false,
      })
    )
    const withGeo = scoreCandidate(
      baseCandidate({
        action_type: 'upgrade_page',
        existing_word_count: 1200,
        existing_has_geo_block: true,
      })
    )
    expect(noGeo).toBeGreaterThan(withGeo)
  })

  it('score is bounded 0-100', () => {
    const huge = scoreCandidate(
      baseCandidate({
        content_mode: 'unified',
        keyword_volume: 99999,
        keyword_kd: 0,
        action_type: 'upgrade_page',
        existing_has_geo_block: false,
      })
    )
    const tiny = scoreCandidate(
      baseCandidate({
        content_mode: 'seo_only',
        keyword_volume: 0,
        keyword_kd: 100,
      })
    )
    expect(huge).toBeLessThanOrEqual(100)
    expect(tiny).toBeGreaterThanOrEqual(0)
  })

  it('handles missing keyword data with a sensible mid-range score', () => {
    const score = scoreCandidate(
      baseCandidate({ keyword_volume: undefined, keyword_kd: undefined })
    )
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })
})

describe('derivePriorityBucket', () => {
  it('maps numeric score to a priority bucket', () => {
    expect(derivePriorityBucket(90)).toBe('critical')
    expect(derivePriorityBucket(70)).toBe('high')
    expect(derivePriorityBucket(40)).toBe('medium')
    expect(derivePriorityBucket(10)).toBe('low')
  })
})
