/**
 * Tests for score-formula-explainer — single source of truth for the
 * "为什么是 X 分?" content surfaced under each diagnostic dimension card.
 *
 * These are characterisation tests with full-string `toBe` assertions: the
 * formula copy ships to FDE/customer eyeballs, so any change is intentional
 * and must update this test in lockstep. Loose regex matches (the original
 * /50/ style) let weight drifts (50→40) pass undetected — fixed in魏征 H1.
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

  // Full-string assertions — every byte ships to UI, treat as protected copy.
  // Mirror seo-collector.ts: KW 50 + Authority 25 + Technical 25.
  it('seo formula matches seo-collector verbatim', () => {
    expect(getDimensionFormula('seo').formula).toBe(
      'SEO = 50 × 关键词覆盖率 + 25 × 域名权威(0–100) + 25 × 技术健康(0–100)',
    )
  })

  // Mirror reputation-collector.ts A1 weights (0.70 rating + 0.30 reviews cap 30).
  it('reputation formula matches A1 weights verbatim', () => {
    expect(getDimensionFormula('reputation').formula).toBe(
      '口碑 = 70 × (评分 / 5) + 30 × min(评论数, 30) / 30',
    )
  })

  // Mirror ads-collector.ts (platform 0.40 + volume 0.35 + creative 0.25).
  it('ads formula matches ads-collector verbatim', () => {
    expect(getDimensionFormula('ads').formula).toBe(
      '广告 = 40 × 平台多样性 + 35 × 广告体量 + 25 × 创意多样性',
    )
  })

  // Mirror social-collector.ts: per-platform avg(0.40×freq + 0.40×engage) +
  // min(20, (n-1)*10) diversity bonus. Previously mis-stated as
  // "(发文频率分 + 互动率分) / 2" — 子牙 social explainer 修正.
  it('social formula matches social-collector verbatim', () => {
    expect(getDimensionFormula('social').formula).toBe(
      '社媒 = 平均(每平台 0.40×发文频率分 + 0.40×互动率分) + min(20, (平台数-1)×10) 多平台奖励',
    )
  })

  // Mirror ai-visibility-collector.ts: citation rate.
  it('ai_visibility formula matches collector verbatim', () => {
    expect(getDimensionFormula('ai_visibility').formula).toBe(
      'AI 可见度 = 100 × 被 AI 引用问句数 / 总追踪问句数',
    )
  })

  // Mirror competitor-collector.ts: client/comp avg traffic ratio.
  it('competitor formula matches competitor-collector verbatim', () => {
    expect(getDimensionFormula('competitor').formula).toBe(
      '竞品 = 100 × 客户自然流量 / 竞品自然流量均值（封顶 100）',
    )
  })

  it('competitor tierHint explicitly says null when < 3 competitors', () => {
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

// ---------------------------------------------------------------------------
// 魏征 H3: DIMENSION_WEIGHTS invariants — constants.ts comment says weights
// "必须和 = 1.0" but until now nothing enforced it. If someone bumps reputation
// from 0.10 → 0.20 without rebalancing, computeOverallScore renormalises but
// the OVERALL_WEIGHTING_NOTE silently lies. Guard both invariants here.
// ---------------------------------------------------------------------------

describe('DIMENSION_WEIGHTS invariants', () => {
  it('all weights sum to 1.0 (within float epsilon)', () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.0001)
  })

  it('every dimension has a weight in [0, 1]', () => {
    for (const dim of ALL_DIMS) {
      const w = DIMENSION_WEIGHTS[dim]
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(1)
    }
  })

  it.each(ALL_DIMS)('getDimensionFormula("%s").weightInOverall mirrors constants', dim => {
    expect(getDimensionFormula(dim).weightInOverall).toBe(DIMENSION_WEIGHTS[dim])
  })

  it('OVERALL_WEIGHTING_NOTE percentages sum to ~100%', () => {
    // Parse "seo 35% · reputation 10% ..." from the note and add up.
    const matches = OVERALL_WEIGHTING_NOTE.match(/\d+%/g) ?? []
    // Only the 6 dimension weights, not the SCORE_THRESHOLDS bands.
    const dimensionPcts = matches
      .map(m => parseInt(m, 10))
      .filter(n => n <= 50)  // tier-band thresholds (70/40) are >50 → excluded
    const sum = dimensionPcts.reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThanOrEqual(98)  // rounding slack
    expect(sum).toBeLessThanOrEqual(102)
  })
})
