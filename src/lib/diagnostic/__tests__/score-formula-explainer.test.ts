/**
 * Tests for score-formula-explainer — single source of truth for the
 * "为什么是 X 分?" content surfaced under each diagnostic dimension card.
 *
 * These are characterisation tests: the formula strings are public-facing
 * copy that flows through to the FDE UI, so changes must be deliberate.
 */

import { describe, it, expect } from 'vitest'
import {
  getDimensionFormula,
  classifyTier,
  OVERALL_WEIGHTING_NOTE,
} from '../score-formula-explainer'
import { DIMENSION_WEIGHTS, SCORE_THRESHOLDS } from '../constants'
import type { DiagnosticDimension } from '@/types/diagnostic'

const ALL_DIMS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]

describe('getDimensionFormula', () => {
  it.each(ALL_DIMS)('returns a complete formula card for "%s"', dim => {
    const card = getDimensionFormula(dim)
    expect(card.formula.length).toBeGreaterThan(0)
    expect(card.dataSource.length).toBeGreaterThan(0)
    expect(card.tierHint.length).toBeGreaterThan(0)
    expect(card.weightInOverall).toBe(DIMENSION_WEIGHTS[dim])
  })

  it('seo formula mentions the three weighted ingredients matching seo-collector', () => {
    const seo = getDimensionFormula('seo').formula
    expect(seo).toMatch(/50/)
    expect(seo).toMatch(/25/)
    expect(seo).toMatch(/关键词|coverage/i)
    expect(seo).toMatch(/权威|authority/i)
    expect(seo).toMatch(/技术|technical/i)
  })

  it('reputation formula matches A1 weights (0.70 / 0.30 / cap 30)', () => {
    const rep = getDimensionFormula('reputation').formula
    expect(rep).toMatch(/70/)
    expect(rep).toMatch(/30/)
  })

  it('competitor formula explicitly says null when < 3 competitors', () => {
    const comp = getDimensionFormula('competitor')
    expect(comp.tierHint).toMatch(/无数据|未跑|未配置/)
  })
})

describe('classifyTier', () => {
  it('null → "unknown" (renders 未配置)', () => {
    expect(classifyTier(null)).toBe('unknown')
    expect(classifyTier(undefined)).toBe('unknown')
  })

  it('respects SCORE_THRESHOLDS exactly', () => {
    expect(classifyTier(SCORE_THRESHOLDS.green)).toBe('green')
    expect(classifyTier(SCORE_THRESHOLDS.green - 1)).toBe('amber')
    expect(classifyTier(SCORE_THRESHOLDS.amber)).toBe('amber')
    expect(classifyTier(SCORE_THRESHOLDS.amber - 1)).toBe('red')
    expect(classifyTier(0)).toBe('red')
    expect(classifyTier(100)).toBe('green')
  })
})

describe('OVERALL_WEIGHTING_NOTE', () => {
  it('mentions all 6 dimensions with their percentage weights', () => {
    for (const dim of ALL_DIMS) {
      const pct = Math.round(DIMENSION_WEIGHTS[dim] * 100)
      expect(OVERALL_WEIGHTING_NOTE).toContain(`${dim} ${pct}%`)
    }
  })

  it('explicitly explains null-dimension renormalisation', () => {
    expect(OVERALL_WEIGHTING_NOTE).toMatch(/重新归一化|无数据维度|排除/)
  })

  it('includes the tier band thresholds so the UI can quote them verbatim', () => {
    expect(OVERALL_WEIGHTING_NOTE).toContain(String(SCORE_THRESHOLDS.green))
    expect(OVERALL_WEIGHTING_NOTE).toContain(String(SCORE_THRESHOLDS.amber))
  })
})
