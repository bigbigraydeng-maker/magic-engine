/**
 * Tests for ensureSerpCoverage + pickFallbackQueries.
 *
 * apify google-search-scraper 被 mock 掉，不烧真钱。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScrape = vi.fn()

vi.mock('../../apify/google-search-scraper', () => ({
  scrapeGoogleSerp: (...args: unknown[]) => mockScrape(...args),
}))

import { ensureSerpCoverage, pickFallbackQueries } from '../serp-coverage'
import type {
  DiscoveryReport,
  DiscoveredKeyword,
  DiscoveredAiQuestion,
  DiscoveredSerpResult,
} from '../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function keyword(
  k: string,
  type: DiscoveredKeyword['type'],
): DiscoveredKeyword {
  return {
    keyword: k,
    type,
    rationale: '',
    estimated_volume: null,
  }
}

function aiQ(
  q: string,
  category: DiscoveredAiQuestion['category'],
): DiscoveredAiQuestion {
  return { question: q, category, market: 'NZ', rationale: '' }
}

function fakeSerpResult(query: string): DiscoveredSerpResult {
  return {
    query,
    organic_results: [],
    paid_advertiser_domains: [],
    ai_overview_text: null,
    ai_overview_sources: [],
  }
}

function makeReport(overrides: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return {
    schema_version: 1,
    domain: 'cyhbnz.com',
    business: {
      name: 'CYHB',
      industry: ['fashion'],
      location: { city: 'Auckland', region: null, country: 'NZ' },
      description: '',
      target_audience: [],
      unique_selling_points: [],
      confidence: 0.9,
    },
    social_profiles: [],
    gbp: null,
    review_platforms: [],
    seed_keywords: [],
    competitors: [],
    ai_tracker_questions: [],
    notes: '',
    meta: { model: 'm', tool_calls: 0, cost_usd: 0, duration_ms: 0, truncated: false },
    ...overrides,
  }
}

beforeEach(() => { mockScrape.mockReset() })

// ─── pickFallbackQueries ─────────────────────────────────────────────────────

describe('pickFallbackQueries', () => {
  it('优先从 seed_keywords 挑非 brand 类的前 2 个', () => {
    const report = makeReport({
      seed_keywords: [
        keyword('CYHB', 'brand'),                    // 跳过 — brand
        keyword('luxury dresses Auckland', 'category'),
        keyword('designer dresses Newmarket', 'local'),
        keyword('evening gowns NZ', 'long_tail'),
      ],
    })
    expect(pickFallbackQueries(report, 2)).toEqual([
      { query: 'luxury dresses Auckland', country: 'nz' },
      { query: 'designer dresses Newmarket', country: 'nz' },
    ])
  })

  it('seed_keywords 含品牌词字根（域名 stem）也算 brand，跳过', () => {
    const report = makeReport({
      domain: 'cyhbnz.com',
      seed_keywords: [
        keyword('cyhbnz dresses', 'category'),       // contains "cyhbnz" → 跳过
        keyword('luxury dresses Auckland', 'category'),
      ],
    })
    expect(pickFallbackQueries(report, 2)).toEqual([
      { query: 'luxury dresses Auckland', country: 'nz' },
    ])
  })

  it('seed_keywords 不够时回退到 ai_tracker_questions 的 category/local', () => {
    const report = makeReport({
      seed_keywords: [keyword('luxury dresses Auckland', 'category')],
      ai_tracker_questions: [
        aiQ('what is CYHB', 'brand'),                // brand → 跳过
        aiQ('where can I buy designer dresses in Auckland', 'local'),
        aiQ('comparing aje vs muse', 'comparison'),  // comparison → 跳过
        aiQ('best evening gowns NZ', 'category'),
      ],
    })
    expect(pickFallbackQueries(report, 3)).toEqual([
      { query: 'luxury dresses Auckland', country: 'nz' },
      { query: 'where can I buy designer dresses in Auckland', country: 'nz' },
      { query: 'best evening gowns NZ', country: 'nz' },
    ])
  })

  it('AU 客户用 au 国家代码', () => {
    const report = makeReport({
      business: {
        ...makeReport().business,
        location: { city: 'Brisbane', region: 'QLD', country: 'AU' },
      },
      seed_keywords: [keyword('vinyl flooring brisbane', 'category')],
    })
    expect(pickFallbackQueries(report, 1)).toEqual([
      { query: 'vinyl flooring brisbane', country: 'au' },
    ])
  })

  it('去重（大小写不敏感）', () => {
    const report = makeReport({
      seed_keywords: [
        keyword('Luxury Dresses Auckland', 'category'),
        keyword('luxury dresses auckland', 'category'),
      ],
    })
    expect(pickFallbackQueries(report, 5)).toEqual([
      { query: 'Luxury Dresses Auckland', country: 'nz' },
    ])
  })

  it('全部是 brand → 返回空', () => {
    const report = makeReport({
      seed_keywords: [keyword('CYHB', 'brand'), keyword('CYHB dresses', 'brand')],
    })
    expect(pickFallbackQueries(report)).toEqual([])
  })
})

// ─── ensureSerpCoverage ──────────────────────────────────────────────────────

describe('ensureSerpCoverage', () => {
  it('LLM 已有 serp_results → 不补跑', async () => {
    const report = makeReport({
      serp_results: [fakeSerpResult('vinyl flooring brisbane')],
    })
    const { report: out, result } = await ensureSerpCoverage(report)
    expect(result.applied).toBe(false)
    expect(out).toBe(report)
    expect(mockScrape).not.toHaveBeenCalled()
  })

  it('serp_results 缺 → 自动从 seed_keywords 挑词调 apify', async () => {
    mockScrape.mockImplementation((q: string) => Promise.resolve(fakeSerpResult(q)))
    const report = makeReport({
      seed_keywords: [
        keyword('luxury dresses Auckland', 'category'),
        keyword('designer dresses Newmarket', 'local'),
      ],
    })
    const { report: out, result } = await ensureSerpCoverage(report)
    expect(result.applied).toBe(true)
    expect(result.queriesAdded).toBe(2)
    expect(result.apifyCallsAdded).toBe(2)
    expect(out.serp_results).toHaveLength(2)
    expect(mockScrape).toHaveBeenCalledTimes(2)
    expect(mockScrape).toHaveBeenCalledWith('luxury dresses Auckland', 'nz')
  })

  it('apify 某次失败 → 吞错继续，错误记录在 errors 数组', async () => {
    mockScrape
      .mockResolvedValueOnce(fakeSerpResult('luxury dresses Auckland'))
      .mockRejectedValueOnce(new Error('Apify 502'))
    const report = makeReport({
      seed_keywords: [
        keyword('luxury dresses Auckland', 'category'),
        keyword('designer dresses Newmarket', 'local'),
      ],
    })
    const { report: out, result } = await ensureSerpCoverage(report)
    expect(result.applied).toBe(true)
    expect(result.queriesAdded).toBe(1)         // 只成功 1 次
    expect(result.apifyCallsAdded).toBe(2)      // 但 quota 花了 2 次
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/Apify 502/)
    expect(out.serp_results).toHaveLength(1)
  })

  it('serp_results 空 + 没法挑词 → 返回 applied=false + 错误说明', async () => {
    const report = makeReport({ seed_keywords: [], ai_tracker_questions: [] })
    const { result } = await ensureSerpCoverage(report)
    expect(result.applied).toBe(false)
    expect(result.queriesAdded).toBe(0)
    expect(result.errors[0]).toMatch(/no fallback queries/)
    expect(mockScrape).not.toHaveBeenCalled()
  })

  it('全部 apify 调用失败 → 仍返回 report（serp_results 为空数组）', async () => {
    mockScrape.mockRejectedValue(new Error('Apify down'))
    const report = makeReport({
      seed_keywords: [keyword('luxury dresses Auckland', 'category')],
    })
    const { report: out, result } = await ensureSerpCoverage(report)
    expect(result.applied).toBe(false)
    expect(result.queriesAdded).toBe(0)
    expect(out.serp_results).toEqual([])  // 保持空数组（避免 UI 误以为有数据）
  })

  it('不修改原 report 对象（immutability）', async () => {
    mockScrape.mockResolvedValue(fakeSerpResult('q'))
    const report = makeReport({
      seed_keywords: [keyword('luxury dresses Auckland', 'category')],
    })
    const origSerpResults = report.serp_results
    await ensureSerpCoverage(report)
    expect(report.serp_results).toBe(origSerpResults)  // 原引用未变
  })
})
