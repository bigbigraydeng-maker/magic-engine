/**
 * Tests for legacy-score-sanitiser — narrow guard that prevents pre-PR-251
 * CompetitorCollector default "score=100 when no competitors" from rendering
 * as green-100 健康 on the live diagnostic page.
 *
 * Critical: the guard must trigger ONLY on the legacy bug fingerprint and
 * leave legitimate fresh-run 100s untouched.
 */

import { describe, it, expect } from 'vitest'
import { sanitiseLegacyScores } from '../legacy-score-sanitiser'
import type { DiagnosticDimension } from '@/types/diagnostic'

describe('sanitiseLegacyScores — legacy competitor=100 default', () => {
  it('triggers on the exact bug fingerprint (100 + not skipped + 0 findings)', () => {
    const result = sanitiseLegacyScores({
      rawScores: { competitor: 100, seo: 36 },
      dimensionsSkipped: new Set<DiagnosticDimension>(['social']),
      findingCountByDim: { seo: 1 },
    })
    expect(result.wasLegacyDefault).toBe(true)
    expect(result.scores['competitor']).toBeNull()
    expect(result.scores['seo']).toBe(36)
    expect(result.effectiveSkippedSet.has('competitor')).toBe(true)
    expect(result.effectiveSkippedSet.has('social')).toBe(true)
  })

  it('does NOT trigger when competitor < 100 (real result)', () => {
    const result = sanitiseLegacyScores({
      rawScores: { competitor: 87 },
      dimensionsSkipped: new Set(),
      findingCountByDim: {},
    })
    expect(result.wasLegacyDefault).toBe(false)
    expect(result.scores['competitor']).toBe(87)
  })

  it('does NOT trigger when competitor has findings (legitimate 100 with traffic ratio finding)', () => {
    const result = sanitiseLegacyScores({
      rawScores: { competitor: 100 },
      dimensionsSkipped: new Set(),
      findingCountByDim: { competitor: 2 },
    })
    expect(result.wasLegacyDefault).toBe(false)
    expect(result.scores['competitor']).toBe(100)
  })

  it('does NOT trigger when competitor is already in dimensions_skipped (new collector returned null)', () => {
    const result = sanitiseLegacyScores({
      rawScores: { competitor: null },
      dimensionsSkipped: new Set<DiagnosticDimension>(['competitor']),
      findingCountByDim: { competitor: 1 },
    })
    expect(result.wasLegacyDefault).toBe(false)
    expect(result.scores['competitor']).toBeNull()
  })

  it('returns the exact same skipped-set reference when no sanitisation happens', () => {
    const skipped = new Set<DiagnosticDimension>(['social'])
    const result = sanitiseLegacyScores({
      rawScores: { competitor: 50 },
      dimensionsSkipped: skipped,
      findingCountByDim: {},
    })
    expect(result.effectiveSkippedSet).toBe(skipped)
  })

  it('preserves all non-competitor scores untouched when legacy guard fires', () => {
    const result = sanitiseLegacyScores({
      rawScores: { competitor: 100, seo: 36, ads: 31, reputation: 54, ai_visibility: null },
      dimensionsSkipped: new Set<DiagnosticDimension>(['social']),
      findingCountByDim: { seo: 1, ads: 3, reputation: 1 },
    })
    expect(result.scores['seo']).toBe(36)
    expect(result.scores['ads']).toBe(31)
    expect(result.scores['reputation']).toBe(54)
    expect(result.scores['ai_visibility']).toBeNull()
    expect(result.scores['competitor']).toBeNull()  // sanitised
  })
})
