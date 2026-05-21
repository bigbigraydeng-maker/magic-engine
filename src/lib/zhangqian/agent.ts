/**
 * 张骞 Zhangqian — Discovery Agent main entry point.
 *
 * Reference: ROADMAP.md P8.10.S0.4
 *
 * Architecture:
 *   - Claude Sonnet 4.5 with two tools:
 *     - `web_search`  → native Anthropic server-side tool (auto-resolved)
 *     - `fetch_url`   → client-side tool backed by Jina Reader
 *   - Manual tool loop for `fetch_url` only; web_search is fully server-side.
 *   - Hard caps: 15 tool calls, $1 USD spend. Whichever hits first terminates
 *     the loop with `truncated: true` and the partial report.
 *   - Final assistant text must be a single JSON object; validated by
 *     validators.ts before being returned.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET, parseJsonResponse } from '@/lib/anthropic/client'
import { fetchUrlAsMarkdown } from '@/lib/brief/jina'
import { verifyBusinessRegistration } from '@/lib/abr/client'
import { aggregateLocalReviews } from '@/lib/local-reviews/client'
// Facebook page + Meta Ad Library scrapers intentionally excluded from the
// first-time discovery — they are the slowest connectors and have the lowest
// hit rate on cold domains. They re-appear in the Phase 8.10.S5 advanced
// pass, gated behind explicit user connector authorisation.
import { scrapeInstagramProfile, scrapeTiktokProfile } from '@/lib/apify/social-scraper'
import { getKeywordsForSite, getSerpCompetitors } from '@/lib/dataforseo/labs'
import { getDomainTechnologies, getDomainWhois } from '@/lib/dataforseo/domain-analytics'
import { getSerpPage } from '@/lib/dataforseo/serp'
import { getOnPageInstant } from '@/lib/dataforseo/onpage'
import type { DiscoveryReport } from './types'
import { ZHANGQIAN_SYSTEM_PROMPT, buildUserPrompt } from './prompts'
import { validateDiscoveryReport } from './validators'
import { ensureSerpCoverage } from './serp-coverage'

// ─── Constants ────────────────────────────────────────────────────────────────

// First-time discovery budget. Slimmer than the historic 22-call budget
// because Meta Ad Library + Facebook page scrapers (the two slowest connectors)
// are deferred to the Phase 8.10.S5 advanced pass. 18 calls comfortably covers:
// homepage + registration (2) + IG/TikTok social (2-3) + GBP local reviews (1)
// + competitors + their homepages (4-5) + SERP scrapes (2-3) + final synthesis.
//
// P8.13 cost baseline (full Sprint A-D toolset, per first-time discovery):
//   Claude Sonnet tokens    ~$0.23
//   web_search calls (×8)   ~$0.08
//   DataForSEO Labs         ~$0.04  (keywords + competitors)
//   Domain Analytics        ~$0.11  (technologies + whois)
//   Business Data           ~$0.03  (GBP + reviews + optional tripadvisor)
//   SERP API                ~$0.01  (1-2 queries × $0.005)
//   OnPage API              ~$0.003 (1 homepage audit)
//   ─────────────────────────────────
//   Total per client        ≈ $0.57 (one-time onboarding cost)
const MAX_TOOL_CALLS = 18
const MAX_COST_USD = 1.50
// 24K covers full discovery JSON (business + 15 keywords + competitors + AI
// questions + diagnosis + actions, including long-form Chinese descriptions).
// 8096 was hitting truncation at ~14K chars, leaving JSON unparseable mid-string.
const MAX_OUTPUT_TOKENS = 24_000
const FETCH_URL_TIMEOUT_MS = 15_000
const LOCAL_REVIEWS_TIMEOUT_MS = 45_000
// Per-turn Anthropic call cap. Anthropic SDK default is 10 min, which can
// blow past our 4.5 min global wall-clock when a single tool turn stalls
// server-side. 150 s covers web_search turns where Anthropic searches multiple
// queries server-side; 90 s was too tight and caused spurious timeout failures.
const CLAUDE_CALL_TIMEOUT_MS = 150_000
// Hard wall-clock cap: trigger graceful finalization at 5 min so the
// full round-trip (final Claude call + overhead) lands under the 6-min
// stale-job threshold. First-time users should never wait longer than this —
// deeper analysis lives behind authorized connectors (Phase 8.10.S5).
const GLOBAL_TIMEOUT_MS = 300_000

// Sonnet 4.5 pricing per million tokens (must match anthropic/client.ts)
const PRICE_INPUT_PER_M = 3.0
const PRICE_OUTPUT_PER_M = 15.0
// Web search tool surcharge per call (Anthropic billing, approx)
const PRICE_WEB_SEARCH_PER_CALL = 0.01

// ─── Tool definitions ────────────────────────────────────────────────────────

/**
 * Native Anthropic web search tool. Claude executes this server-side; we
 * never see a `tool_use` block for it — results are inlined into the
 * assistant's next response.
 */
const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 8,                      // separate cap inside the 12-call budget
} as unknown as Anthropic.Messages.Tool

/**
 * Client-side tool: fetch a URL via Jina Reader and return markdown.
 * We resolve this in the tool loop.
 */
const FETCH_URL_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_url',
  description:
    'Fetch the markdown content of any web page via Jina Reader. Use this for the target homepage, competitor sites, social profile pages, and review platform pages. Bypasses most WAF/bot-blocking. Returns markdown text up to ~50KB.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'Full https:// URL to fetch.',
      },
    },
    required: ['url'],
  },
}

/**
 * Client-side tool: verify a business against the official government
 * registry (ABR for AU, NZBN for NZ). Backed by src/lib/abr/client.ts.
 */
const VERIFY_BUSINESS_REGISTRATION_TOOL: Anthropic.Messages.Tool = {
  name: 'verify_business_registration',
  description:
    'Verify a business against the official government registry — ABR for AU, NZBN for NZ. Accepts an ABN/NZBN number OR a business name to fuzzy-search. Returns the verified legal entity name, entity type, registration status, registration date, and GST status. Call this once to populate business.registration with real data instead of guessing.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description:
          'An ABN (11 digits) / NZBN (13 digits), or a business / entity name to search.',
      },
      market: {
        type: 'string',
        enum: ['AU', 'NZ'],
        description: 'Which registry to query.',
      },
      state: {
        type: 'string',
        description:
          'Optional AU state code (e.g. "QLD") to narrow a name search. Ignored for NZ.',
      },
    },
    required: ['query', 'market'],
  },
}

/**
 * Client-side tool: aggregate real review data from Google Business
 * Profile, ProductReview.com.au, and optionally Tripadvisor.
 * Backed by src/lib/local-reviews/client.ts.
 */
const FETCH_LOCAL_REVIEWS_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_local_reviews',
  description:
    'Aggregate real review data from Google Business Profile (DataForSEO), ProductReview.com.au, and optionally Tripadvisor. Returns verified ratings, review counts, and sample negative reviews. Use this instead of guessing reputation numbers. For tourism clients (e.g. CTS Tours), pass tripadvisor_keyword to also fetch the Tripadvisor listing.',
  input_schema: {
    type: 'object' as const,
    properties: {
      business_query: {
        type: 'string',
        description:
          'Business name plus city and state, e.g. "Oztop Building Supplies Slacks Creek QLD".',
      },
      productreview_url: {
        type: 'string',
        description:
          'Optional ProductReview.com.au listing URL, if you have already found it.',
      },
      tripadvisor_keyword: {
        type: 'string',
        description:
          'Optional keyword to search Tripadvisor (for tourism clients). E.g. "CTS Tours New Zealand". Omit for non-tourism businesses.',
      },
    },
    required: ['business_query'],
  },
}

/**
 * Client-side tool: fetch real social metrics (followers, recent posts,
 * engagement) for a profile via Apify scrapers. Backed by
 * src/lib/apify/social-scraper.ts.
 */
const FETCH_SOCIAL_METRICS_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_social_metrics',
  description:
    'Fetch real follower count, recent post volume, and engagement rate for a social profile via Apify scrapers. Supports instagram and tiktok. (Facebook is intentionally excluded from first-time discovery — it is the slowest scraper and re-appears in the Phase 8.10.S5 advanced pass once the user authorises a connector.) Call this for the 1-2 most important social accounts you found — it returns hard numbers instead of guesses. Each call is a paid API call, so do not call it for every minor profile.',
  input_schema: {
    type: 'object' as const,
    properties: {
      platform: {
        type: 'string',
        enum: ['instagram', 'tiktok'],
        description: 'Which platform the profile is on.',
      },
      handle_or_url: {
        type: 'string',
        description: 'The handle (with or without @).',
      },
    },
    required: ['platform', 'handle_or_url'],
  },
}

// fetch_meta_ads tool removed for first-time discovery (Phase 8.10.S5 will
// re-introduce it on the advanced pass once the user authorises the connector).

/**
 * Client-side tool: fetch real keyword data from DataForSEO Labs.
 * Replaces web_search guessing for seed keyword discovery.
 */
const FETCH_KEYWORD_DATA_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_keyword_data',
  description:
    '从 DataForSEO Labs 获取某个域名的真实有机排名关键词（含搜索量、难度、CPC）。' +
    '用这个工具**代替 web_search 猜关键词**——返回的是 Google 真实搜索数据，零幻觉风险。' +
    '调用一次即可，最多返回 50 条关键词，按搜索量降序排列。' +
    '如果域名太新或流量极低，返回空数组；此时再用 web_search 补充。',
  input_schema: {
    type: 'object' as const,
    properties: {
      domain: {
        type: 'string',
        description: '目标域名，不带协议和路径，如 "oztop.com.au"',
      },
      location: {
        type: 'string',
        enum: ['AU', 'NZ'],
        description: '搜索市场（默认 AU）',
      },
    },
    required: ['domain'],
  },
}

/**
 * Client-side tool: discover competitor domains from DataForSEO Labs.
 * Replaces web_search guessing for competitor discovery.
 */
const FETCH_COMPETITORS_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_competitors',
  description:
    '从 DataForSEO Labs 获取某个域名的有机搜索竞品列表（含共同关键词数、月流量估算）。' +
    '用这个工具**代替 web_search 猜竞品**——基于真实 Google 有机排名数据，比 AI 猜测准确得多。' +
    '调用一次即可，返回 top-10 竞品域名。' +
    '如果数据不足，再用 web_search 补充。返回的竞品需结合行业背景进行人工判断，排除明显不相关的结果。',
  input_schema: {
    type: 'object' as const,
    properties: {
      domain: {
        type: 'string',
        description: '目标域名，不带协议和路径，如 "oztop.com.au"',
      },
      location: {
        type: 'string',
        enum: ['AU', 'NZ'],
        description: '搜索市场（默认 AU）',
      },
    },
    required: ['domain'],
  },
}

/**
 * Client-side tool: detect the technology stack of a domain via DataForSEO
 * Domain Analytics. Returns CMS, ecommerce, analytics, chat, contact info,
 * social graph URLs. Backed by domain-analytics.ts.
 */
const FETCH_DOMAIN_TECHNOLOGIES_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_domain_technologies',
  description:
    '通过 DataForSEO Domain Analytics 检测某个域名的技术栈（CMS / 电商平台 / 分析工具 / 聊天插件），' +
    '同时返回网站上能探测到的电话号码、邮件地址、社媒主页 URL。' +
    '**在抓取主页之后立即调用**（步骤 1 完成后）——返回的 social_graph_urls 可直接验证/补充 social_profiles，' +
    '比盲目搜索更高效；phone_numbers / emails 写入 business 字段。' +
    '仅需调用一次，成本约 $0.01。若返回 null，说明域名数据不足，继续正常流程。',
  input_schema: {
    type: 'object' as const,
    properties: {
      domain: {
        type: 'string',
        description: '目标域名，不带协议和路径，如 "oztop.com.au"',
      },
    },
    required: ['domain'],
  },
}

/**
 * Client-side tool: fetch WHOIS domain registration data via DataForSEO.
 * Returns domain age, expiry date, registrar, backlinks, organic ETV.
 * Backed by domain-analytics.ts.
 */
const FETCH_DOMAIN_WHOIS_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_domain_whois',
  description:
    '通过 DataForSEO WHOIS API 获取域名注册信息：注册日期、到期日期、注册商、反链数量、有机流量估算。' +
    '**关键用途**：① 域名年龄（判断品牌成熟度）② 到期预警（< 90 天须写入 quick_fix） ③ 反链权重（SEO 诊断依据）。' +
    '在步骤 1（识别业务）完成后调用，仅需一次，成本约 $0.10。若返回 null 继续正常流程。',
  input_schema: {
    type: 'object' as const,
    properties: {
      domain: {
        type: 'string',
        description: '目标域名，不带协议和路径，如 "oztop.com.au"',
      },
    },
    required: ['domain'],
  },
}

/**
 * Client-side tool: fetch a Google SERP page via DataForSEO (primary) with
 * Apify google-search-scraper as fallback. Returns organic ranking,
 * paid advertisers, and the Google AI Overview answer.
 */
const FETCH_SERP_RESULTS_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_serp_results',
  description:
    'Fetch a real Google SERP page via DataForSEO — organic ranking, paid advertiser domains, and the Google AI Overview answer. Use for 1-2 high-signal category/local queries to diagnose visibility. Each call is a paid API call (~$0.005), pick queries carefully.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query to scrape, e.g. "vinyl flooring brisbane".',
      },
      country: {
        type: 'string',
        enum: ['AU', 'NZ'],
        description: 'Which Google country domain to search. Defaults to AU.',
      },
    },
    required: ['query'],
  },
}

/**
 * Client-side tool: run an instant on-page SEO audit for the target homepage
 * via DataForSEO OnPage Instant Pages API. Returns meta tags, Core Web Vitals,
 * link counts, image alt coverage, and binary check flags.
 */
const FETCH_ONPAGE_AUDIT_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_onpage_audit',
  description:
    '通过 DataForSEO OnPage API 对目标主页进行即时技术 SEO 审计：' +
    '检测 title / description / H1 缺失、Core Web Vitals（LCP / CLS / TBT）、' +
    '内外链数量、图片 alt 缺失、是否 HTTPS、是否重定向链。' +
    '**在抓取完主页内容后调用一次**——成本约 $0.003，返回 OnPageResult 结构。' +
    '审计发现的问题（如缺少 description）要写入 diagnosis.actions.quick_fix。' +
    '若返回 null，继续正常流程，set onpage_audit to null。',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: '目标主页完整 URL，例如 "https://oztop.com.au/"',
      },
    },
    required: ['url'],
  },
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RunZhangqianOptions {
  /** Override max tool calls (default 15). */
  maxToolCalls?: number
  /** Override max cost USD (default 1.0). */
  maxCostUsd?: number
  /** Per-iteration callback for progress UI (e.g. "fetching homepage…") */
  onProgress?: (note: string) => void | Promise<void>
  /** Pre-fetched SEMrush context string to include in the user prompt. */
  semrushContext?: string
}

export interface RunZhangqianResult {
  report: DiscoveryReport
  /** True if validation failed at the end; report.notes will contain the error. */
  validation_error: string | null
  /** Raw final assistant text — persisted on validation failure for debugging. */
  raw_output: string
}

/**
 * Run the Zhangqian Discovery Agent for a single domain.
 *
 * Returns a fully-populated DiscoveryReport including telemetry meta.
 * Throws only on unrecoverable errors (Anthropic 5xx, missing API key).
 * Validation failures are returned in `validation_error` so the caller can
 * decide whether to persist the partial report or retry.
 */
export async function runZhangqian(
  domain: string,
  options: RunZhangqianOptions = {},
): Promise<RunZhangqianResult> {
  const maxToolCalls = options.maxToolCalls ?? MAX_TOOL_CALLS
  const maxCostUsd = options.maxCostUsd ?? MAX_COST_USD
  const onProgress = options.onProgress ?? (() => undefined)

  const client = getAnthropicClient()
  const startedAt = Date.now()
  const deadline = startedAt + GLOBAL_TIMEOUT_MS

  // Conversation messages — grows each turn
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: buildUserPrompt(domain, options.semrushContext) },
  ]

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let webSearchCalls = 0
  let fetchUrlCalls = 0
  let connectorCalls = 0
  let apifyCalls = 0
  let truncated = false

  await onProgress('张骞已派遣 — 抓取主页…')

  for (let iteration = 0; iteration < maxToolCalls; iteration++) {
    // ── Cost gate + deadline gate ──────────────────────────────────────────
    const costSoFar =
      (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_M +
      (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_M +
      webSearchCalls * PRICE_WEB_SEARCH_PER_CALL

    if (costSoFar >= maxCostUsd) {
      truncated = true
      break
    }

    // Leave 30 s for the final summary Claude call before the 4.5-min deadline
    if (Date.now() + 30_000 >= deadline) {
      truncated = true
      break
    }

    // ── Progress heartbeat before each Anthropic call ─────────────────────
    // Each Claude turn can take up to 150 s; this keeps the live feed moving.
    await onProgress(iteration === 0 ? '张骞已出发 — 开始多维扫描…' : `第 ${iteration + 1} 轮分析中…`)

    // ── Call Claude ────────────────────────────────────────────────────────
    const response = await client.messages.create(
      {
        model: MODEL_SONNET,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: ZHANGQIAN_SYSTEM_PROMPT,
        tools: [
          WEB_SEARCH_TOOL,
          FETCH_URL_TOOL,
          VERIFY_BUSINESS_REGISTRATION_TOOL,
          FETCH_LOCAL_REVIEWS_TOOL,
          FETCH_SOCIAL_METRICS_TOOL,
          FETCH_SERP_RESULTS_TOOL,
          FETCH_ONPAGE_AUDIT_TOOL,
          FETCH_KEYWORD_DATA_TOOL,
          FETCH_COMPETITORS_TOOL,
          FETCH_DOMAIN_TECHNOLOGIES_TOOL,
          FETCH_DOMAIN_WHOIS_TOOL,
        ],
        messages,
      },
      { timeout: CLAUDE_CALL_TIMEOUT_MS },
    )

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // Count server-side web_search uses (informational; max_uses on the tool
    // already enforces the per-tool cap). The SDK exposes these via the
    // `server_tool_use` and `web_search_tool_result` blocks in content.
    for (const block of response.content) {
      if ((block as { type: string }).type === 'server_tool_use') {
        const stu = block as { type: string; name?: string }
        if (stu.name === 'web_search') webSearchCalls++
      }
    }

    // Append assistant message to conversation
    messages.push({ role: 'assistant', content: response.content })

    // ── Inspect stop reason ────────────────────────────────────────────────
    if (response.stop_reason === 'end_turn') {
      // Done — final text should be JSON
      const finalText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
      return await applyPostProcessing(finalizeReport({
        domain,
        finalText,
        totalInputTokens,
        totalOutputTokens,
        webSearchCalls,
        fetchUrlCalls,
        connectorCalls,
        apifyCalls,
        truncated,
        startedAt,
      }), onProgress)
    }

    if (response.stop_reason !== 'tool_use') {
      // Unexpected stop (max_tokens, refusal, etc) — treat as truncation
      truncated = true
      const finalText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
      return await applyPostProcessing(finalizeReport({
        domain,
        finalText,
        totalInputTokens,
        totalOutputTokens,
        webSearchCalls,
        fetchUrlCalls,
        connectorCalls,
        apifyCalls,
        truncated,
        startedAt,
      }), onProgress)
    }

    // ── Resolve client-side tool calls (fetch_url) ─────────────────────────
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    )

    if (toolUseBlocks.length === 0) {
      // stop_reason was 'tool_use' but only server-side tools used — Claude
      // will resume on its own; loop again with an empty user nudge.
      messages.push({ role: 'user', content: 'Continue.' })
      continue
    }

    // Resolve all tool calls for this turn concurrently — counters are
    // incremented synchronously before any await, so no race condition.
    const toolResults = await Promise.all(
      toolUseBlocks.map(toolUse => {
        switch (toolUse.name) {
          case 'fetch_url':
            fetchUrlCalls++
            return handleFetchUrl(toolUse, onProgress)
          case 'verify_business_registration':
            connectorCalls++
            return handleVerifyRegistration(toolUse, onProgress)
          case 'fetch_local_reviews':
            connectorCalls++
            return handleFetchLocalReviews(toolUse, onProgress)
          case 'fetch_social_metrics':
            apifyCalls++
            return handleFetchSocialMetrics(toolUse, onProgress)
          case 'fetch_serp_results':
            apifyCalls++
            return handleFetchSerpResults(toolUse, onProgress)
          case 'fetch_onpage_audit':
            connectorCalls++
            return handleFetchOnpageAudit(toolUse, onProgress)
          case 'fetch_keyword_data':
            connectorCalls++
            return handleFetchKeywordData(toolUse, onProgress)
          case 'fetch_competitors':
            connectorCalls++
            return handleFetchCompetitors(toolUse, onProgress)
          case 'fetch_domain_technologies':
            connectorCalls++
            return handleFetchDomainTechnologies(toolUse, onProgress)
          case 'fetch_domain_whois':
            connectorCalls++
            return handleFetchDomainWhois(toolUse, onProgress)
          default:
            return Promise.resolve<Anthropic.Messages.ToolResultBlockParam>({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Unknown tool: ${toolUse.name}. 'web_search' is server-side; client-handled tools are 'fetch_url', 'verify_business_registration', 'fetch_local_reviews', 'fetch_social_metrics', 'fetch_serp_results', 'fetch_onpage_audit', 'fetch_keyword_data', 'fetch_competitors', 'fetch_domain_technologies', 'fetch_domain_whois'. (Meta Ad Library + Facebook profile scrapers are gated to Phase 8.10.S5 advanced discovery.)`,
              is_error: true,
            })
        }
      })
    )

    // Feed tool results back into the conversation
    messages.push({ role: 'user', content: toolResults })
  }

  // Hit MAX_TOOL_CALLS without 'end_turn' — force one final call asking for JSON.
  truncated = true
  await onProgress('工具预算用尽 — 生成最终报告…')

  messages.push({
    role: 'user',
    content:
      'You have reached the tool-call budget. Stop using tools and emit the final JSON report now, ' +
      'using whatever you have gathered. Set `notes` to flag any incomplete sections.',
  })

  const finalResponse = await client.messages.create(
    {
      model: MODEL_SONNET,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: ZHANGQIAN_SYSTEM_PROMPT,
      // Omit tools on the final call so Claude can't loop again
      messages,
    },
    { timeout: CLAUDE_CALL_TIMEOUT_MS },
  )

  totalInputTokens += finalResponse.usage.input_tokens
  totalOutputTokens += finalResponse.usage.output_tokens

  const finalText = finalResponse.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  return await applyPostProcessing(finalizeReport({
    domain,
    finalText,
    totalInputTokens,
    totalOutputTokens,
    webSearchCalls,
    fetchUrlCalls,
    connectorCalls,
    apifyCalls,
    truncated,
    startedAt,
  }), onProgress)
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface FinalizeArgs {
  domain: string
  finalText: string
  totalInputTokens: number
  totalOutputTokens: number
  webSearchCalls: number
  fetchUrlCalls: number
  connectorCalls: number
  apifyCalls: number
  truncated: boolean
  startedAt: number
}

function finalizeReport(args: FinalizeArgs): RunZhangqianResult {
  const costUsd =
    (args.totalInputTokens / 1_000_000) * PRICE_INPUT_PER_M +
    (args.totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_M +
    args.webSearchCalls * PRICE_WEB_SEARCH_PER_CALL

  const meta: DiscoveryReport['meta'] = {
    model: MODEL_SONNET,
    tool_calls: args.webSearchCalls + args.fetchUrlCalls + args.connectorCalls + args.apifyCalls,
    cost_usd: Number(costUsd.toFixed(4)),
    duration_ms: Date.now() - args.startedAt,
    truncated: args.truncated,
  }

  // Parse + validate — use parseJsonResponse which finds the outermost { ... }
  // block (tolerates leading narrative text like "Now let me emit the JSON…")
  let parsed: unknown
  try {
    parsed = parseJsonResponse<unknown>(args.finalText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      report: makeEmptyReport(args.domain, meta, `JSON parse failed: ${message}`),
      validation_error: `JSON parse failed: ${message}`,
      raw_output: args.finalText,
    }
  }

  const validation = validateDiscoveryReport(parsed)
  if (!validation.ok) {
    return {
      report: makeEmptyReport(args.domain, meta, `Schema validation failed: ${validation.error}`),
      validation_error: validation.error,
      raw_output: args.finalText,
    }
  }

  return {
    report: { ...validation.value, meta },
    validation_error: null,
    raw_output: args.finalText,
  }
}

/**
 * 落库前的兜底补救：调 ensureSerpCoverage，若 LLM 跳过了 fetch_serp_results，
 * 用 seed_keywords/ai_tracker_questions 挑词强制补跑 1-2 次（apify 极便宜）。
 *
 * 验证失败的 report 不补救（已是坏数据，没意义）。补救成功后更新 meta.tool_calls + cost。
 */
async function applyPostProcessing(
  result: RunZhangqianResult,
  onProgress: ProgressFn,
): Promise<RunZhangqianResult> {
  if (result.validation_error) return result

  await onProgress('检查 SERP 覆盖率…')
  const { report: coveredReport, result: cov } = await ensureSerpCoverage(result.report)

  if (cov.serpCallsAdded === 0) {
    // LLM 已经跑过 SERP（最常见路径） — 直接返回
    return { ...result, report: coveredReport }
  }

  console.log(
    `[zhangqian/postProcess] SERP fallback fired: ${cov.queriesAdded}/${cov.serpCallsAdded} queries 成功 ` +
    `(+$${cov.estimatedExtraCostUsd}). errors: ${cov.errors.join(' | ') || '无'}`,
  )

  // 把补跑的 SERP call + cost 加进 meta，保证 telemetry 真实
  const updatedReport: DiscoveryReport = {
    ...coveredReport,
    meta: {
      ...coveredReport.meta,
      tool_calls: coveredReport.meta.tool_calls + cov.serpCallsAdded,
      cost_usd: Number((coveredReport.meta.cost_usd + cov.estimatedExtraCostUsd).toFixed(4)),
    },
  }
  return { ...result, report: updatedReport }
}

/** Build an empty-skeleton report when Claude's output couldn't be used. */
function makeEmptyReport(
  domain: string,
  meta: DiscoveryReport['meta'],
  notes: string,
): DiscoveryReport {
  return {
    schema_version: 1,
    domain,
    business: {
      name: domain,
      industry: ['unknown'],
      location: { city: null, region: null, country: 'AU/NZ' },
      description: 'Discovery failed — see notes.',
      target_audience: [],
      unique_selling_points: [],
      confidence: 0,
    },
    social_profiles: [],
    gbp: null,
    review_platforms: [],
    seed_keywords: [],
    competitors: [],
    ai_tracker_questions: [],
    notes: `[ZHANGQIAN ERROR] ${notes}`,
    meta,
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ])
}

function truncateForProgress(url: string): string {
  if (url.length <= 60) return url
  return url.slice(0, 57) + '…'
}

// ─── Client-side tool handlers ───────────────────────────────────────────────

type ProgressFn = (note: string) => void | Promise<void>

/** Resolve a `fetch_url` tool call via Jina Reader. */
async function handleFetchUrl(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { url?: string }
  const url = input.url
  if (!url || typeof url !== 'string') {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_url requires a string `url` parameter.',
      is_error: true,
    }
  }

  await onProgress(`抓取 ${truncateForProgress(url)}…`)

  try {
    const fetched = await withTimeout(fetchUrlAsMarkdown(url), FETCH_URL_TIMEOUT_MS)
    // Cap markdown at ~50KB to control token use
    const markdown = fetched.markdown.length > 50_000
      ? fetched.markdown.slice(0, 50_000) + '\n\n[truncated — content exceeded 50KB]'
      : fetched.markdown
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Title: ${fetched.title || '(none)'}\n\n${markdown}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_url failed: ${message}`,
      is_error: true,
    }
  }
}

/** Resolve a `verify_business_registration` tool call via the ABR/NZBN connector. */
async function handleVerifyRegistration(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { query?: string; market?: string; state?: string }
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  const market = input.market === 'AU' || input.market === 'NZ' ? input.market : null

  if (!query || !market) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'verify_business_registration requires `query` (string) and `market` ("AU" or "NZ").',
      is_error: true,
    }
  }

  await onProgress(`验证商业注册 (${market})…`)

  // verifyBusinessRegistration is non-fatal by contract — never throws.
  const registration = await verifyBusinessRegistration({
    query,
    market,
    state: typeof input.state === 'string' ? input.state : undefined,
  })

  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: registration
      ? JSON.stringify(registration)
      : `No ${market === 'AU' ? 'ABR' : 'NZBN'} registration found for "${query}". Set business.registration to null — do not guess one.`,
  }
}

/** Resolve a `fetch_local_reviews` tool call via DataForSEO Business Data + Jina. */
async function handleFetchLocalReviews(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as {
    business_query?: string
    productreview_url?: string
    tripadvisor_keyword?: string
  }
  const businessQuery =
    typeof input.business_query === 'string' ? input.business_query.trim() : ''

  if (!businessQuery) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_local_reviews requires a `business_query` string (brand + city + state).',
      is_error: true,
    }
  }

  const tripadvisorKeyword =
    typeof input.tripadvisor_keyword === 'string' && input.tripadvisor_keyword.trim()
      ? input.tripadvisor_keyword.trim()
      : undefined

  await onProgress(`聚合本地评价数据${tripadvisorKeyword ? ' + Tripadvisor' : ''}…`)

  // aggregateLocalReviews is non-fatal by contract — never throws.
  const snapshots = await withTimeout(aggregateLocalReviews({
    businessQuery,
    productReviewUrl:
      typeof input.productreview_url === 'string' ? input.productreview_url : undefined,
    tripadvisorKeyword,
  }), LOCAL_REVIEWS_TIMEOUT_MS).catch(err => {
    console.error('[zhangqian] fetch_local_reviews timed out or failed', err)
    return []
  })

  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: snapshots.length > 0
      ? JSON.stringify(snapshots)
      : 'No local review data found. Base gbp / review_platforms on other sources — do not guess ratings.',
  }
}

/** Resolve a `fetch_social_metrics` tool call via the Apify social scrapers. */
async function handleFetchSocialMetrics(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { platform?: string; handle_or_url?: string }
  const platform = input.platform
  const target = typeof input.handle_or_url === 'string' ? input.handle_or_url.trim() : ''

  if (!target || (platform !== 'instagram' && platform !== 'tiktok')) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content:
        'fetch_social_metrics requires `platform` ("instagram" | "tiktok") and `handle_or_url`. Facebook scraping is gated to Phase 8.10.S5 advanced discovery.',
      is_error: true,
    }
  }

  await onProgress(`抓取 ${platform} 真实指标…`)

  // 75 s = Apify actor timeout (60 s) + 15 s HTTP buffer
  const SOCIAL_METRICS_TIMEOUT_MS = 75_000

  try {
    // Each scraper returns followersCount / postsLast30Days / engagementRate;
    // normalise to the snake_case fields Claude writes into DiscoveredSocial.
    let raw: { followersCount: number; postsLast30Days: number; engagementRate: number }
    if (platform === 'instagram') {
      raw = await withTimeout(scrapeInstagramProfile(target.replace(/^@/, '')), SOCIAL_METRICS_TIMEOUT_MS)
    } else {
      raw = await withTimeout(scrapeTiktokProfile(target), SOCIAL_METRICS_TIMEOUT_MS)
    }
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify({
        followers_count: raw.followersCount,
        posts_last_30d: raw.postsLast30Days,
        engagement_rate: raw.engagementRate,
      }),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Non-fatal: let Claude continue and leave that profile's metric fields null.
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_social_metrics failed for ${platform}: ${message}. Leave that profile's metric fields null — do not guess.`,
    }
  }
}

/** Resolve a `fetch_serp_results` tool call — DataForSEO primary, Apify fallback. */
async function handleFetchSerpResults(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { query?: string; country?: string }
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  const country = input.country === 'NZ' ? 'nz' : 'au'

  if (!query) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_serp_results requires a `query` string.',
      is_error: true,
    }
  }

  await onProgress(`抓取 Google 搜索结果 "${query}"…`)

  try {
    const serp = await getSerpPage(query, country)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(serp),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_serp_results failed for "${query}": ${message}. Continue without this SERP snapshot.`,
    }
  }
}

/** Resolve a `fetch_keyword_data` tool call via DataForSEO Labs. */
async function handleFetchKeywordData(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { domain?: string; location?: string }
  const domain = typeof input.domain === 'string' ? input.domain.trim() : ''
  const locationCode = input.location === 'NZ' ? 2554 : 2036

  if (!domain) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_keyword_data requires a `domain` string.',
      is_error: true,
    }
  }

  await onProgress(`DataForSEO Labs：获取 ${domain} 关键词数据…`)

  try {
    const keywords = await getKeywordsForSite(domain, locationCode, 50)
    if (keywords.length === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content:
          'No keyword data found in DataForSEO Labs for this domain. ' +
          'The domain may be too new or have very low traffic. Fall back to web_search to identify seed keywords.',
      }
    }
    await onProgress(`DataForSEO Labs：返回 ${keywords.length} 条关键词`)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(keywords),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_keyword_data failed: ${message}. Fall back to web_search for keyword discovery.`,
    }
  }
}

/** Resolve a `fetch_domain_technologies` tool call via DataForSEO Domain Analytics. */
async function handleFetchDomainTechnologies(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { domain?: string }
  const domain = typeof input.domain === 'string' ? input.domain.trim() : ''

  if (!domain) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_domain_technologies requires a `domain` string.',
      is_error: true,
    }
  }

  await onProgress(`DataForSEO：检测 ${domain} 技术栈…`)

  try {
    const tech = await getDomainTechnologies(domain)
    if (!tech) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content:
          'No technology data found for this domain in DataForSEO. ' +
          'Set technology_stack to null and continue.',
      }
    }
    const parts: string[] = []
    if (tech.cms) parts.push(`CMS: ${tech.cms}`)
    if (tech.ecommerce) parts.push(`Ecommerce: ${tech.ecommerce}`)
    await onProgress(`DataForSEO：技术栈检测完成（${parts.join(', ') || '已获取'}）`)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(tech),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_domain_technologies failed: ${message}. Set technology_stack to null and continue.`,
    }
  }
}

/** Resolve a `fetch_domain_whois` tool call via DataForSEO WHOIS API. */
async function handleFetchDomainWhois(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { domain?: string }
  const domain = typeof input.domain === 'string' ? input.domain.trim() : ''

  if (!domain) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_domain_whois requires a `domain` string.',
      is_error: true,
    }
  }

  await onProgress(`DataForSEO WHOIS：获取 ${domain} 域名注册信息…`)

  try {
    const whois = await getDomainWhois(domain)
    if (!whois) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content:
          'No WHOIS data found for this domain in DataForSEO. ' +
          'Set domain_whois to null and continue.',
      }
    }

    // Inject expiry warning so Claude can write it into quick_fix automatically
    let expiryWarning = ''
    if (whois.expires_at) {
      const daysToExpiry = Math.floor(
        (Date.parse(whois.expires_at) - Date.now()) / (24 * 60 * 60 * 1000),
      )
      if (daysToExpiry < 90) {
        expiryWarning =
          ` IMPORTANT: domain expires in ${daysToExpiry} days (${whois.expires_at}). ` +
          'Add to diagnosis.actions.quick_fix: "域名将于 X 天后到期，请立即续费".'
      }
    }

    await onProgress(`DataForSEO WHOIS：域名年龄 ${whois.domain_age_years ?? '?'} 年，到期 ${whois.expires_at ?? '未知'}`)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(whois) + expiryWarning,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_domain_whois failed: ${message}. Set domain_whois to null and continue.`,
    }
  }
}

/** Resolve a `fetch_onpage_audit` tool call via DataForSEO OnPage Instant Pages API. */
async function handleFetchOnpageAudit(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { url?: string }
  const url = typeof input.url === 'string' ? input.url.trim() : ''

  if (!url) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_onpage_audit requires a `url` string (full https:// URL).',
      is_error: true,
    }
  }

  await onProgress(`DataForSEO OnPage：审计 ${truncateForProgress(url)}…`)

  try {
    const audit = await getOnPageInstant(url)
    if (!audit) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content:
          'No on-page audit data returned (URL may be unreachable). ' +
          'Set onpage_audit to null and continue.',
      }
    }

    // Build a plain-English summary so Claude gets actionable context immediately
    const issues: string[] = []
    if (audit.checks.no_title) issues.push('missing <title>')
    if (audit.checks.no_description) issues.push('missing meta description')
    if (audit.checks.no_h1) issues.push('missing H1')
    if (audit.checks.missing_alt_text) issues.push(`${audit.images_no_alt} images missing alt text`)
    if (audit.checks.redirect_chain) issues.push('redirect chain detected')
    if (!audit.checks.https) issues.push('not on HTTPS')

    const summary = issues.length > 0
      ? `Issues found: ${issues.join(', ')}. Add relevant issues to diagnosis.actions.quick_fix.`
      : 'No critical on-page issues detected.'

    await onProgress(`OnPage 审计完成 — ${issues.length} 个问题`)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(audit) + `\n\nSummary: ${summary}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_onpage_audit failed: ${message}. Set onpage_audit to null and continue.`,
    }
  }
}

/** Resolve a `fetch_competitors` tool call via DataForSEO Labs. */
async function handleFetchCompetitors(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { domain?: string; location?: string }
  const domain = typeof input.domain === 'string' ? input.domain.trim() : ''
  const locationCode = input.location === 'NZ' ? 2554 : 2036

  if (!domain) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: 'fetch_competitors requires a `domain` string.',
      is_error: true,
    }
  }

  await onProgress(`DataForSEO Labs：发现 ${domain} 竞品…`)

  try {
    const competitors = await getSerpCompetitors(domain, locationCode, 10)
    if (competitors.length === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content:
          'No competitor data found in DataForSEO Labs for this domain. ' +
          'The domain may be too new. Fall back to web_search to identify competitors.',
      }
    }
    await onProgress(`DataForSEO Labs：发现 ${competitors.length} 个竞品域名`)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(competitors),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `fetch_competitors failed: ${message}. Fall back to web_search for competitor discovery.`,
    }
  }
}
