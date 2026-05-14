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

// ---------------------------------------------------------------------------
// 3. social_profiles Apify 指标字段（P8.12.S1.6a）
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — social_profiles Apify 指标', () => {
  it('有效的 followers_count / posts_last_30d / engagement_rate 原样保留', () => {
    const r = validateDiscoveryReport(makeValidReport([
      { ...validSocial, followers_count: 267, posts_last_30d: 4, engagement_rate: 0.021 },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.social_profiles[0].followers_count).toBe(267)
      expect(r.value.social_profiles[0].posts_last_30d).toBe(4)
      expect(r.value.social_profiles[0].engagement_rate).toBe(0.021)
    }
  })

  it('非数字的指标被 coerce 成 null，条目仍保留', () => {
    const r = validateDiscoveryReport(makeValidReport([
      { ...validSocial, followers_count: 'lots', engagement_rate: 'high' },
    ]))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.social_profiles).toHaveLength(1)
      expect(r.value.social_profiles[0].followers_count).toBeNull()
      expect(r.value.social_profiles[0].engagement_rate).toBeNull()
    }
  })

  it('未提供指标字段时不报错（字段可选）', () => {
    expect(validateDiscoveryReport(makeValidReport([validSocial])).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. meta_ads（P8.12.S1.6a）
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — meta_ads', () => {
  it('有效 meta_ads 原样保留', () => {
    const report = makeValidReport([validSocial])
    report.meta_ads = {
      active_ads_count: 6,
      ad_types: ['image', 'video'],
      estimated_spend: 'medium',
      top_ad_copy: ['EOFY Sale'],
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.meta_ads?.active_ads_count).toBe(6)
      expect(r.value.meta_ads?.estimated_spend).toBe('medium')
    }
  })

  it('meta_ads 缺失 → null，报告仍通过', () => {
    const r = validateDiscoveryReport(makeValidReport([validSocial]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.meta_ads).toBeNull()
  })

  it('未知 estimated_spend 被 coerce 成 unknown', () => {
    const report = makeValidReport([validSocial])
    report.meta_ads = {
      active_ads_count: 3,
      ad_types: [],
      estimated_spend: 'astronomical',
      top_ad_copy: [],
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.meta_ads?.estimated_spend).toBe('unknown')
  })

  it('损坏的 meta_ads（active_ads_count 非数字）→ null，报告不作废', () => {
    const report = makeValidReport([validSocial])
    report.meta_ads = { active_ads_count: 'many', ad_types: [], estimated_spend: 'low', top_ad_copy: [] }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.meta_ads).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. serp_results（P8.12.S1.6c）
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — serp_results', () => {
  const validSerp = {
    query: 'vinyl flooring brisbane',
    organic_results: [{ position: 1, title: 'X', url: 'https://x.com', description: 'd' }],
    paid_advertiser_domains: ['carpetcourt.com.au'],
    ai_overview_text: 'AI 回答文本',
    ai_overview_sources: ['https://src.com'],
  }

  it('有效 serp_results 原样保留', () => {
    const report = makeValidReport([validSocial])
    report.serp_results = [validSerp]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.serp_results).toHaveLength(1)
      expect(r.value.serp_results?.[0].query).toBe('vinyl flooring brisbane')
    }
  })

  it('serp_results 缺失 → null，报告仍通过', () => {
    const r = validateDiscoveryReport(makeValidReport([validSocial]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.serp_results).toBeNull()
  })

  it('ai_overview_text 缺失被 coerce 成 null', () => {
    const report = makeValidReport([validSocial])
    report.serp_results = [{ ...validSerp, ai_overview_text: undefined }]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.serp_results?.[0].ai_overview_text).toBeNull()
  })

  it('损坏的 serp 条目被逐条过滤，报告不作废', () => {
    const report = makeValidReport([validSocial])
    report.serp_results = [
      validSerp,
      { query: '', organic_results: [], paid_advertiser_domains: [], ai_overview_text: null, ai_overview_sources: [] },
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.serp_results).toHaveLength(1)
  })
})
