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

describe('validateDiscoveryReport - notes coercion', () => {
  it('coerces notes array to newline-separated string', () => {
    const report = makeValidReport([validSocial])
    report.notes = ['Meta ads checked', 'Google Ads Transparency URL found']

    const r = validateDiscoveryReport(report)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.notes).toBe('Meta ads checked\nGoogle Ads Transparency URL found')
    }
  })

  it('coerces notes object to JSON string instead of failing the report', () => {
    const report = makeValidReport([validSocial])
    report.notes = { caveat: 'partial run', missing: ['GBP'] }

    const r = validateDiscoveryReport(report)

    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.notes).toContain('"caveat": "partial run"')
      expect(r.value.notes).toContain('"GBP"')
    }
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

// ---------------------------------------------------------------------------
// 6. hot fix: 5 个一票否决点全部改成 coerce / filter（gbp + 4 array fields）
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — gbp 宽容处理 (hot fix)', () => {
  it('有效 gbp 原样保留', () => {
    const report = makeValidReport([validSocial])
    report.gbp = {
      place_id: 'ChIJabc',
      business_name: 'X',
      address: 'Y',
      rating: 4.5,
      review_count: 76,
      google_maps_url: 'https://maps.google.com/...',
      confidence: 0.9,
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.gbp?.business_name).toBe('X')
  })

  it('损坏的 gbp（缺 business_name）→ null，报告不作废（核心 hot fix）', () => {
    const report = makeValidReport([validSocial])
    // 模拟 Claude 输出的 gbp 缺关键字段（用户实测踩到的场景）
    report.gbp = { rating: 4.5, review_count: 76, confidence: 0.9 }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.gbp).toBeNull()
  })

  it('gbp 为 null 时通过', () => {
    expect(validateDiscoveryReport(makeValidReport([validSocial])).ok).toBe(true)
  })
})

describe('validateDiscoveryReport — array 字段逐条过滤 (hot fix)', () => {
  it('review_platforms 含坏条目时丢弃坏的，报告仍通过', () => {
    const report = makeValidReport([validSocial])
    report.review_platforms = [
      { platform: 'google', url: 'https://maps.google.com/x', rating: 4.2, review_count: 50 },
      { platform: 'google' }, // 缺 url，坏条目
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.review_platforms).toHaveLength(1)
  })

  it('seed_keywords 含坏条目但合规数仍 ≥ 3 → 通过', () => {
    const report = makeValidReport([validSocial])
    report.seed_keywords = [
      { keyword: 'a', type: 'category', rationale: 'r' },
      { keyword: 'b', type: 'category', rationale: 'r' },
      { keyword: 'c', type: 'category', rationale: 'r' },
      { keyword: '' }, // 坏：keyword 为空
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.seed_keywords).toHaveLength(3)
  })

  it('seed_keywords 过滤后不足 3 条仍被拒（质量底线保留）', () => {
    const report = makeValidReport([validSocial])
    report.seed_keywords = [
      { keyword: 'a', type: 'category', rationale: 'r' },
      { keyword: '' },
      { keyword: '' },
    ]
    expect(validateDiscoveryReport(report).ok).toBe(false)
  })

  it('competitors 含坏条目时过滤，合规数 ≥ 3 通过', () => {
    const report = makeValidReport([validSocial])
    report.competitors = [
      { domain: 'a.com', name: 'A', relevance: 'direct', rationale: 'r' },
      { domain: 'b.com', name: 'B', relevance: 'direct', rationale: 'r' },
      { domain: 'c.com', name: 'C', relevance: 'direct', rationale: 'r' },
      { domain: '', name: '' }, // 坏：domain/name 空
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.competitors).toHaveLength(3)
  })

  it('ai_tracker_questions 含坏条目时过滤，合规数 ≥ 5 通过', () => {
    const report = makeValidReport([validSocial])
    report.ai_tracker_questions = [
      { question: 'q1', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q2', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q3', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q4', category: 'brand', market: 'AU', rationale: 'r' },
      { question: 'q5', category: 'brand', market: 'AU', rationale: 'r' },
      { question: '' }, // 坏
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.ai_tracker_questions).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// 7. 深度验证 pass-through 字段（mobile station regression — semrush_snapshot
//    / ai_visibility_results / diagnosis 的 nested array null 不再让 UI 崩）
// ---------------------------------------------------------------------------

describe('validateDiscoveryReport — semrush_snapshot 深度 coerce', () => {
  it('top_keywords: null → coerce 成 []（mobile station 真实 case）', () => {
    const report = makeValidReport([validSocial])
    report.semrush_snapshot = {
      monthly_traffic: null,
      trust_score: null,
      keyword_count: null,
      top_keywords: null,
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.semrush_snapshot?.top_keywords).toEqual([])
  })

  it('top_keywords 含坏 element → 逐条过滤', () => {
    const report = makeValidReport([validSocial])
    report.semrush_snapshot = {
      monthly_traffic: 1000,
      trust_score: 25,
      keyword_count: 50,
      top_keywords: [
        { keyword: 'a', position: 1, volume: 500 },
        { position: 3, volume: 100 }, // 坏：缺 keyword
      ],
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.semrush_snapshot?.top_keywords).toHaveLength(1)
  })

  it('numeric 字段非数字非 null → coerce 成 null', () => {
    const report = makeValidReport([validSocial])
    report.semrush_snapshot = {
      monthly_traffic: 'lots',
      trust_score: null,
      keyword_count: null,
      top_keywords: [],
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.semrush_snapshot?.monthly_traffic).toBeNull()
  })
})

describe('validateDiscoveryReport — ai_visibility_results 深度 coerce', () => {
  it('entry.top_brands: null → coerce 成 []，entry 仍保留', () => {
    const report = makeValidReport([validSocial])
    report.ai_visibility_results = [
      { question: 'q?', top_brands: null, client_mentioned: false },
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.ai_visibility_results).toHaveLength(1)
      expect(r.value.ai_visibility_results?.[0].top_brands).toEqual([])
    }
  })

  it('top_brands 含非 string → 过滤掉非 string', () => {
    const report = makeValidReport([validSocial])
    report.ai_visibility_results = [
      { question: 'q?', top_brands: ['A', 123, 'B', null], client_mentioned: true },
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.ai_visibility_results?.[0].top_brands).toEqual(['A', 'B'])
  })

  it('损坏的 entry（缺 question）→ 过滤掉，合规 entry 保留', () => {
    const report = makeValidReport([validSocial])
    report.ai_visibility_results = [
      { question: 'q1', top_brands: [], client_mentioned: false },
      { client_mentioned: false }, // 缺 question
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.ai_visibility_results).toHaveLength(1)
  })
})

describe('validateDiscoveryReport — diagnosis 深度 coerce', () => {
  it('actions.quick_fix: null → coerce 成 []，报告通过', () => {
    const report = makeValidReport([validSocial])
    report.diagnosis = {
      executive_summary: 's',
      crisis_type: null,
      scores: { seo: 50, social: 30, reputation: 60, ai_visibility: 10, overall: 38 },
      money_flow: 'f',
      key_finding: 'k',
      actions: { quick_fix: null, important: ['x'], talk_to_us: [] },
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.diagnosis?.actions.quick_fix).toEqual([])
  })

  it('scores 缺字段 → coerce 成 0', () => {
    const report = makeValidReport([validSocial])
    report.diagnosis = {
      executive_summary: 's',
      crisis_type: null,
      scores: { seo: 50 },
      money_flow: 'f',
      key_finding: 'k',
      actions: { quick_fix: [], important: [], talk_to_us: [] },
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.diagnosis?.scores.social).toBe(0)
      expect(r.value.diagnosis?.scores.overall).toBe(0)
    }
  })

  it('actions 整个为 null → coerce 成空 actions 对象', () => {
    const report = makeValidReport([validSocial])
    report.diagnosis = {
      executive_summary: 's',
      crisis_type: null,
      scores: { seo: 0, social: 0, reputation: 0, ai_visibility: 0, overall: 0 },
      money_flow: 'f',
      key_finding: 'k',
      actions: null,
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.diagnosis?.actions.quick_fix).toEqual([])
      expect(r.value.diagnosis?.actions.important).toEqual([])
      expect(r.value.diagnosis?.actions.talk_to_us).toEqual([])
    }
  })

  it('crisis_type 非 string 非 null → coerce 成 null', () => {
    const report = makeValidReport([validSocial])
    report.diagnosis = {
      executive_summary: 's',
      crisis_type: 999,
      scores: { seo: 0, social: 0, reputation: 0, ai_visibility: 0, overall: 0 },
      money_flow: 'f',
      key_finding: 'k',
      actions: { quick_fix: [], important: [], talk_to_us: [] },
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.diagnosis?.crisis_type).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// v1.1 · Plugin merge dimensions (P8.13.E · me-client-discovery ports)
// ═══════════════════════════════════════════════════════════════════════════════

const validMediaChannel = {
  media_name: 'East & Bays Courier',
  category: 'print_newspaper',
  chinese_relevant: false,
  coverage_note: 'Bayside 全覆盖',
  reach_metric: 'print_circulation',
  pricing_notes: 'Full page $2,752',
  contact_email: 'david.gadd@stuff.co.nz',
  roi_rank: 1,
  source_urls: ['https://advertise.stuff.co.nz'],
}

const validMarketContext = {
  region_name: 'Auckland Bayside',
  suburbs: ['Mission Bay', 'Kohimarama'],
  median_prices: [
    { suburb: 'Mission Bay', median_price: 2100000, currency: 'NZD', source_url: 'https://homes.co.nz' },
  ],
  demographics: { asian_ethnicity_pct: 34.5, census_year: 2023 },
  market_heat: { median_yoy_pct: -1.92, days_on_market: 34, buyer_or_seller_market: 'buyer' },
  key_insights: ['双市场双话术'],
  data_gaps: ['St Heliers 独立 median 未拿到'],
}

const validSocialFixture = { platform: 'instagram', handle: '@test', url: 'https://ig.com/test', confidence: 0.9 }

describe('validateDiscoveryReport · local_media_channels (v1.1)', () => {
  it('missing field → null', () => {
    const report = makeValidReport([validSocialFixture])
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.local_media_channels).toBeNull()
  })

  it('valid array → passes through', () => {
    const report = makeValidReport([validSocialFixture])
    report.local_media_channels = [validMediaChannel, { ...validMediaChannel, media_name: 'Verve', category: 'print_magazine' }]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.local_media_channels).toHaveLength(2)
      expect(r.value.local_media_channels?.[0].media_name).toBe('East & Bays Courier')
    }
  })

  it('bad category → row filtered out', () => {
    const report = makeValidReport([validSocialFixture])
    report.local_media_channels = [
      validMediaChannel,
      { ...validMediaChannel, media_name: 'Bad', category: 'billboard_freeway' },  // invalid category
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.local_media_channels).toHaveLength(1)
      expect(r.value.local_media_channels?.[0].media_name).toBe('East & Bays Courier')
    }
  })

  it('missing media_name → row filtered out', () => {
    const report = makeValidReport([validSocialFixture])
    report.local_media_channels = [
      validMediaChannel,
      { ...validMediaChannel, media_name: '' },  // empty name
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.local_media_channels).toHaveLength(1)
  })

  it('chinese_relevant missing → coerced to false (not rejected)', () => {
    const report = makeValidReport([validSocialFixture])
    const { chinese_relevant, ...withoutFlag } = validMediaChannel
    void chinese_relevant
    report.local_media_channels = [withoutFlag]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.local_media_channels?.[0].chinese_relevant).toBe(false)
  })

  it('roi_rank out of 1-5 range → coerced to null', () => {
    const report = makeValidReport([validSocialFixture])
    report.local_media_channels = [{ ...validMediaChannel, roi_rank: 99 }]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.local_media_channels?.[0].roi_rank).toBeNull()
  })

  it('bad reach_metric → coerced to "unknown"', () => {
    const report = makeValidReport([validSocialFixture])
    report.local_media_channels = [{ ...validMediaChannel, reach_metric: 'skywriting' }]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.local_media_channels?.[0].reach_metric).toBe('unknown')
  })

  it('root non-array → null (does not reject report)', () => {
    const report = makeValidReport([validSocialFixture])
    report.local_media_channels = 'not an array'
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.local_media_channels).toBeNull()
  })
})

describe('validateDiscoveryReport · market_context (v1.1)', () => {
  it('missing field → null', () => {
    const report = makeValidReport([validSocialFixture])
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.market_context).toBeNull()
  })

  it('valid market context → passes through', () => {
    const report = makeValidReport([validSocialFixture])
    report.market_context = validMarketContext
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.market_context?.region_name).toBe('Auckland Bayside')
      expect(r.value.market_context?.median_prices).toHaveLength(1)
    }
  })

  it('missing region_name → coerced to null (whole context dropped)', () => {
    const report = makeValidReport([validSocialFixture])
    const { region_name, ...withoutRegion } = validMarketContext
    void region_name
    report.market_context = withoutRegion
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.market_context).toBeNull()
  })

  it('bad median_price entry filtered but rest survives', () => {
    const report = makeValidReport([validSocialFixture])
    report.market_context = {
      ...validMarketContext,
      median_prices: [
        { suburb: 'Mission Bay', median_price: 2100000 },
        { median_price: 999 },  // missing suburb
        { suburb: 'Kohi', median_price: 'not a number' },  // bad price coerced to null
      ],
    }
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Entry without suburb filtered; other two kept (bad price → null)
      expect(r.value.market_context?.median_prices).toHaveLength(2)
    }
  })

  it('non-object market_context → null', () => {
    const report = makeValidReport([validSocialFixture])
    report.market_context = 'not an object'
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.market_context).toBeNull()
  })
})

describe('validateDiscoveryReport · sanity_issues (v1.1)', () => {
  it('missing field → null', () => {
    const report = makeValidReport([validSocialFixture])
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.sanity_issues).toBeNull()
  })

  it('valid issues pass through, bad ones dropped', () => {
    const report = makeValidReport([validSocialFixture])
    report.sanity_issues = [
      { severity: 'red', category: 'fabricated_number', location: 'x.y', issue: 'i', fix_suggestion: 'f' },
      { severity: 'green', category: 'fabricated_number', location: 'x', issue: 'i', fix_suggestion: 'f' }, // bad severity
      { severity: 'yellow', category: 'not_a_category', location: 'x', issue: 'i', fix_suggestion: 'f' },  // bad category
      { severity: 'red', category: 'cross_geography', location: '', issue: 'i', fix_suggestion: 'f' },  // empty location
    ]
    const r = validateDiscoveryReport(report)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.sanity_issues).toHaveLength(1)
  })
})
