/**
 * Tests for src/lib/huatuo/benchmarks.ts — formatBenchmarksForPrompt
 *
 * 重点覆盖 P8.12.S1.4：客户月预算 vs 行业典型月预算的比较指导。
 */

import { describe, it, expect } from 'vitest'
import { formatBenchmarksForPrompt } from '../benchmarks'
import type { HuatuoLookupContext, IndustryBenchmarkRow, BenchmarkDimension } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(
  dimension: BenchmarkDimension,
  typicalBudget: number | null,
): IndustryBenchmarkRow {
  return {
    id: `bench-${dimension}`,
    industry_category: 'retail',
    business_size: 'small',
    market: 'AU_NZ',
    dimension,
    score_p50: 50,
    score_p75: 70,
    score_p90: 90,
    realistic_3mo_growth_pct: 10,
    realistic_6mo_growth_pct: 20,
    typical_monthly_budget_aud: typicalBudget,
    source: 'test',
    source_url: null,
    confidence: 0.8,
    sample_size: 100,
    notes: null,
  }
}

function makeBenchmarks(
  budgets: Partial<Record<BenchmarkDimension, number | null>>,
): HuatuoLookupContext['benchmarks'] {
  return {
    seo: 'seo' in budgets ? makeRow('seo', budgets.seo ?? null) : null,
    social: 'social' in budgets ? makeRow('social', budgets.social ?? null) : null,
    reputation: 'reputation' in budgets ? makeRow('reputation', budgets.reputation ?? null) : null,
    ai_visibility: 'ai_visibility' in budgets ? makeRow('ai_visibility', budgets.ai_visibility ?? null) : null,
  }
}

// ---------------------------------------------------------------------------
// 1. 不传客户预算 — 无预算定位段落
// ---------------------------------------------------------------------------

describe('formatBenchmarksForPrompt — 无客户预算', () => {
  it('不传 customerBudgetAud 时不输出预算定位段落', () => {
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: 1000 }), '零售')
    expect(text).not.toContain('## 预算定位')
  })

  it('仍输出基准表与 KPI 约束', () => {
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: 1000 }), '零售')
    expect(text).toContain('行业基准数据')
    expect(text).toContain('P50–P90')
  })
})

// ---------------------------------------------------------------------------
// 2. 传客户预算 — 预算定位段落与比值
// ---------------------------------------------------------------------------

describe('formatBenchmarksForPrompt — 预算定位', () => {
  it('行业无典型预算时给出兜底说明', () => {
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: null }), '零售', 800)
    expect(text).toContain('## 预算定位')
    expect(text).toContain('行业无典型预算基准')
    expect(text).toContain('AUD 800')
  })

  it('预算显著低于典型水平（ratio < 0.5）→ 聚焦高杠杆维度', () => {
    // typical 区间 1000–1000，中位 1000；客户 400 → ratio 0.4
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: 1000 }), '零售', 400)
    expect(text).toContain('预算显著低于行业典型水平')
    expect(text).toContain('0.40×')
  })

  it('预算略低于典型水平（0.5 ≤ ratio < 1）→ 精选优先维度', () => {
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: 1000 }), '零售', 700)
    expect(text).toContain('预算略低于行业典型水平')
  })

  it('预算与典型水平匹配（1 ≤ ratio ≤ 1.5）→ 可覆盖全部优先维度', () => {
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: 1000 }), '零售', 1200)
    expect(text).toContain('预算与行业典型水平匹配')
  })

  it('预算高于典型水平（ratio > 1.5）→ 可加大投入', () => {
    const text = formatBenchmarksForPrompt(makeBenchmarks({ seo: 1000 }), '零售', 2000)
    expect(text).toContain('预算高于行业典型水平')
  })

  it('多维度典型预算时取区间 min–max 与中位', () => {
    // seo 600, social 1400 → min 600 / max 1400 / mid 1000
    const text = formatBenchmarksForPrompt(
      makeBenchmarks({ seo: 600, social: 1400 }),
      '零售',
      1000,
    )
    expect(text).toContain('AUD 600 – 1400')
    expect(text).toContain('中位约 1000')
    expect(text).toContain('1.00×')
  })

  it('忽略 null 与 0 的典型预算值', () => {
    // 只有 social=800 有效；seo=null reputation=0 被忽略 → 区间 800–800
    const text = formatBenchmarksForPrompt(
      makeBenchmarks({ seo: null, social: 800, reputation: 0 }),
      '零售',
      800,
    )
    expect(text).toContain('AUD 800 – 800')
  })
})
