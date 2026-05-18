/**
 * Market Context — Synthesis layer (P8.10.S3.4)
 *
 * Asks Claude Sonnet (with the server-side `web_search` tool) to gather a
 * short, citation-backed snapshot of the client's industry in their target
 * market (AU/NZ). The output feeds into the Report Composer (P8.10.S4) so the
 * diagnostic doesn't read in a vacuum — every dimension narrative can be
 * grounded against "where the industry stands right now".
 *
 * Output shape (parsed from Claude JSON):
 *   - industry_overview_md     ~150–250 words: where the market sits today
 *   - key_trends[]             3–6 short trend statements with year refs
 *   - category_benchmarks_md   typical KPIs / buyer expectations
 *   - opportunities_md         100–200 words: where the client could lean in
 *
 * Citations are harvested server-side from `web_search_tool_result` blocks
 * and returned alongside the prose so the Report Composer can render an
 * evidence footer.
 *
 * Persistence: caller decides whether to write to `diagnostic_narratives`
 * (P8.10.S3.5) — typically under `dimension = 'market_context'`.
 */

import {
  callClaudeWithWebSearch,
  MODEL_SONNET,
  type WebSearchCitation,
} from '@/lib/anthropic/client'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MarketCode = 'au' | 'nz'

export interface MarketContextInput {
  clientBrandName: string
  clientDomain: string
  /** Industry / category label (e.g. "boutique tour operator"). Required so
   *  the search query is anchored — generic "small business" searches return
   *  noise. */
  industry: string
  market: MarketCode
  /** Optional category / keyword anchors (5–10 max). Trimmed if longer. */
  focusTopics?: string[]
  /** Optional formatted brief excerpt for brand voice / positioning context. */
  briefText?: string
  /** Cap on Anthropic web_search calls (default 5). */
  maxSearches?: number
}

export interface MarketTrend {
  title: string
  detail: string
}

export interface MarketContextResult {
  industry_overview_md: string
  key_trends: MarketTrend[]
  category_benchmarks_md: string
  opportunities_md: string
  citations: WebSearchCitation[]
  /** Citation URLs used as web-search evidence for this narrative. */
  evidence_refs: string[]
  web_search_calls: number
  cost_usd: number
  model_used: string
  generated_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_TOKENS = 2048
const DEFAULT_MAX_SEARCHES = 5
const MAX_FOCUS_TOPICS = 10

const MARKET_LABELS: Record<MarketCode, { country: string; timezone: string; label: string }> = {
  au: { country: 'AU', timezone: 'Australia/Sydney', label: 'Australia' },
  nz: { country: 'NZ', timezone: 'Pacific/Auckland', label: 'New Zealand' },
}

const SYSTEM_PROMPT = `You are a senior brand-health analyst preparing the
"market context" section of a diagnostic report for an AU/NZ business. You
have the server-side web_search tool — USE IT to ground every claim in
recent (last ~24 months) public sources for the client's specific industry
and country.

Your job: produce four short, citation-anchored sections.

  1. industry_overview_md — 150–250 words of Markdown prose describing where
     the industry sits TODAY in the client's country. Cite concrete signals:
     market size or growth rates if available, demand shifts, regulatory or
     channel changes. Use the literal country name ("Australia" or
     "New Zealand"), not "the local market".

  2. key_trends — an array of 3–6 short objects { title, detail }. Each
     "title" is ≤ 8 words. Each "detail" is one sentence (≤ 40 words) with a
     year reference where possible. Trends must be specific to this industry
     in this country.

  3. category_benchmarks_md — 80–150 words of Markdown describing what
     "good" looks like in this category: typical buyer expectations, common
     channels, baseline marketing KPIs if you can find them. No hedging
     filler.

  4. opportunities_md — 100–200 words of Markdown naming 2–3 gaps or
     openings the client could lean into, grounded in the trends above.

Use AU/NZ English spelling. Never invent statistics — if web_search did not
surface a number, describe the directional signal instead.

RULES:
- Output ONLY a JSON object, no prose around it, no markdown fences.
- Schema:
  {
    "industry_overview_md": "string",
    "key_trends": [ { "title": "string", "detail": "string" }, ... ],
    "category_benchmarks_md": "string",
    "opportunities_md": "string"
  }
- All four fields are required and non-empty.
- key_trends must have between 3 and 6 entries.`

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function gatherMarketContext(
  input: MarketContextInput,
): Promise<MarketContextResult> {
  validateInput(input)

  const { country, timezone } = MARKET_LABELS[input.market]
  const userMessage = buildUserMessage(input)

  const result = await callClaudeWithWebSearch({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxWebSearches: input.maxSearches ?? DEFAULT_MAX_SEARCHES,
    country,
    timezone,
  })

  const parsed = parseClaudeResponse(result.text)

  return {
    industry_overview_md: parsed.industry_overview_md,
    key_trends: parsed.key_trends,
    category_benchmarks_md: parsed.category_benchmarks_md,
    opportunities_md: parsed.opportunities_md,
    citations: result.citations,
    evidence_refs: result.citations.map(c => c.url),
    web_search_calls: result.web_search_calls,
    cost_usd: result.cost_usd,
    model_used: MODEL_SONNET,
    generated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(input: MarketContextInput): void {
  if (!input.clientBrandName || !input.clientBrandName.trim()) {
    throw new Error('Market context: clientBrandName is required.')
  }
  if (!input.industry || !input.industry.trim()) {
    throw new Error('Market context: industry is required.')
  }
  if (input.market !== 'au' && input.market !== 'nz') {
    throw new Error(`Market context: market must be 'au' or 'nz', got "${input.market}".`)
  }
  if (
    input.maxSearches !== undefined &&
    (!Number.isFinite(input.maxSearches) || input.maxSearches < 1 || input.maxSearches > 20)
  ) {
    throw new Error(
      `Market context: maxSearches must be between 1 and 20, got ${input.maxSearches}.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildUserMessage(input: MarketContextInput): string {
  const { label } = MARKET_LABELS[input.market]
  const parts: string[] = []

  parts.push(`Produce the market context for the following client.`)
  parts.push('')

  parts.push(`## CLIENT`)
  parts.push(`- Brand: ${input.clientBrandName}`)
  parts.push(`- Domain: ${input.clientDomain}`)
  parts.push(`- Industry: ${input.industry}`)
  parts.push(`- Country: ${label}`)
  parts.push('')

  const topics = (input.focusTopics ?? [])
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .slice(0, MAX_FOCUS_TOPICS)
  if (topics.length > 0) {
    parts.push(`## FOCUS TOPICS`)
    for (const t of topics) parts.push(`- ${t}`)
    parts.push('')
  }

  if (input.briefText && input.briefText.trim().length > 0) {
    parts.push(`## CLIENT BRIEF EXCERPT`)
    parts.push(input.briefText.trim())
    parts.push('')
  }

  parts.push('---')
  parts.push(
    `Use web_search to gather recent (last ~24 months) ${label} sources for "${input.industry}". Then output the JSON object.`,
  )
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface RawClaudeResponse {
  industry_overview_md?: unknown
  key_trends?: unknown
  category_benchmarks_md?: unknown
  opportunities_md?: unknown
}

interface ParsedMarketContext {
  industry_overview_md: string
  key_trends: MarketTrend[]
  category_benchmarks_md: string
  opportunities_md: string
}

function parseClaudeResponse(raw: string): ParsedMarketContext {
  const stripped = stripCodeFence(raw).trim()

  let json: RawClaudeResponse
  try {
    json = JSON.parse(stripped) as RawClaudeResponse
  } catch {
    const match = stripped.match(/\{[\s\S]+\}/)
    if (!match) {
      throw new Error('Market context: Claude returned non-JSON output.')
    }
    try {
      json = JSON.parse(match[0]) as RawClaudeResponse
    } catch {
      throw new Error('Market context: Claude returned malformed JSON.')
    }
  }

  const overview = requireNonEmptyString(json.industry_overview_md, 'industry_overview_md')
  const benchmarks = requireNonEmptyString(json.category_benchmarks_md, 'category_benchmarks_md')
  const opportunities = requireNonEmptyString(json.opportunities_md, 'opportunities_md')
  const trends = parseTrends(json.key_trends)

  return {
    industry_overview_md: overview,
    key_trends: trends,
    category_benchmarks_md: benchmarks,
    opportunities_md: opportunities,
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Market context: response missing or empty "${field}".`)
  }
  return value
}

function parseTrends(value: unknown): MarketTrend[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 6) {
    throw new Error('Market context: key_trends must be an array of 3–6 entries.')
  }
  const out: MarketTrend[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Market context: each key_trends entry must be an object.')
    }
    const e = entry as { title?: unknown; detail?: unknown }
    const title = requireNonEmptyString(e.title, 'key_trends[].title')
    const detail = requireNonEmptyString(e.detail, 'key_trends[].detail')
    out.push({ title, detail })
  }
  return out
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m)
  return fenced ? fenced[1] : text
}
