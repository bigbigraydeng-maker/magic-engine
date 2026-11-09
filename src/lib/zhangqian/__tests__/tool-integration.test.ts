/**
 * P8.13.E.1 — Sprint A-D 新工具全链路集成测试
 *
 * 验收标准：
 * ① 所有 9 个 Sprint A-D 新工具的 handler 已正确注册到 agent
 * ② 每个 handler 在收到对应 tool_use block 时能调用正确的底层 DataForSEO 函数
 * ③ 底层 API 出错时 handler 优雅降级，不中断主流程
 * ④ 最终 report 包含 technology_stack / domain_whois / onpage_audit / serp_results 字段
 *
 * 所有 Anthropic + DataForSEO + Apify API 均 mock，不烧真钱。
 */

import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'

// ─── Mock 所有外部依赖 ────────────────────────────────────────────────────────

// Anthropic client mock — 必须在 import 之前
const mockCreate = vi.fn()
vi.mock('@/lib/anthropic/client', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  MODEL_SONNET: 'claude-sonnet-4-6',
  parseJsonResponse: (text: string) => {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    return JSON.parse(text.slice(start, end + 1))
  },
}))

// DataForSEO mocks
const mockGetKeywordsForSite = vi.fn()
const mockGetSerpCompetitors = vi.fn()
vi.mock('@/lib/dataforseo/labs', () => ({
  getKeywordsForSite: (...a: unknown[]) => mockGetKeywordsForSite(...a),
  getSerpCompetitors:  (...a: unknown[]) => mockGetSerpCompetitors(...a),
}))

const mockGetDomainTechnologies = vi.fn()
const mockGetDomainWhois = vi.fn()
vi.mock('@/lib/dataforseo/domain-analytics', () => ({
  getDomainTechnologies: (...a: unknown[]) => mockGetDomainTechnologies(...a),
  getDomainWhois:        (...a: unknown[]) => mockGetDomainWhois(...a),
}))

const mockGetSerpPage = vi.fn()
vi.mock('@/lib/dataforseo/serp', () => ({
  getSerpPage: (...a: unknown[]) => mockGetSerpPage(...a),
}))

const mockGetOnPageInstant = vi.fn()
vi.mock('@/lib/dataforseo/onpage', () => ({
  getOnPageInstant: (...a: unknown[]) => mockGetOnPageInstant(...a),
}))

// Local reviews mock (Sprint C)
const mockAggregateLocalReviews = vi.fn()
vi.mock('@/lib/local-reviews/client', () => ({
  aggregateLocalReviews: (...a: unknown[]) => mockAggregateLocalReviews(...a),
}))

// Jina / ABR / Apify mocks (existing tools — minimal)
vi.mock('@/lib/brief/jina', () => ({
  fetchUrlAsMarkdown: vi.fn().mockResolvedValue({ title: 'Homepage', markdown: '# CTS Tours\nTour operator.' }),
}))
vi.mock('@/lib/abr/client', () => ({
  verifyBusinessRegistration: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/apify/social-scraper', () => ({
  scrapeInstagramProfile: vi.fn().mockResolvedValue({ followersCount: 1000, postsLast30Days: 8, engagementRate: 0.03 }),
  scrapeTiktokProfile:    vi.fn().mockResolvedValue({ followersCount: 500,  postsLast30Days: 4, engagementRate: 0.02 }),
}))
// SERP coverage post-processor — avoid duplicate DataForSEO calls in tests
vi.mock('../serp-coverage', () => ({
  ensureSerpCoverage: (report: unknown) => Promise.resolve({
    report,
    result: { applied: false, queriesAdded: 0, serpCallsAdded: 0, estimatedExtraCostUsd: 0, errors: [] },
  }),
  // 真模块导出的"最坏耗时"—— agent 用它对自己的 deadline。假件必须跟着真模块走,
  // 否则这里静默漏掉一个 export,整片测试会以"mock 缺导出"的形式炸掉。
  SERP_COVERAGE_WORST_CASE_MS: 120_000,
}))

// ─── Import subject under test ────────────────────────────────────────────────

import { runZhangqian } from '../agent'

// ─── Fixture data ────────────────────────────────────────────────────────────

const DOMAIN_CTS = 'cts-tours.com'

/** Minimal valid DiscoveryReport JSON that Claude would return. */
const FINAL_REPORT_JSON = JSON.stringify({
  schema_version: 1,
  domain: DOMAIN_CTS,
  business: {
    name: 'CTS Tours',
    industry: ['tourism', 'travel'],
    location: { city: 'Auckland', region: null, country: 'NZ' },
    description: 'CTS Tours is a New Zealand tour operator.',
    target_audience: ['international tourists'],
    unique_selling_points: ['expert local guides'],
    confidence: 0.9,
    phone_numbers: ['+64 9 123 4567'],
    emails: ['info@cts-tours.com'],
  },
  social_profiles: [
    { platform: 'instagram', handle: '@ctstours', url: 'https://instagram.com/ctstours', confidence: 0.8 },
  ],
  gbp: null,
  review_platforms: [
    { platform: 'google', url: 'https://maps.google.com/?cid=123', rating: 4.5, review_count: 86 },
    { platform: 'tripadvisor', url: 'https://tripadvisor.com/cts-tours', rating: 4.7, review_count: 213 },
  ],
  seed_keywords: [
    { keyword: 'new zealand tours', type: 'category', rationale: 'core category', semrush_volume: 5400, semrush_kd: 32 },
    { keyword: 'cts tours nz',      type: 'brand',    rationale: 'brand',          semrush_volume: 880,  semrush_kd: 5  },
    { keyword: 'nz tour packages',  type: 'category', rationale: 'high intent',    semrush_volume: 3200, semrush_kd: 28 },
  ],
  competitors: [
    { domain: 'graytline.co.nz',    name: 'Gray Line NZ',    relevance: 'direct',      rationale: 'direct competitor', monthly_traffic: 12000 },
    { domain: 'experiencenz.com',   name: 'Experience NZ',   relevance: 'direct',      rationale: 'direct competitor', monthly_traffic: 8500  },
    { domain: 'tourmagazine.co.nz', name: 'Tour Magazine NZ', relevance: 'adjacent',   rationale: 'adjacent',          monthly_traffic: 4200  },
  ],
  ai_tracker_questions: [
    { question: 'best tour operator in New Zealand', category: 'category', market: 'NZ', rationale: 'core' },
    { question: 'CTS Tours reviews',                 category: 'brand',    market: 'NZ', rationale: 'brand' },
    { question: 'guided tours Auckland',             category: 'local',    market: 'NZ', rationale: 'local' },
    { question: 'NZ tour packages comparison',       category: 'comparison', market: 'NZ', rationale: 'comparison' },
    { question: 'top NZ travel companies',           category: 'category', market: 'NZ', rationale: 'category' },
  ],
  notes: 'All Sprint A-D tools fired.',
  technology_stack: {
    cms: 'WordPress',
    ecommerce: null,
    analytics: ['Google Analytics 4'],
    crm_marketing: [],
    chat: null,
    domain_rank: 22,
    phone_numbers: ['+64 9 123 4567'],
    emails: ['info@cts-tours.com'],
    social_graph_urls: ['https://instagram.com/ctstours', 'https://facebook.com/ctstours'],
  },
  domain_whois: {
    registered_at: '2003-04-15',
    expires_at: '2027-04-15',
    registrar: 'Domainz',
    domain_age_years: 22,
    referring_domains: 415,
    backlinks: 1820,
    organic_etv: 890,
    organic_keywords_top10: 67,
  },
  serp_results: [
    {
      query: 'best tour operator in New Zealand',
      organic_results: [{ position: 1, title: 'Top NZ Tours', url: 'https://graytline.co.nz', description: '...' }],
      paid_advertiser_domains: [],
      ai_overview_text: 'New Zealand has many excellent tour operators including CTS Tours.',
      ai_overview_sources: ['https://cts-tours.com/about'],
    },
  ],
  onpage_audit: {
    status_code: 200,
    title: 'CTS Tours — New Zealand Tour Operator',
    description: 'Explore New Zealand with CTS Tours.',
    canonical: 'https://cts-tours.com/',
    h1: 'Discover New Zealand',
    internal_links: 42,
    external_links: 8,
    images_no_alt: 3,
    images_total: 18,
    word_count: 620,
    core_web_vitals: { lcp: 2400, cls: 0.08, tbt: 180 },
    checks: {
      no_title: false,
      no_description: false,
      no_h1: false,
      missing_alt_text: true,
      broken_links: false,
      redirect_chain: false,
      https: true,
    },
  },
})

// ─── Helper to build a tool_use block ────────────────────────────────────────

let idCounter = 0
function toolUseBlock(name: string, input: Record<string, unknown>) {
  return { type: 'tool_use', id: `tu_${++idCounter}`, name, input }
}

// ─── Fixture: Sprint A-D tool payloads ───────────────────────────────────────

const FIXTURE_KEYWORDS = [
  { keyword: 'new zealand tours', search_volume: 5400, keyword_difficulty: 32, cpc: 1.2 },
  { keyword: 'nz tour packages',  search_volume: 3200, keyword_difficulty: 28, cpc: 0.9 },
]

const FIXTURE_COMPETITORS = [
  { domain: 'graytline.co.nz',  monthly_traffic: 12000, keyword_count: 430 },
  { domain: 'experiencenz.com', monthly_traffic: 8500,  keyword_count: 280 },
]

const FIXTURE_TECHNOLOGIES = {
  cms: 'WordPress',
  ecommerce: null,
  analytics: ['Google Analytics 4'],
  crm_marketing: [],
  chat: null,
  domain_rank: 22,
  phone_numbers: ['+64 9 123 4567'],
  emails: ['info@cts-tours.com'],
  social_graph_urls: ['https://instagram.com/ctstours'],
}

const FIXTURE_WHOIS = {
  registered_at: '2003-04-15',
  expires_at: '2027-04-15',
  registrar: 'Domainz',
  domain_age_years: 22,
  referring_domains: 415,
  backlinks: 1820,
  organic_etv: 890,
  organic_keywords_top10: 67,
}

const FIXTURE_SERP = {
  query: 'best tour operator in New Zealand',
  organic_results: [{ position: 1, title: 'Top NZ Tours', url: 'https://graytline.co.nz', description: '...' }],
  paid_advertiser_domains: [],
  ai_overview_text: 'New Zealand has many excellent tour operators including CTS Tours.',
  ai_overview_sources: ['https://cts-tours.com/about'],
}

const FIXTURE_ONPAGE = {
  url: 'https://cts-tours.com/',
  status_code: 200,
  title: 'CTS Tours — New Zealand Tour Operator',
  description: 'Explore New Zealand with CTS Tours.',
  canonical: 'https://cts-tours.com/',
  h1: 'Discover New Zealand',
  internal_links: 42,
  external_links: 8,
  images_no_alt: 3,
  images_total: 18,
  word_count: 620,
  core_web_vitals: { lcp: 2400, cls: 0.08, tbt: 180 },
  checks: {
    no_title: false, no_description: false, no_h1: false,
    missing_alt_text: true, broken_links: false, redirect_chain: false, https: true,
  },
}

const FIXTURE_REVIEWS = [
  {
    platform: 'google',
    url: 'https://maps.google.com/?cid=123',
    rating: 4.5,
    review_count: 86,
    rating_distribution: { '1': 2, '2': 1, '3': 5, '4': 18, '5': 60 },
    recent_negative_samples: [],
    response_rate: null,
  },
]

// ─── Shared mock response builder ────────────────────────────────────────────

function mockUsage() {
  return { input_tokens: 1000, output_tokens: 500 }
}

function buildToolUseResponse(toolUses: ReturnType<typeof toolUseBlock>[]) {
  return {
    stop_reason: 'tool_use',
    content: toolUses,
    usage: mockUsage(),
  }
}

function buildEndTurnResponse(text: string) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: mockUsage(),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  idCounter = 0

  // Reset DataForSEO mocks to happy-path fixtures
  mockGetKeywordsForSite.mockResolvedValue(FIXTURE_KEYWORDS)
  mockGetSerpCompetitors.mockResolvedValue(FIXTURE_COMPETITORS)
  mockGetDomainTechnologies.mockResolvedValue(FIXTURE_TECHNOLOGIES)
  mockGetDomainWhois.mockResolvedValue(FIXTURE_WHOIS)
  mockGetSerpPage.mockResolvedValue(FIXTURE_SERP)
  mockGetOnPageInstant.mockResolvedValue(FIXTURE_ONPAGE)
  mockAggregateLocalReviews.mockResolvedValue(FIXTURE_REVIEWS)
})

// ─── E.1.1 Sprint A — fetch_keyword_data + fetch_competitors ─────────────────

describe('Sprint A 工具验收 — DataForSEO Labs 关键词 + 竞品', () => {
  it('fetch_keyword_data: 调用 getKeywordsForSite，返回结构化关键词数组', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_keyword_data', { domain: DOMAIN_CTS, location: 'NZ' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockGetKeywordsForSite).toHaveBeenCalledWith(DOMAIN_CTS, 2554, 50)
    // Result should have been passed back to Claude
    const secondCall = mockCreate.mock.calls[1]
    const messages = secondCall[0].messages as Array<{ role: string; content: unknown }>
    const toolResults = messages.find(m => m.role === 'user' && Array.isArray(m.content))
    expect(toolResults).toBeDefined()
    const content = toolResults!.content as Array<{ content?: string }>
    expect(content[0].content).toContain('new zealand tours')
  })

  it('fetch_competitors: 调用 getSerpCompetitors，返回竞品域名列表', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_competitors', { domain: DOMAIN_CTS, location: 'NZ' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockGetSerpCompetitors).toHaveBeenCalledWith(DOMAIN_CTS, 2554, 10)
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toContain('graytline.co.nz')
  })

  it('fetch_keyword_data 空结果时降级提示 web_search', async () => {
    mockGetKeywordsForSite.mockResolvedValue([])
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_keyword_data', { domain: 'brand-new-domain.com' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian('brand-new-domain.com')

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/Fall back to web_search/)
  })
})

// ─── E.1.2 Sprint B — fetch_domain_technologies + fetch_domain_whois ─────────

describe('Sprint B 工具验收 — Domain Analytics 技术栈 + WHOIS', () => {
  it('fetch_domain_technologies: 调用 getDomainTechnologies，返回 CMS + 社媒 URLs', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_domain_technologies', { domain: DOMAIN_CTS }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockGetDomainTechnologies).toHaveBeenCalledWith(DOMAIN_CTS)
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toContain('WordPress')
  })

  it('fetch_domain_technologies null → 返回"No technology data"提示', async () => {
    mockGetDomainTechnologies.mockResolvedValue(null)
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_domain_technologies', { domain: DOMAIN_CTS }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/No technology data found/)
  })

  it('fetch_domain_whois: 调用 getDomainWhois，返回域名年龄 + 到期日', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_domain_whois', { domain: DOMAIN_CTS }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockGetDomainWhois).toHaveBeenCalledWith(DOMAIN_CTS)
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toContain('Domainz')
    expect(content).toContain('2027-04-15')
  })

  it('fetch_domain_whois 到期 < 90 天时注入到期预警', async () => {
    const soon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    mockGetDomainWhois.mockResolvedValue({ ...FIXTURE_WHOIS, expires_at: soon })

    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_domain_whois', { domain: DOMAIN_CTS }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/IMPORTANT: domain expires in \d+ days/)
    // The warning names the exact expiry date and tells Claude what note to write.
    expect(content).toContain(`(${soon})`)
    expect(content).toContain('域名将于 X 天后到期，请立即续费')
    // The raw WHOIS JSON is still passed through ahead of the warning.
    const jsonPart = String(content).slice(0, String(content).indexOf(' IMPORTANT:'))
    expect(JSON.parse(jsonPart)).toMatchObject({ expires_at: soon, registrar: 'Domainz' })
  })
})

// ─── E.1.3 Sprint C — fetch_local_reviews (DataForSEO Business Data) ─────────

describe('Sprint C 工具验收 — Business Data API 评论聚合', () => {
  it('fetch_local_reviews: 调用 aggregateLocalReviews，返回 GBP + 评价数据', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_local_reviews', {
          business_query: 'CTS Tours Auckland NZ',
          tripadvisor_keyword: 'CTS Tours New Zealand',
        }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockAggregateLocalReviews).toHaveBeenCalledWith(expect.objectContaining({
      businessQuery: 'CTS Tours Auckland NZ',
      tripadvisorKeyword: 'CTS Tours New Zealand',
    }))
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toContain('google')
  })

  it('tripadvisor_keyword 省略时 aggregateLocalReviews 不传该参数', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_local_reviews', { business_query: 'Oztop Slacks Creek QLD' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian('oztop.com.au')

    expect(mockAggregateLocalReviews).toHaveBeenCalledWith(expect.objectContaining({
      businessQuery: 'Oztop Slacks Creek QLD',
      tripadvisorKeyword: undefined,
    }))
  })

  it('评论数据空时返回提示不猜评分', async () => {
    mockAggregateLocalReviews.mockResolvedValue([])
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_local_reviews', { business_query: 'No Data Business Melbourne VIC' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/do not guess ratings/)
  })
})

// ─── E.1.4 Sprint D — fetch_serp_results + fetch_onpage_audit ────────────────

describe('Sprint D 工具验收 — SERP API + OnPage 审计', () => {
  it('fetch_serp_results: DataForSEO 优先路径，返回 AI Overview + 有机排名', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_serp_results', {
          query: 'best tour operator in New Zealand',
          country: 'NZ',
        }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockGetSerpPage).toHaveBeenCalledWith(
      'best tour operator in New Zealand',
      'nz',
    )
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toContain('ai_overview_text')
    expect(content).toContain('CTS Tours')
  })

  it('fetch_onpage_audit: 调用 getOnPageInstant，返回 Core Web Vitals + checks', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_onpage_audit', { url: 'https://cts-tours.com/' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    expect(mockGetOnPageInstant).toHaveBeenCalledWith('https://cts-tours.com/')
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toContain('core_web_vitals')
  })

  it('fetch_onpage_audit 发现问题时附 summary 提示写入 quick_fix', async () => {
    mockGetOnPageInstant.mockResolvedValue({
      ...FIXTURE_ONPAGE,
      checks: { ...FIXTURE_ONPAGE.checks, no_description: true, missing_alt_text: true },
    })
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_onpage_audit', { url: 'https://cts-tours.com/' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/Summary: Issues found: missing meta description, 3 images missing alt text\./)
    expect(content).toContain('Add relevant issues to the notes field.')
    // The raw audit JSON is still passed through ahead of the summary.
    const jsonPart = String(content).slice(0, String(content).indexOf('\n\nSummary:'))
    expect(JSON.parse(jsonPart)).toMatchObject({
      url: 'https://cts-tours.com/',
      images_no_alt: 3,
      checks: { no_description: true, missing_alt_text: true },
    })
  })

  it('fetch_onpage_audit null 时返回"No on-page audit data"，不中断', async () => {
    mockGetOnPageInstant.mockResolvedValue(null)
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_onpage_audit', { url: 'https://unreachable-site.com/' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await expect(runZhangqian(DOMAIN_CTS)).resolves.toBeDefined()

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/No on-page audit data/)
  })
})

// ─── E.1.5 全链路：所有 Sprint A-D 工具一轮全触发 ────────────────────────────

describe('E.1.5 全链路验收 — Sprint A-D 新工具全部触发', () => {
  it('单轮并发触发所有 9 个 Sprint A-D 新工具，最终报告包含所有新字段', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        // Sprint A
        toolUseBlock('fetch_keyword_data',         { domain: DOMAIN_CTS, location: 'NZ' }),
        toolUseBlock('fetch_competitors',          { domain: DOMAIN_CTS, location: 'NZ' }),
        // Sprint B
        toolUseBlock('fetch_domain_technologies',  { domain: DOMAIN_CTS }),
        toolUseBlock('fetch_domain_whois',         { domain: DOMAIN_CTS }),
        // Sprint C
        toolUseBlock('fetch_local_reviews',        { business_query: 'CTS Tours Auckland NZ', tripadvisor_keyword: 'CTS Tours NZ' }),
        // Sprint D
        toolUseBlock('fetch_serp_results',         { query: 'best tour operator New Zealand', country: 'NZ' }),
        toolUseBlock('fetch_onpage_audit',         { url: 'https://cts-tours.com/' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    const result = await runZhangqian(DOMAIN_CTS)

    // All handlers were invoked
    expect(mockGetKeywordsForSite).toHaveBeenCalledTimes(1)
    expect(mockGetSerpCompetitors).toHaveBeenCalledTimes(1)
    expect(mockGetDomainTechnologies).toHaveBeenCalledTimes(1)
    expect(mockGetDomainWhois).toHaveBeenCalledTimes(1)
    expect(mockAggregateLocalReviews).toHaveBeenCalledTimes(1)
    expect(mockGetSerpPage).toHaveBeenCalledTimes(1)
    expect(mockGetOnPageInstant).toHaveBeenCalledTimes(1)

    // Report passes validation and includes new fields
    expect(result.validation_error).toBeNull()
    expect(result.report.technology_stack).toBeTruthy()
    expect(result.report.technology_stack?.cms).toBe('WordPress')
    expect(result.report.domain_whois).toBeTruthy()
    expect(result.report.domain_whois?.domain_age_years).toBe(22)
    expect(result.report.serp_results).toHaveLength(1)
    expect(result.report.serp_results?.[0].ai_overview_text).toContain('CTS Tours')
    expect(result.report.onpage_audit).toBeTruthy()
    expect(result.report.onpage_audit?.checks.https).toBe(true)
    // Competitors should have real traffic data
    expect(result.report.competitors[0].monthly_traffic).toBe(12000)
    // Keywords should have semrush_volume (from DFSE labs data)
    expect(result.report.seed_keywords[0].semrush_volume).toBe(5400)
  })

  it('report.meta.tool_calls 计入了新工具调用次数', async () => {
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_keyword_data',        { domain: DOMAIN_CTS }),
        toolUseBlock('fetch_domain_technologies', { domain: DOMAIN_CTS }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    const result = await runZhangqian(DOMAIN_CTS)

    // At minimum 2 client-side tool calls (above) were made
    expect(result.report.meta.tool_calls).toBeGreaterThanOrEqual(2)
  })
})

// ─── E.1.6 错误处理 — DataForSEO API 故障时优雅降级 ─────────────────────────

describe('E.1.6 错误降级 — DataForSEO 故障不中断主流程', () => {
  it('fetch_keyword_data API 抛出异常 → 返回 fallback 提示，不抛出', async () => {
    mockGetKeywordsForSite.mockRejectedValue(new Error('DataForSEO 503'))
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_keyword_data', { domain: DOMAIN_CTS }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    const result = await runZhangqian(DOMAIN_CTS)
    expect(result.validation_error).toBeNull()

    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/Fall back to web_search/)
  })

  it('fetch_onpage_audit API 抛出异常 → 优雅降级不崩溃', async () => {
    mockGetOnPageInstant.mockRejectedValue(new Error('OnPage timeout'))
    mockCreate
      .mockResolvedValueOnce(buildToolUseResponse([
        toolUseBlock('fetch_onpage_audit', { url: 'https://cts-tours.com/' }),
      ]))
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await expect(runZhangqian(DOMAIN_CTS)).resolves.toBeDefined()
    const secondCall = mockCreate.mock.calls[1]
    const toolResultMsg = (secondCall[0].messages as Array<{ role: string; content: unknown }>)
      .find(m => m.role === 'user' && Array.isArray(m.content))
    const content = (toolResultMsg!.content as Array<{ content?: string }>)[0].content
    expect(content).toMatch(/Set onpage_audit to null/)
  })
})

// ─── E.1.7 工具注册验收 — 所有 10 个工具均已在 agent tools 数组中 ─────────────

describe('E.1.7 工具注册验收 — 所有 10 个工具均传给 Claude', () => {
  it('messages.create 收到的 tools 数组覆盖全部 10 个工具', async () => {
    mockCreate
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    const firstCall = mockCreate.mock.calls[0]
    const tools = firstCall[0].tools as Array<{ name?: string; type?: string }>
    const toolNames = tools.map(t => t.name ?? t.type)

    // Sprint A
    expect(toolNames).toContain('fetch_keyword_data')
    expect(toolNames).toContain('fetch_competitors')
    // Sprint B
    expect(toolNames).toContain('fetch_domain_technologies')
    expect(toolNames).toContain('fetch_domain_whois')
    // Sprint C
    expect(toolNames).toContain('fetch_local_reviews')
    // Sprint D
    expect(toolNames).toContain('fetch_serp_results')
    expect(toolNames).toContain('fetch_onpage_audit')
    // Pre-existing tools still present
    expect(toolNames).toContain('fetch_url')
    expect(toolNames).toContain('verify_business_registration')
    // web_search is server-side — registered with name: 'web_search'
    expect(toolNames).toContain('web_search')
    // fetch_social_metrics was intentionally removed — social metrics are
    // discovered via web_search + fetch_url (see agent.ts).
    expect(toolNames).not.toContain('fetch_social_metrics')
    expect(toolNames).toHaveLength(10)
  })

  it('每个新工具的 input_schema 包含 required 字段定义', async () => {
    mockCreate
      .mockResolvedValueOnce(buildEndTurnResponse(FINAL_REPORT_JSON))

    await runZhangqian(DOMAIN_CTS)

    const firstCall = mockCreate.mock.calls[0]
    const tools = (firstCall[0].tools as Array<{ name?: string; input_schema?: { required?: string[] } }>)
      .filter(t => t.name)

    const findTool = (name: string) => tools.find(t => t.name === name)

    // Verify required fields for Sprint A-D tools
    expect(findTool('fetch_keyword_data')?.input_schema?.required).toContain('domain')
    expect(findTool('fetch_competitors')?.input_schema?.required).toContain('domain')
    expect(findTool('fetch_domain_technologies')?.input_schema?.required).toContain('domain')
    expect(findTool('fetch_domain_whois')?.input_schema?.required).toContain('domain')
    expect(findTool('fetch_local_reviews')?.input_schema?.required).toContain('business_query')
    expect(findTool('fetch_serp_results')?.input_schema?.required).toContain('query')
    expect(findTool('fetch_onpage_audit')?.input_schema?.required).toContain('url')
  })
})
