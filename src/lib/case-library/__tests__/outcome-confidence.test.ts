/**
 * Tests for outcome-confidence.ts — P12.C.2
 */

import { describe, it, expect } from 'vitest'
import {
  computeConfidenceMap,
  formatConfidenceForPrompt,
  getConfidenceLabel,
} from '../outcome-confidence'
import type { RawOutcomeConfidenceRow } from '../outcome-confidence'

// ── computeConfidenceMap ──────────────────────────────────────────────────────

describe('computeConfidenceMap', () => {
  it('returns empty map for no rows', () => {
    expect(computeConfidenceMap([])).toEqual({})
  })

  it('calculates success rate correctly', () => {
    const rows: RawOutcomeConfidenceRow[] = [
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'inconclusive' },
      { action_type: 'seo.publish_blog', verdict: 'confirmed' },
      { action_type: 'seo.publish_blog', verdict: 'reversed' },
    ]
    const map = computeConfidenceMap(rows)
    expect(map['geo.deploy_directive'].successRate).toBeCloseTo(2 / 3)
    expect(map['geo.deploy_directive'].sampleSize).toBe(3)
    expect(map['seo.publish_blog'].successRate).toBeCloseTo(0.5)
    expect(map['seo.publish_blog'].sampleSize).toBe(2)
  })

  it('handles all-confirmed case', () => {
    const rows: RawOutcomeConfidenceRow[] = [
      { action_type: 'ads.pause_campaign', verdict: 'confirmed' },
      { action_type: 'ads.pause_campaign', verdict: 'confirmed' },
      { action_type: 'ads.pause_campaign', verdict: 'confirmed' },
    ]
    const map = computeConfidenceMap(rows)
    expect(map['ads.pause_campaign'].successRate).toBe(1)
    expect(map['ads.pause_campaign'].sampleSize).toBe(3)
  })
})

// ── getConfidenceLabel ────────────────────────────────────────────────────────

describe('getConfidenceLabel', () => {
  it('returns new strategy label when action_type not in map', () => {
    const label = getConfidenceLabel({}, 'geo.unknown_action')
    expect(label).toBe('新策略，尚无验证数据')
  })

  it('returns success rate label when data exists', () => {
    const map = { 'geo.deploy_directive': { successRate: 0.73, sampleSize: 12 } }
    const label = getConfidenceLabel(map, 'geo.deploy_directive')
    expect(label).toBe('历史成功率 73%，基于 12 个客户案例')
  })

  it('rounds percentage correctly', () => {
    const map = { 'seo.publish_blog': { successRate: 0.6666, sampleSize: 3 } }
    const label = getConfidenceLabel(map, 'seo.publish_blog')
    expect(label).toContain('67%')
  })
})

// ── formatConfidenceForPrompt ─────────────────────────────────────────────────

describe('formatConfidenceForPrompt', () => {
  it('returns empty string when no entries', () => {
    expect(formatConfidenceForPrompt({})).toBe('')
  })

  it('formats confidence map as prompt section', () => {
    const map = {
      'geo.deploy_directive': { successRate: 0.8, sampleSize: 10 },
      'seo.publish_blog': { successRate: 0.5, sampleSize: 4 },
    }
    const result = formatConfidenceForPrompt(map)
    expect(result).toContain('历史成效数据')
    expect(result).toContain('geo.deploy_directive')
    expect(result).toContain('80%')
    expect(result).toContain('seo.publish_blog')
    expect(result).toContain('50%')
  })
})
