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
import type { DiscoveryReport } from './types'
import { ZHANGQIAN_SYSTEM_PROMPT, buildUserPrompt } from './prompts'
import { validateDiscoveryReport } from './validators'

// ─── Constants ────────────────────────────────────────────────────────────────

// 12 iterations gives room for: homepage + social (2) + GBP/reviews + competitors (2)
// + competitor homepages (2) + AI visibility web searches (2) + final synthesis.
// Web search max_uses below is an independent per-tool cap.
const MAX_TOOL_CALLS = 12
const MAX_COST_USD = 1.0
const MAX_OUTPUT_TOKENS = 8096
const FETCH_URL_TIMEOUT_MS = 15_000

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
 * Profile and ProductReview.com.au. Backed by src/lib/local-reviews/client.ts.
 */
const FETCH_LOCAL_REVIEWS_TOOL: Anthropic.Messages.Tool = {
  name: 'fetch_local_reviews',
  description:
    'Aggregate real review data from Google Business Profile and ProductReview.com.au. Returns verified ratings, review counts, and sample negative reviews. Use this instead of guessing reputation numbers.',
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
    },
    required: ['business_query'],
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

  // Conversation messages — grows each turn
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: buildUserPrompt(domain, options.semrushContext) },
  ]

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let webSearchCalls = 0
  let fetchUrlCalls = 0
  let connectorCalls = 0
  let truncated = false

  await onProgress('Zhangqian dispatched — researching homepage…')

  for (let iteration = 0; iteration < maxToolCalls; iteration++) {
    // ── Cost gate ──────────────────────────────────────────────────────────
    const costSoFar =
      (totalInputTokens / 1_000_000) * PRICE_INPUT_PER_M +
      (totalOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_M +
      webSearchCalls * PRICE_WEB_SEARCH_PER_CALL

    if (costSoFar >= maxCostUsd) {
      truncated = true
      break
    }

    // ── Call Claude ────────────────────────────────────────────────────────
    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: ZHANGQIAN_SYSTEM_PROMPT,
      tools: [
        WEB_SEARCH_TOOL,
        FETCH_URL_TOOL,
        VERIFY_BUSINESS_REGISTRATION_TOOL,
        FETCH_LOCAL_REVIEWS_TOOL,
      ],
      messages,
    })

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
      return finalizeReport({
        domain,
        finalText,
        totalInputTokens,
        totalOutputTokens,
        webSearchCalls,
        fetchUrlCalls,
        connectorCalls,
        truncated,
        startedAt,
      })
    }

    if (response.stop_reason !== 'tool_use') {
      // Unexpected stop (max_tokens, refusal, etc) — treat as truncation
      truncated = true
      const finalText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
      return finalizeReport({
        domain,
        finalText,
        totalInputTokens,
        totalOutputTokens,
        webSearchCalls,
        fetchUrlCalls,
        connectorCalls,
        truncated,
        startedAt,
      })
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

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []

    for (const toolUse of toolUseBlocks) {
      switch (toolUse.name) {
        case 'fetch_url':
          fetchUrlCalls++
          toolResults.push(await handleFetchUrl(toolUse, onProgress))
          break
        case 'verify_business_registration':
          connectorCalls++
          toolResults.push(await handleVerifyRegistration(toolUse, onProgress))
          break
        case 'fetch_local_reviews':
          connectorCalls++
          toolResults.push(await handleFetchLocalReviews(toolUse, onProgress))
          break
        default:
          // Unknown tool — return error so Claude can recover
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Unknown tool: ${toolUse.name}. 'web_search' is server-side; client-handled tools are 'fetch_url', 'verify_business_registration', 'fetch_local_reviews'.`,
            is_error: true,
          })
      }
    }

    // Feed tool results back into the conversation
    messages.push({ role: 'user', content: toolResults })
  }

  // Hit MAX_TOOL_CALLS without 'end_turn' — force one final call asking for JSON.
  truncated = true
  await onProgress('Tool budget exhausted — finalising report…')

  messages.push({
    role: 'user',
    content:
      'You have reached the tool-call budget. Stop using tools and emit the final JSON report now, ' +
      'using whatever you have gathered. Set `notes` to flag any incomplete sections.',
  })

  const finalResponse = await client.messages.create({
    model: MODEL_SONNET,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: ZHANGQIAN_SYSTEM_PROMPT,
    // Omit tools on the final call so Claude can't loop again
    messages,
  })

  totalInputTokens += finalResponse.usage.input_tokens
  totalOutputTokens += finalResponse.usage.output_tokens

  const finalText = finalResponse.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  return finalizeReport({
    domain,
    finalText,
    totalInputTokens,
    totalOutputTokens,
    webSearchCalls,
    fetchUrlCalls,
    truncated,
    startedAt,
  })
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
    tool_calls: args.webSearchCalls + args.fetchUrlCalls + args.connectorCalls,
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

  await onProgress(`Fetching ${truncateForProgress(url)}…`)

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

  await onProgress(`Verifying business registration (${market})…`)

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

/** Resolve a `fetch_local_reviews` tool call via the GBP + ProductReview connector. */
async function handleFetchLocalReviews(
  toolUse: Anthropic.Messages.ToolUseBlock,
  onProgress: ProgressFn,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const input = toolUse.input as { business_query?: string; productreview_url?: string }
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

  await onProgress('Aggregating local reviews…')

  // aggregateLocalReviews is non-fatal by contract — never throws.
  const snapshots = await aggregateLocalReviews({
    businessQuery,
    productReviewUrl:
      typeof input.productreview_url === 'string' ? input.productreview_url : undefined,
  })

  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: snapshots.length > 0
      ? JSON.stringify(snapshots)
      : 'No local review data found. Base gbp / review_platforms on other sources — do not guess ratings.',
  }
}
