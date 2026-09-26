/**
 * Tests for outcome-confidence.ts — P12.C.2
 */

import { describe, it, expect } from 'vitest'
import {
  computeConfidenceMap,
  formatConfidenceForPrompt,
  getConfidenceLabel,
  getModeBoost,
} from '../outcome-confidence'
import type { RawOutcomeConfidenceRow } from '../outcome-confidence'

// ── computeConfidenceMap ──────────────────────────────────────────────────────

describe('computeConfidenceMap', () => {
  it('returns empty map for no rows', () => {
    expect(computeConfidenceMap([])).toEqual({})
  })

  it('success rate counts decided cases only', () => {
    const rows: RawOutcomeConfidenceRow[] = [
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'confirmed' },
      { action_type: 'geo.deploy_directive', verdict: 'inconclusive' },
      { action_type: 'seo.publish_blog', verdict: 'confirmed' },
      { action_type: 'seo.publish_blog', verdict: 'reversed' },
    ]
    const map = computeConfidenceMap(rows)
    expect(map['geo.deploy_directive'].successRate).toBe(1)
    expect(map['geo.deploy_directive'].sampleSize).toBe(2)
    expect(map['geo.deploy_directive'].totalCases).toBe(3)
    expect(map['seo.publish_blog'].successRate).toBeCloseTo(0.5)
    expect(map['seo.publish_blog'].sampleSize).toBe(2)
    expect(map['seo.publish_blog'].totalCases).toBe(2)
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
    expect(map['ads.pause_campaign'].totalCases).toBe(3)
  })

  it('all-inconclusive action type has no decided case', () => {
    const rows: RawOutcomeConfidenceRow[] = [
      { action_type: 'seo.publish_blog', verdict: 'inconclusive' },
      { action_type: 'seo.publish_blog', verdict: 'inconclusive' },
    ]
    const map = computeConfidenceMap(rows)
    expect(map['seo.publish_blog']).toEqual({ successRate: 0, sampleSize: 0, totalCases: 2 })
  })
})

// ── getConfidenceLabel ────────────────────────────────────────────────────────

describe('getConfidenceLabel', () => {
  it('returns new strategy label when action_type not in map', () => {
    const label = getConfidenceLabel({}, 'geo.unknown_action')
    expect(label).toBe('新策略，尚无验证数据')
  })

  it('returns success rate label when data exists', () => {
    const map = { 'geo.deploy_directive': { successRate: 0.73, sampleSize: 12, totalCases: 20 } }
    const label = getConfidenceLabel(map, 'geo.deploy_directive')
    expect(label).toBe('历史成功率 73%（可判定 12 / 共 20 个客户案例）')
  })

  it('rounds percentage correctly', () => {
    const map = { 'seo.publish_blog': { successRate: 0.6666, sampleSize: 3, totalCases: 3 } }
    const label = getConfidenceLabel(map, 'seo.publish_blog')
    expect(label).toContain('67%')
  })

  it('says nothing was decidable when no case was decided', () => {
    const map = { 'seo.publish_blog': { successRate: 0, sampleSize: 0, totalCases: 5 } }
    const label = getConfidenceLabel(map, 'seo.publish_blog')
    expect(label).toBe('尚无可判定案例（共 5 个，结果都判不了）')
  })

  it('withholds a rate below the decided-case minimum', () => {
    const map = { 'seo.publish_blog': { successRate: 1, sampleSize: 2, totalCases: 9 } }
    const label = getConfidenceLabel(map, 'seo.publish_blog')
    expect(label).toContain('可判定案例太少')
    expect(label).not.toContain('%')
  })
})

// ── formatConfidenceForPrompt ─────────────────────────────────────────────────

describe('formatConfidenceForPrompt', () => {
  it('returns empty string when no entries', () => {
    expect(formatConfidenceForPrompt({})).toBe('')
  })

  it('formats confidence map as prompt section', () => {
    const map = {
      'geo.deploy_directive': { successRate: 0.8, sampleSize: 10, totalCases: 10 },
      'seo.publish_blog': { successRate: 0.5, sampleSize: 4, totalCases: 4 },
    }
    const result = formatConfidenceForPrompt(map)
    expect(result).toContain('历史成效数据')
    expect(result).toContain('geo.deploy_directive')
    expect(result).toContain('80%')
    expect(result).toContain('seo.publish_blog')
    expect(result).toContain('50%')
  })

  it('shows no rate for an action below the decided-case minimum', () => {
    const map = {
      'seo.publish_blog': { successRate: 1, sampleSize: 1, totalCases: 6 },
    }
    const result = formatConfidenceForPrompt(map)
    expect(result).toContain('| `seo.publish_blog` | — | 1 / 6 |')
    expect(result).not.toContain('100%')
  })

  it('prints the ready-made label in the table so the model can copy it', () => {
    const result = formatConfidenceForPrompt({
      'seo.publish_blog': { successRate: 0, sampleSize: 0, totalCases: 136 },
      'geo.deploy_directive': { successRate: 0.8, sampleSize: 10, totalCases: 12 },
    })
    expect(result).toContain('尚无可判定案例（共 136 个，结果都判不了）')
    expect(result).toContain('历史成功率 80%（可判定 10 / 共 12 个客户案例）')
    expect(result).toContain('照抄上表「置信度标签」一列')
    expect(result).not.toContain('${')
  })
})

describe('getModeBoost', () => {
  it('gives no boost below three decided cases, however good the rate', () => {
    expect(getModeBoost({ successRate: 1, sampleSize: 2, totalCases: 40 })).toBe(0)
  })

  it('boosts on decided cases only', () => {
    expect(getModeBoost({ successRate: 0.7, sampleSize: 3, totalCases: 3 })).toBe(10)
    expect(getModeBoost({ successRate: 0.5, sampleSize: 4, totalCases: 10 })).toBe(6)
  })
})
