/**
 * Tests for src/lib/zhangqian/validators.ts — validateDiscoveryReport.
 *
 * 重点覆盖 fix/zhangqian-social-validation：social_profiles 的宽容处理。
 * 修复前 .every(isSocial) 一票否决 —— 单条社媒数据异常（如 platform "x"）
 * 会让整份 $0.7+ 的 discovery 报告作废。修复后逐条过滤、缺失容忍。
 */

import { describe, it, expect } from 'vitest'
import { validateDiscoveryReport } from '../validators'

// ---------------------------------------------------------------------------
// Helper: 构造一份最小合规报告，social_profiles 由参数注入
// ---------------------------------------------------------------------------

function makeValidReport(socialProfiles: unknown): Record<string, unknown> {
  return {
    schema_version: 1,
    domain: 'example.com.au',
    business: {
      name: 'Example Co',
      industry: ['building supplies'],
      location: { city: 'Brisbane', region: 'QLD', country: 'AU' },
      description: 'A building supplies business in Brisbane.',
      target_audience: ['builders'],
      unique_selling_points: ['free quote'],
      confidence: 0.9,
    },
    social_profiles: socialProfiles,
    gbp: null,
    review_platforms: [],
    seed_keywords: [
      { keyword: 'a', type: 'category', rationale: 'r' },
      { keyword: 'b', type: 'category', rationale: 'r' },
      { keyword: 'c', type: 'category', rationale: 'r' },
    ],
    competitors: [
      { domain: 'c1.com', name: 'C1', relevance: 'direct', rationale: 'r' },
      { domain: 'c2.com', name: 'C2', relevance: 'direct', rationale: 'r' },
      { domain: 'c3.com', name: 'C3', relevance: 'direct', rationale: 'r' },
    ],
    ai_tracker_questions: [
      { question: 'q1', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q2', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q3', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q4', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q5', category: 'brand', market: 'AU', rationale: 'r' },
    ],
    notes: '',
  }
}

const validSocial = {
  platform: 'instagram',
  handle: '@x',
  url: 'https://instagram.com/x',
  confidence: 0.8,
}

// ---------------------------------------------------------------------------
// 1. social_profiles 宽容处理（核心 bug 修复）
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — social_profiles 宽容处理', () => {
  it('platform "x" 被 coerce 成 twitter，条目保留', () => {
    const r = validateDiscoveryReport(makeValidReport([
      { platform: 'x', handle: '@brand', url: 'https://x.com/brand', confidence: 0.7 },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.social_profiles).toHaveLength(1)
      expect(r.value.social_profiles[0].platform).toBe('twitter')
    }
  })

  it('真正未知的 platform 条目被过滤，但报告仍通过', () => {
    const r = validateDiscoveryReport(makeValidReport([
      validSocial,
      { platform: 'threads', handle: '@x', url: 'https://threads.net/x', confidence: 0.5 },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.social_profiles).toHaveLength(1)
      expect(r.value.social_profiles[0].platform).toBe('instagram')
    }
  })

  it('social_profiles 缺失 → 视为空数组，报告通过', () => {
    const report = makeValidReport(undefined)
    delete report.social_profiles
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.social_profiles).toEqual([])
  })

  it('social_profiles 为 null → 视为空数组，报告通过', () => {
    const r = validateDiscoveryReport(makeValidReport(null))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.social_profiles).toEqual([])
  })

  it('url 不合规的条目被过滤，合规条目保留', () => {
    const r = validateDiscoveryReport(makeValidReport([
      validSocial,
      { platform: 'facebook', handle: null, url: 'not-a-url', confidence: 0.6 },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.social_profiles).toHaveLength(1)
  })

  it('confidence 超范围的条目被过滤', () => {
    const r = validateDiscoveryReport(makeValidReport([
      { platform: 'instagram', handle: '@x', url: 'https://instagram.com/x', confidence: 1.5 },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.social_profiles).toEqual([])
  })

  it('全部合规的条目全部保留', () => {
    const r = validateDiscoveryReport(makeValidReport([
      validSocial,
      { platform: 'facebook', handle: '@y', url: 'https://facebook.com/y', confidence: 0.9 },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.social_profiles).toHaveLength(2)
  })

  it('单条坏 social 不再让整份报告作废（回归核心 bug）', () => {
    // 修复前：platform "x" 会让 .every(isSocial) 为 false → 整份报告被拒
    const r = validateDiscoveryReport(makeValidReport([
      { platform: 'x', handle: '@brand', url: 'https://x.com/brand', confidence: 0.7 },
    ]))
    expect(r.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. 回归：合规报告仍通过，损坏报告仍被拒
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — 回归', () => {
  it('完整合规报告通过校验', () => {
    expect(validateDiscoveryReport(makeValidReport([validSocial])).ok).toBe(true)
  })

  it('domain 缺失的报告仍被拒', () => {
    const report = makeValidReport([validSocial])
    delete report.domain
    expect(validateDiscoveryReport(report).ok).toBe(false)
  })

  it('seed_keywords 少于 3 条的报告仍被拒', () => {
    const report = makeValidReport([validSocial])
    report.seed_keywords = [{ keyword: 'a', type: 'category', rationale: 'r' }]
    expect(validateDiscoveryReport(report).ok).toBe(false)
  })
})
