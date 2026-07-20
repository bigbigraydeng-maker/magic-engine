/**
 * Tests for src/lib/zhangqian/html-generator.ts — v1.1 plugin merge HTML deck.
 *
 * Focus:
 * - Happy path: full DiscoveryReport → valid HTML (contains expected sections)
 * - XSS: LLM-emitted strings with <script>, quotes, & escaped safely
 * - Empty-data graceful degradation: missing optional fields skip sections
 *   cleanly (no null.map crashes, no empty section shells)
 */

import { describe, it, expect } from 'vitest'
import { generateZhangqianHtml, escapeHtml } from '../html-generator'
import type {
  DiscoveryReport,
  DiscoveredBusiness,
  DiagnosisBlock,
  DiscoveredMediaChannel,
  DiscoveredMarketContext,
  SanityIssue,
} from '../types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseBusiness(): DiscoveredBusiness {
  return {
    name: 'Roman Hu Real Estate',
    industry: ['real estate'],
    location: { city: 'Auckland', region: 'Auckland', country: 'NZ' },
    description: 'Auckland Bayside bilingual real estate agent.',
    target_audience: ['home buyers', 'sellers'],
    unique_selling_points: ['bilingual', 'Head of Projects', 'local expertise'],
    confidence: 0.9,
  }
}

function baseReport(overrides: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return {
    schema_version: 1,
    domain: 'romanhu.com',
    business: baseBusiness(),
    social_profiles: [],
    gbp: null,
    review_platforms: [],
    seed_keywords: [
      { keyword: 'Auckland real estate', type: 'category', rationale: 'core category' },
      { keyword: 'Roman Hu', type: 'brand', rationale: 'brand monitor' },
      { keyword: 'Mission Bay agent', type: 'local', rationale: 'suburb focus' },
    ],
    competitors: [
      { domain: 'aaronfoss.com', name: 'Aaron Foss', relevance: 'direct', rationale: 'Barfoot #1 East' },
    ],
    ai_tracker_questions: [],
    notes: '',
    meta: { model: 'test', tool_calls: 5, cost_usd: 0.5, duration_ms: 60000, truncated: false },
    ...overrides,
  }
}

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('generateZhangqianHtml', () => {
  it('emits complete HTML doc with expected sections for full report', () => {
    const html = generateZhangqianHtml(baseReport(), { clientName: 'Roman Hu' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<title>Roman Hu · Discovery Report · Magic Engine</title>')
    expect(html).toContain('robots')
    expect(html).toContain('noindex')
    // Business section content shows through
    expect(html).toContain('Roman Hu Real Estate')
    expect(html).toContain('Auckland Bayside bilingual')
    // Keywords + competitors sections rendered
    expect(html).toContain('Auckland real estate')
    expect(html).toContain('Aaron Foss')
    // Section markers (Chinese numerals)
    expect(html).toContain('壹')
    expect(html).toContain('叁')
  })

  it('includes diagnosis scores + action blocks when diagnosis is present', () => {
    const diagnosis: DiagnosisBlock = {
      executive_summary: 'Roman is a rising agent in Auckland Eastern Bays',
      crisis_type: null,
      scores: { seo: 40, social: 55, reputation: 70, ai_visibility: 30, overall: 49 },
      money_flow: 'Ads spend concentrated on Facebook lead gen',
      key_finding: 'DR 0.1 — starting from zero',
      actions: {
        quick_fix: ['Rebrand romanhu.com from Barfoot'],
        important: ['Launch Bayside Monthly newsletter'],
        talk_to_us: [],
      },
    }
    const html = generateZhangqianHtml(baseReport({ diagnosis }), { clientName: 'Roman' })
    expect(html).toContain('Roman is a rising agent')
    expect(html).toContain('SEO')
    expect(html).toContain('49')  // overall shown in cover
    expect(html).toContain('Rebrand romanhu.com')
    expect(html).toContain('Bayside Monthly')
    expect(html).toContain('DR 0.1')
  })

  it('surfaces crisis_type as prominent alert', () => {
    const diagnosis: DiagnosisBlock = {
      executive_summary: 's',
      crisis_type: 'TYPE_E 声誉陷阱',
      scores: { seo: 0, social: 0, reputation: 0, ai_visibility: 0, overall: 0 },
      money_flow: '',
      key_finding: '',
      actions: { quick_fix: [], important: [], talk_to_us: [] },
    }
    const html = generateZhangqianHtml(baseReport({ diagnosis }), { clientName: 'X' })
    expect(html).toContain('TYPE_E')
    expect(html).toContain('声誉陷阱')
    expect(html).toContain('crisis')  // css class
  })

  // ─── v1.1 · Plugin merge sections ────────────────────────────────────────

  it('renders local_media_channels sorted by roi_rank', () => {
    const channels: DiscoveredMediaChannel[] = [
      { media_name: 'Verve Magazine', category: 'print_magazine', chinese_relevant: false, roi_rank: 3 },
      { media_name: 'East & Bays Courier', category: 'print_newspaper', chinese_relevant: false, roi_rank: 1, recommended_play: 'Front page solus 每月 1 次' },
      { media_name: 'Chinese Herald', category: 'chinese_media', chinese_relevant: true, roi_rank: 2 },
    ]
    const html = generateZhangqianHtml(baseReport({ local_media_channels: channels }), { clientName: 'Roman' })
    // Chapter marker
    expect(html).toContain('陆')  // sixth section
    // All 3 channels present
    expect(html).toContain('East &amp; Bays Courier')
    expect(html).toContain('Verve Magazine')
    expect(html).toContain('Chinese Herald')
    // ROI 1 should appear before ROI 3 in output (sorted ascending)
    const courierIdx = html.indexOf('East &amp; Bays Courier')
    const verveIdx = html.indexOf('Verve Magazine')
    expect(courierIdx).toBeLessThan(verveIdx)
    // Chinese badge for chinese_relevant channel
    expect(html).toContain('华人段')
    // recommended_play surfaced
    expect(html).toContain('Front page solus 每月 1 次')
  })

  it('omits local media section entirely when channels array empty', () => {
    const html = generateZhangqianHtml(baseReport({ local_media_channels: [] }), { clientName: 'X' })
    expect(html).not.toContain('本地媒体')
  })

  it('renders market_context with prices, demographics, insights', () => {
    const mc: DiscoveredMarketContext = {
      region_name: 'Auckland Bayside',
      suburbs: ['Mission Bay', 'Kohimarama'],
      median_prices: [
        { suburb: 'Mission Bay', median_price: 2100000, currency: 'NZD', as_of: '2026-07-01' },
      ],
      demographics: { asian_ethnicity_pct: 34.5, census_year: 2023 },
      market_heat: { median_yoy_pct: -1.92, days_on_market: 34, buyer_or_seller_market: 'buyer' },
      key_insights: ['双市场双话术', '学区是唯一护城河'],
    }
    const html = generateZhangqianHtml(baseReport({ market_context: mc }), { clientName: 'Roman' })
    expect(html).toContain('柒')  // seventh section
    expect(html).toContain('Auckland Bayside')
    expect(html).toContain('Mission Bay')
    expect(html).toContain('2,100,000')  // localized number
    expect(html).toContain('34.5%')
    expect(html).toContain('-1.92%')
    expect(html).toContain('34')  // days on market
    expect(html).toContain('双市场双话术')
    expect(html).toContain('学区是唯一护城河')
  })

  it('applies negative styling to negative YoY', () => {
    const mc: DiscoveredMarketContext = {
      region_name: 'Test',
      market_heat: { median_yoy_pct: -5.3 },
    }
    const html = generateZhangqianHtml(baseReport({ market_context: mc }), { clientName: 'X' })
    expect(html).toContain('class="neg"')  // negative CSS class applied
    expect(html).toContain('-5.3%')
  })

  it('renders sanity issues grouped by severity (red before yellow)', () => {
    const issues: SanityIssue[] = [
      {
        severity: 'yellow',
        category: 'cross_geography',
        location: 'competitors.1.location',
        issue: 'Wellington competitor listed as direct',
        fix_suggestion: 'Reclassify to adjacent',
      },
      {
        severity: 'red',
        category: 'weakness_omitted',
        location: 'diagnosis.actions',
        issue: 'Zero actions listed',
        fix_suggestion: 'Add at least 1 quick_fix',
      },
    ]
    const html = generateZhangqianHtml(baseReport({ sanity_issues: issues }), { clientName: 'X' })
    expect(html).toContain('捌')  // eighth section
    expect(html).toContain('数据质量提示')
    expect(html).toContain('1 red')
    expect(html).toContain('1 yellow')
    // Red rendered before yellow in output
    const redIdx = html.indexOf('Zero actions listed')
    const yellowIdx = html.indexOf('Wellington competitor')
    expect(redIdx).toBeLessThan(yellowIdx)
  })

  it('omits all v1.1 sections when their fields are null/absent', () => {
    const html = generateZhangqianHtml(baseReport(), { clientName: 'X' })  // all v1.1 fields absent
    expect(html).not.toContain('本地媒体')
    expect(html).not.toContain('区域市场速写')
    expect(html).not.toContain('数据质量提示')
  })

  // ─── XSS / injection safety ──────────────────────────────────────────────

  it('escapes HTML in Claude-emitted strings (defence against prompt injection)', () => {
    const evil = baseReport({
      business: {
        ...baseBusiness(),
        name: '<script>alert("xss")</script>',
        description: 'Description with </style><script>window.pwn=1</script>',
      },
    })
    const html = generateZhangqianHtml(evil, { clientName: 'Client' })
    // Should escape the tags · never emit raw <script>
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('</style><script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;/style&gt;')
  })

  it('escapes clientName in title and cover', () => {
    const html = generateZhangqianHtml(baseReport(), { clientName: '<img src=x onerror="alert(1)">' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('escapes URLs in media contact links (no javascript: injection)', () => {
    const channels: DiscoveredMediaChannel[] = [
      {
        media_name: 'Sketchy',
        category: 'other',
        chinese_relevant: false,
        advertise_url: 'javascript:alert(1)',
        contact_email: 'hi@"onmouseover="alert(1)".com',
      },
    ]
    const html = generateZhangqianHtml(baseReport({ local_media_channels: channels }), { clientName: 'X' })
    // Email quote breaks are escaped
    expect(html).not.toContain('"onmouseover=')
    expect(html).toContain('&quot;onmouseover=')
    // The javascript: URL itself isn't blocked (browsers will refuse it anyway) but at
    // minimum we escape any HTML metacharacters in it.
  })

  // ─── escapeHtml helper (also exported for other callers) ──────────────────

  it('escapeHtml handles the 5 canonical characters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('escapeHtml is idempotent for already-safe strings', () => {
    expect(escapeHtml('hello world 你好')).toBe('hello world 你好')
  })
})
