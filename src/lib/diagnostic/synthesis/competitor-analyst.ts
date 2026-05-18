/**
 * Competitor Analyst — Synthesis layer (P8.10.S3.1)
 *
 * Takes raw competitor collector output (DataForSEO domain stats, Meta-ads
 * scrapes, Jina-derived site signals) and asks Claude Sonnet to turn it into
 * two short narrative sections a human consultant would write:
 *
 *   - "Market Structure"   — who leads, who follows, where the gaps are
 *   - "Benchmarking Path"  — concrete 3-step plan for the client to close
 *                            the gap vs the top 1–2 competitors
 *
 * Why a dedicated module (not part of CompetitorCollector)?
 *   - Collector is deterministic data plumbing; cost / latency must stay low
 *     and predictable. Adding an LLM call there would slow every diagnostic.
 *   - Synthesis is opt-in (only invoked when generating a full report) and
 *     can be expensive — we want a clear seam to disable / swap models.
 *
 * Persistence: the caller (Report Composer in P8.10.S4) decides whether to
 * write the narrative to `diagnostic_narratives` (P8.10.S3.5).
 */

import { callClaudeWithDocs, MODEL_SONNET } from '@/lib/anthropic/client'
import type { CompetitorEntry } from '@/lib/diagnostic/collectors/competitor-collector'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CompetitorAnalystInput {
  clientBrandName: string
  clientDomain: string
  /** Client's own organic traffic (for baseline). null when unknown. */
  clientTraffic?: number | null
  /** Client's own authority/domain rank (0–100). null when unknown. */
  clientAuthority?: number | null
  /** Output of the Competitor Collector (already enriched with site signals + ad data). */
  competitors: CompetitorEntry[]
  /** Optional formatted brief excerpt for brand voice / positioning context. */
  briefText?: string
}

export interface CompetitorAnalystResult {
  market_structure_md: string
  benchmarking_path_md: string
  /** Competitor domain names used as input evidence for these narratives. */
  evidence_refs: string[]
  cost_usd: number
  model_used: string
  generated_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_COMPETITORS = 2
const MAX_OUTPUT_TOKENS = 2048

const SYSTEM_PROMPT = `You are a senior competitive-strategy analyst writing the
"competitor landscape" section of a brand health diagnostic report for an
AU/NZ business.

You will receive structured data about the client and 2–10 organic competitors:
domain authority, monthly organic traffic, USP candidates from competitor
homepages, CTA counts, landing-page types, and (when available) active Meta
ad spend signals.

Your job is to produce TWO narrative sections in Markdown:

1. "Market Structure" — 150–250 words. Identify tiers (leader / challenger /
   niche), surface the structural moat each tier holds (authority? traffic?
   conversion design? paid coverage?), and call out where the client sits.
   Reference specific domains by name. Use AU/NZ English spelling.

2. "Benchmarking Path" — 150–250 words. Three concrete, sequenced steps the
   client should take to close the gap with the top 1–2 competitors. Each
   step must reference an observable signal from the input data (e.g. "Match
   competitor X's 12-CTA conversion layout — currently the client has 4").
   Avoid generic advice ("do more content marketing").

RULES:
- Output ONLY a JSON object, no prose around it, no markdown fences.
- Both fields are required. Schema:
  {
    "market_structure_md": "string — Markdown, starts with ## heading",
    "benchmarking_path_md": "string — Markdown, starts with ## heading"
  }
- Never invent metrics not present in the input.
- If the input is sparse (e.g. only domain names with no traffic), say so
  in the narrative rather than fabricating tiers.`

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function analyzeCompetitorLandscape(
  input: CompetitorAnalystInput,
): Promise<CompetitorAnalystResult> {
  if (input.competitors.length < MIN_COMPETITORS) {
    throw new Error(
      `Competitor synthesis requires at least ${MIN_COMPETITORS} competitors; got ${input.competitors.length}.`,
    )
  }

  const userMessage = buildUserMessage(input)

  const claudeResult = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })

  const parsed = parseClaudeResponse(claudeResult.text)

  return {
    market_structure_md: parsed.market_structure_md,
    benchmarking_path_md: parsed.benchmarking_path_md,
    evidence_refs: input.competitors.map(c => c.domain),
    cost_usd: claudeResult.cost_usd,
    model_used: MODEL_SONNET,
    generated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildUserMessage(input: CompetitorAnalystInput): string {
  const parts: string[] = []

  parts.push(`Please synthesize the competitor landscape for the following client.`)
  parts.push('')

  parts.push(`## CLIENT`)
  parts.push(`- Brand: ${input.clientBrandName}`)
  parts.push(`- Domain: ${input.clientDomain}`)
  parts.push(`- Organic traffic: ${formatNumber(input.clientTraffic)}`)
  parts.push(`- Authority score: ${formatNumber(input.clientAuthority)}`)
  parts.push('')

  if (input.briefText && input.briefText.trim().length > 0) {
    parts.push(`## CLIENT BRIEF EXCERPT`)
    parts.push(input.briefText.trim())
    parts.push('')
  }

  parts.push(`## COMPETITORS (${input.competitors.length})`)
  for (const c of input.competitors) {
    parts.push(formatCompetitorBlock(c))
  }

  parts.push('---')
  parts.push('Output the JSON object now. Both fields required.')
  return parts.join('\n')
}

function formatCompetitorBlock(c: CompetitorEntry): string {
  const lines: string[] = []
  lines.push(`### ${c.domain}`)
  lines.push(`- Overlap with client: ${(c.overlap_score * 100).toFixed(0)}%`)
  lines.push(`- Organic traffic: ${formatNumber(c.organic_traffic)}`)
  lines.push(`- Authority: ${formatNumber(c.authority_score)}`)

  if (c.site_signals) {
    const s = c.site_signals
    lines.push(`- USP candidates: ${s.usp_candidates.slice(0, 3).join(' | ') || 'n/a'}`)
    lines.push(`- CTAs on homepage: ${s.cta_count}${s.cta_examples.length > 0 ? ` (e.g. ${s.cta_examples.slice(0, 3).join(', ')})` : ''}`)
    lines.push(`- Landing page type: ${s.landing_page_type}`)
    lines.push(`- Category depth: ${s.category_depth}`)
  }

  if (c.meta_ads) {
    const m = c.meta_ads
    lines.push(`- Active Meta ads: ${m.activeAdsCount} (spend: ${m.estimatedSpend}, formats: ${m.adTypes.join('/')})`)
  }

  lines.push('')
  return lines.join('\n')
}

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'unknown'
  return v.toLocaleString('en-NZ')
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface RawClaudeResponse {
  market_structure_md?: unknown
  benchmarking_path_md?: unknown
}

function parseClaudeResponse(
  raw: string,
): { market_structure_md: string; benchmarking_path_md: string } {
  const stripped = stripCodeFence(raw).trim()

  let json: RawClaudeResponse
  try {
    json = JSON.parse(stripped) as RawClaudeResponse
  } catch {
    // One more chance — try to pluck the first {...} block out
    const match = stripped.match(/\{[\s\S]+\}/)
    if (!match) {
      throw new Error('Competitor analyst: Claude returned non-JSON output.')
    }
    try {
      json = JSON.parse(match[0]) as RawClaudeResponse
    } catch {
      throw new Error('Competitor analyst: Claude returned malformed JSON.')
    }
  }

  if (typeof json.market_structure_md !== 'string' || json.market_structure_md.trim().length === 0) {
    throw new Error('Competitor analyst: response missing market_structure_md.')
  }
  if (typeof json.benchmarking_path_md !== 'string' || json.benchmarking_path_md.trim().length === 0) {
    throw new Error('Competitor analyst: response missing benchmarking_path_md.')
  }

  return {
    market_structure_md: json.market_structure_md,
    benchmarking_path_md: json.benchmarking_path_md,
  }
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m)
  return fenced ? fenced[1] : text
}
