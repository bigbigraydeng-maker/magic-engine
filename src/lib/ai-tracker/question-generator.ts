/**
 * AI Visibility Tracker — Industry question generator.
 *
 * Generates 10-25 industry questions that potential customers would ask
 * AI assistants (ChatGPT, Google AI, Perplexity) about the client's category.
 * These questions form the basis for tracking the client's brand visibility
 * across AI engines.
 *
 * Uses OpenAI GPT-4o-mini (JSON mode) — consistent with parser.ts to keep
 * all internal generation on OpenAI and avoid Claude rate limits.
 *
 * Geographic context: AU/NZ market is the 2026 default. Every generated
 * question MUST include a market signal (e.g. "in New Zealand",
 * "for Australian businesses"). See CLAUDE.md §十二.
 *
 * Reference: ROADMAP.md P7.1.2, ARCHITECTURE.md §12
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'
import { supabaseAdmin } from '../supabase'
import { getClientCompetitorDomains } from '../competitors/resolver'
import type {
  GenerateQuestionsRequest,
  GenerateQuestionsResult,
  GeneratedQuestion,
  MarketTag,
} from '@/types/magic-engine'

const QUESTION_GENERATOR_SYSTEM_PROMPT = `You are an SEO and AI-visibility strategist
specialised in the Australian and New Zealand markets.

Your task: generate industry questions that real prospective customers
would ask AI assistants (ChatGPT, Claude, Perplexity) when researching
products or services in the client's category. These questions will be
used to track how AI engines rank brands in this category.

RULES:
1. Output ONLY valid JSON — no prose, no markdown fences, no explanation.
2. Every question MUST include explicit geographic context for the
   client's target market (e.g. "in New Zealand", "for Australian
   businesses", "across Australia and NZ").
3. Use AU/NZ English spelling (e.g. "specialise", "organisation").
4. Reflect LOCAL search intent — questions a real Kiwi or Aussie
   would type, not generic global questions.
5. Spread across these categories:
   - comparison      ("best X for Y in NZ", "top X providers in Australia")
   - recommendation  ("which X should I use for...")
   - how_to          ("how do I...", "what's the best way to...")
   - decision        ("X vs Y for Australian users", "should I choose X or Y")
   - discovery       ("what is X", "how does X work in NZ")
6. Avoid brand-specific questions (don't mention the client's brand by
   name — we want to find out IF and WHEN AI mentions them organically).
7. Each question 8-25 words. Natural conversational tone.
8. Coverage: include both top-of-funnel ("what is...") and
   decision-stage ("best X for...") questions.

OUTPUT JSON SCHEMA (follow exactly):
{
  "questions": [
    {
      "question": "string — the question text, 8-25 words, with geographic context",
      "category": "comparison | how_to | recommendation | decision | discovery",
      "market_tag": "au | nz | au-nz | global",
      "rationale": "string — 1 sentence on why this question matters for the brand"
    }
  ]
}`

interface ClientRow {
  id: string
  name: string
  domain: string | null
  semrush_db: string | null
}

interface MasterBriefRow {
  brand_name: string | null
  core_proposition: string | null
  content_pillars: unknown
  target_audience: unknown
  keyword_seeds: string[] | null
}

/**
 * Generate industry questions for a client based on their Master Brief.
 * Does NOT persist to database — caller is responsible for inserting
 * the returned questions into ai_visibility_queries.
 */
export async function generateQuestionsForClient(
  req: GenerateQuestionsRequest
): Promise<GenerateQuestionsResult> {
  const { clientId, count, market, contextHint } = normaliseRequest(req)

  // Load client info
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, semrush_db')
    .eq('id', clientId)
    .single<ClientRow>()

  if (clientErr || !client) {
    throw new Error(
      `Client not found: ${clientId} (${clientErr?.message ?? 'no row'})`
    )
  }

  // Load active master_brief (optional — fall back to client info if absent)
  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select(
      'brand_name, core_proposition, content_pillars, target_audience, keyword_seeds'
    )
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle<MasterBriefRow>()

  // Competitor list resolved via unified resolver
  // (clients.competitor_domains > master_briefs.competitor_domains > none).
  const competitorDomains = await getClientCompetitorDomains(clientId, [], 10)

  const userMessage = buildUserMessage({
    client,
    brief,
    competitorDomains,
    count,
    market,
    contextHint,
  })

  const openai = getOpenAIClient()

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 4096,
    messages: [
      { role: 'system', content: QUESTION_GENERATOR_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  })

  const rawText = completion.choices[0]?.message?.content ?? '{}'
  const usage = completion.usage
  const inputTokens = usage?.prompt_tokens ?? 0
  const outputTokens = usage?.completion_tokens ?? 0
  // GPT-4o-mini pricing: $0.15/M input, $0.60/M output
  const costUsd =
    (inputTokens / 1_000_000) * 0.15 + (outputTokens / 1_000_000) * 0.60

  let parsed: { questions?: GeneratedQuestion[] }
  try {
    parsed = JSON.parse(rawText) as { questions?: GeneratedQuestion[] }
  } catch {
    throw new Error('Question generator returned invalid JSON: ' + rawText.slice(0, 200))
  }

  const questions = (parsed.questions ?? [])
    .filter(isValidQuestion)
    .slice(0, count)

  if (questions.length === 0) {
    throw new Error(
      'Question generator returned no valid questions. Raw response: ' +
        rawText.slice(0, 400)
    )
  }

  return {
    questions,
    cost_usd: costUsd,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseRequest(req: GenerateQuestionsRequest): {
  clientId: string
  count: number
  market: MarketTag
  contextHint?: string
} {
  if (!req.client_id) {
    throw new Error('client_id is required')
  }
  const count = Math.max(10, Math.min(25, req.count ?? 18))
  const market = req.market ?? 'au-nz'
  return {
    clientId: req.client_id,
    count,
    market,
    contextHint: req.context_hint?.trim() || undefined,
  }
}

function buildUserMessage(input: {
  client: ClientRow
  brief: MasterBriefRow | null
  competitorDomains: string[]
  count: number
  market: MarketTag
  contextHint?: string
}): string {
  const { client, brief, competitorDomains, count, market, contextHint } = input

  const lines: string[] = [
    `Generate ${count} industry questions for the following brand.`,
    '',
    `## Brand`,
    `- Name: ${brief?.brand_name ?? client.name}`,
    `- Website: ${client.domain ?? '(not provided)'}`,
  ]

  if (brief?.core_proposition) {
    lines.push(`- Core proposition: ${brief.core_proposition}`)
  }

  if (brief?.target_audience) {
    lines.push(`- Target audience: ${JSON.stringify(brief.target_audience)}`)
  }

  if (brief?.content_pillars) {
    lines.push(`- Content pillars: ${JSON.stringify(brief.content_pillars)}`)
  }

  if (competitorDomains.length > 0) {
    lines.push(`- Known competitors: ${competitorDomains.join(', ')}`)
  }

  if (brief?.keyword_seeds?.length) {
    lines.push(`- Seed keywords: ${brief.keyword_seeds.join(', ')}`)
  }

  lines.push('')
  lines.push(`## Target market`)
  lines.push(`- Market tag: ${market}`)
  lines.push(
    market === 'au'
      ? '- Geographic context: Australia (use phrases like "in Australia", "for Aussie businesses")'
      : market === 'nz'
        ? '- Geographic context: New Zealand (use phrases like "in New Zealand", "for Kiwi customers")'
        : market === 'au-nz'
          ? '- Geographic context: Australia and New Zealand (use phrases like "in Australia and NZ", "for AU/NZ market")'
          : '- Geographic context: global (no specific country anchor)'
  )

  if (contextHint) {
    lines.push('')
    lines.push(`## Additional context from operator`)
    lines.push(contextHint)
  }

  lines.push('')
  lines.push(
    `Return EXACTLY ${count} questions in the JSON format defined in the system prompt.`
  )

  return lines.join('\n')
}

function isValidQuestion(q: unknown): q is GeneratedQuestion {
  if (!q || typeof q !== 'object') return false
  const obj = q as Record<string, unknown>
  return (
    typeof obj.question === 'string' &&
    obj.question.trim().length >= 10 &&
    typeof obj.category === 'string' &&
    typeof obj.market_tag === 'string' &&
    typeof obj.rationale === 'string'
  )
}
