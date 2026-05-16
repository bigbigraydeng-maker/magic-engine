/**
 * Tests for applyReputationGuardrail — 确定性兜底纠正 LLM 评分。
 *
 * Test scenarios mirror the rubric thresholds in prompts.ts:96-101.
 * 关键 case 是 cyhbnz.com 实测：5 星 / 仅 2 条 / 单平台 → 应被压到 5 分（15 - 10）。
 */

import { describe, it, expect } from 'vitest'
import {
  applyReputationGuardrail,
  computeReputationCap,
} from '../score-guardrails'
import type {
  DiscoveryReport,
  DiscoveredReviewPlatform,
  DiagnosisBlock,
} from '../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function platform(
  name: DiscoveredReviewPlatform['platform'],
  reviewCount: number,
  rating = 5,
): DiscoveredReviewPlatform {
  return {
    platform: name,
    url: `https://${name}.example.com`,
    rating,
    review_count: reviewCount,
  }
}

function baseDiagnosis(reputation: number, overall: number): DiagnosisBlock {
  return {
    executive_summary: '',
    crisis_type: null,
    scores: { seo: 0, social: 0, reputation, ai_visibility: 0, overall },
    money_flow: '',
    key_finding: '',
    actions: { quick_fix: [], important: [], talk_to_us: [] },
  }
}

function makeReport(
  platforms: DiscoveredReviewPlatform[],
  diagnosis: DiagnosisBlock | null,
): DiscoveryReport {
  return {
    schema_version: 1,
    domain: 'example.com',
    business: {
      name: 'Example',
      industry: [],
      location: { city: null, region: null, country: 'AU' },
      description: '',
      target_audience: [],
      unique_selling_points: [],
      confidence: 0.5,
    },
    social_profiles: [],
    gbp: null,
    review_platforms: platforms,
    seed_keywords: [],
    competitors: [],
    ai_tracker_questions: [],
    notes: '',
    diagnosis,
    meta: { model: 'm', tool_calls: 0, cost_usd: 0, duration_ms: 0, truncated: false },
  }
}

// ─── computeReputationCap ────────────────────────────────────────────────────

describe('computeReputationCap', () => {
  it('< 5 条评价 + 单平台 → cap 5', () => {
    expect(computeReputationCap([platform('google', 2)])).toBe(5)  // 15 - 10
  })

  it('< 5 条评价 + 多平台 → cap 15', () => {
    expect(computeReputationCap([
      platform('google', 2),
      platform('productreview', 2),
    ])).toBe(15)
  })

  it('< 20 条评价 + 单平台 → cap 20', () => {
    expect(computeReputationCap([platform('google', 10)])).toBe(20)  // 30 - 10
  })

  it('< 20 条评价 + 多平台 → cap 30', () => {
    expect(computeReputationCap([
      platform('google', 10),
      platform('trustpilot', 5),
    ])).toBe(30)
  })

  it('< 50 条评价 + 单平台 → cap 40', () => {
    expect(computeReputationCap([platform('google', 30)])).toBe(40)  // 50 - 10
  })

  it('< 50 条评价 + 多平台 → cap 50', () => {
    expect(computeReputationCap([
      platform('google', 25),
      platform('productreview', 20),
    ])).toBe(50)
  })

  it('≥ 50 条评价 + 多平台 → cap 100（无上限）', () => {
    expect(computeReputationCap([
      platform('google', 100),
      platform('trustpilot', 50),
    ])).toBe(100)
  })

  it('≥ 50 条评价 + 单平台 → cap 90（仍扣单平台分）', () => {
    expect(computeReputationCap([platform('google', 200)])).toBe(90)
  })

  it('空平台 → cap 5（按 0 条 + 单平台扣分但下限 0 后 = 15-10）', () => {
    expect(computeReputationCap([])).toBe(5)
  })

  it('review_count=null 视为 0', () => {
    expect(computeReputationCap([{ platform: 'google', url: 'x', rating: null, review_count: null }])).toBe(5)
  })

  it('同平台多 entry 去重（platCount 按 platform 字段去重）', () => {
    expect(computeReputationCap([
      platform('google', 2),
      platform('google', 1),
    ])).toBe(5)  // 总 3 条 < 5, 仅 1 个去重平台
  })
})

// ─── applyReputationGuardrail ────────────────────────────────────────────────

describe('applyReputationGuardrail', () => {
  it('LLM 给 45 分 + raw 5星/2条单平台 → 压回 5 分（cyhbnz.com 真实场景）', () => {
    const report = makeReport(
      [platform('google', 2, 5)],
      baseDiagnosis(/*reputation=*/45, /*overall=*/13),
    )
    // scores 设为 seo:5 social:0 ai_visibility:0 reputation:45 overall:13
    report.diagnosis!.scores.seo = 5
    const { report: clamped, result } = applyReputationGuardrail(report)
    expect(result?.applied).toBe(true)
    expect(result?.newReputation).toBe(5)
    expect(clamped.diagnosis?.scores.reputation).toBe(5)
    // overall = floor((5+0+5+0)/4) = 2
    expect(clamped.diagnosis?.scores.overall).toBe(2)
  })

  it('LLM 评分已合规（reputation 10 + cap 15）→ 不动', () => {
    const report = makeReport(
      [platform('google', 2), platform('productreview', 2)],
      baseDiagnosis(10, 10),
    )
    const { result, report: out } = applyReputationGuardrail(report)
    expect(result).toBeNull()
    expect(out).toBe(report)  // 返回同一引用，未克隆
  })

  it('reputation 恰等于 cap → 不动', () => {
    const report = makeReport(
      [platform('google', 2)],
      baseDiagnosis(5, 5),  // cap = 5, 给的也是 5
    )
    expect(applyReputationGuardrail(report).result).toBeNull()
  })

  it('diagnosis 为 null → 安全返回（不抛）', () => {
    const report = makeReport([], null)
    const { result, report: out } = applyReputationGuardrail(report)
    expect(result).toBeNull()
    expect(out).toBe(report)
  })

  it('不修改原 report 对象（immutability）', () => {
    const report = makeReport(
      [platform('google', 2, 5)],
      baseDiagnosis(45, 13),
    )
    const originalReputation = report.diagnosis!.scores.reputation
    applyReputationGuardrail(report)
    expect(report.diagnosis!.scores.reputation).toBe(originalReputation)  // 原值未变
  })

  it('overall 在所有维度上重算，不只是 reputation', () => {
    const report = makeReport(
      [platform('google', 2, 5)],
      baseDiagnosis(45, 28),
    )
    report.diagnosis!.scores.seo = 45
    report.diagnosis!.scores.social = 20
    report.diagnosis!.scores.ai_visibility = 10
    const { report: clamped } = applyReputationGuardrail(report)
    // 新 reputation = 5, overall = floor((45+20+5+10)/4) = floor(80/4) = 20
    expect(clamped.diagnosis?.scores.overall).toBe(20)
  })
})
