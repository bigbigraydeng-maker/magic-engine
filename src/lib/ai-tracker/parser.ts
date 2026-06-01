/**
 * AI Visibility Tracker — Brand ranking parser.
 *
 * Takes a natural-language response from one of the runners and extracts
 * structured brand mentions + the client's own brand rank.
 *
 * Uses OpenAI GPT-4o-mini (JSON mode) — far cheaper and faster than
 * the Strategy Engine, with reliable structured output.
 *
 * Reference: ROADMAP.md P7.1.8, P7.1.12, ARCHITECTURE.md §12.4
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'
import type { BrandMention } from '@/types/magic-engine'

// gpt-4o-mini pricing per million tokens
const PRICE_INPUT_PER_M = 0.15
const PRICE_OUTPUT_PER_M = 0.60
const PARSER_MODEL = 'gpt-4o-mini'

const PARSER_SYSTEM_PROMPT = `You are a precise data extraction assistant.

Your task: read a natural-language answer that an AI assistant gave to a
consumer question, and extract every BRAND, COMPANY, or SERVICE PROVIDER
mentioned, in the order they appear.

RULES:
1. Output ONLY valid JSON — no prose, no markdown fences.
2. Extract brands/companies/operators that the AI is recommending or
   discussing as solution providers. Do NOT extract:
   - Generic terms ("local guides", "travel agents")
   - Products/destinations that aren't brands ("Great Wall", "China visa")
   - Government bodies, news outlets, or aggregators unless they ARE the
     recommended provider
3. "rank" is the 1-based ordinal position of the brand in the response. If
   the AI presents an ordered list (1. 2. 3.), use that. If it's prose, use
   the order in which the brand first appears.
4. "snippet" is a short (≤ 30 words) quote from the response showing where
   the brand was mentioned.
5. "url" is included ONLY if the response explicitly cites a URL for that
   brand. Otherwise omit the field.

OUTPUT JSON SCHEMA (follow exactly):
{
  "brands": [
    {
      "brand": "string — official brand/company name",
      "rank": 1,
      "snippet": "string — short quote (≤ 30 words)",
      "url": "string — optional, only if cited"
    }
  ]
}`

export interface ParseResult {
  brands: BrandMention[]
  /** Rank of the client's own brand if mentioned, else null. */
  client_brand_rank: number | null
  /** Cost of the parser invocation in USD. */
  parse_cost_usd: number
}

export async function parseRanking(input: {
  rawResponse: string
  clientBrandName: string
}): Promise<ParseResult> {
  const { rawResponse, clientBrandName } = input

  // Empty / very short responses can't yield meaningful rankings
  if (!rawResponse || rawResponse.trim().length < 30) {
    return { brands: [], client_brand_rank: null, parse_cost_usd: 0 }
  }

  const userMessage = [
    `## AI assistant's response`,
    rawResponse,
    '',
    `## Client brand to look for`,
    clientBrandName,
    '',
    `Extract all brands/companies/providers mentioned in the response, in the order`,
    `they appear. Return JSON in the format defined in the system prompt.`,
  ].join('\n')

  const client = getOpenAIClient()
  const completion = await client.chat.completions.create({
    model: PARSER_MODEL,
    response_format: { type: 'json_object' },
    max_tokens: 1024,
    messages: [
      { role: 'system', content: PARSER_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  })

  const text = completion.choices[0]?.message?.content ?? ''
  const inputTok = completion.usage?.prompt_tokens ?? 0
  const outputTok = completion.usage?.completion_tokens ?? 0
  const parseCostUsd =
    (inputTok / 1_000_000) * PRICE_INPUT_PER_M +
    (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

  let parsed: { brands: unknown[] }
  try {
    parsed = JSON.parse(text) as { brands: unknown[] }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown JSON parse error'
    throw new Error(
      `Parser JSON parse error: ${errorMsg}. Response preview: ${text.substring(0, 200)}`
    )
  }

  const brands = (parsed.brands ?? []).filter(isValidBrand)

  // Find client's own brand rank using fuzzy match (case-insensitive substring)
  // Only allow reverse match for brands ≥ 3 chars to avoid false positives
  // (e.g., "Air" matching "Air New Zealand" and "Air China")
  const clientLower = clientBrandName.toLowerCase().trim()
  const clientMention = brands.find(b => {
    const bLower = b.brand.toLowerCase()
    return (
      b.brand.toLowerCase().includes(clientLower) ||
      (clientLower.length >= 3 && bLower.length >= 3 && clientLower.includes(bLower))
    )
  })

  return {
    brands,
    client_brand_rank: clientMention?.rank ?? null,
    parse_cost_usd: parseCostUsd,
  }
}

function isValidBrand(b: unknown): b is BrandMention {
  if (!b || typeof b !== 'object') return false
  const obj = b as Record<string, unknown>
  return (
    typeof obj.brand === 'string' &&
    obj.brand.trim().length > 0 &&
    typeof obj.rank === 'number' &&
    obj.rank > 0 &&
    typeof obj.snippet === 'string'
  )
}
