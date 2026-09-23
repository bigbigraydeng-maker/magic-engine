/**
 * AI Visibility Tracker — Perplexity (Research Engine) runner.
 *
 * Sends one question to Perplexity Sonar with real-time web search,
 * localized to the client's target market (AU/NZ).
 *
 * Perplexity's API is OpenAI-compatible; citations are returned as a
 * top-level `citations` array on the response object.
 *
 * Reference: ROADMAP.md P7.1.13, ARCHITECTURE.md §12.4
 */

import OpenAI from 'openai'
import { classifyPerplexityFailure } from '@/lib/ai/provider-failure'
import { recordRunnerOutage } from './outage-bridge'
import { marketToLocation, type RunnerInput, type RunnerOutput } from './types'

const SEARCH_MODEL = 'sonar'
const BASE_URL = 'https://api.perplexity.ai'

// Perplexity sonar pricing per million tokens
const PRICE_INPUT_PER_M = 1.0
const PRICE_OUTPUT_PER_M = 1.0

export async function runPerplexity(input: RunnerInput): Promise<RunnerOutput> {
  const start = Date.now()
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) {
    return errorOutput(start, 'PERPLEXITY_API_KEY environment variable is not set')
  }

  const { country } = marketToLocation(input.market)

  // Build a system prompt that grounds the search in AU/NZ context
  const locationContext = country === 'AU'
    ? 'Focus on results relevant to Australia.'
    : country === 'NZ'
    ? 'Focus on results relevant to New Zealand.'
    : 'Focus on results relevant to Australia and New Zealand.'

  const systemPrompt = `You are a helpful research assistant. ${locationContext} Provide accurate, up-to-date information based on current web sources.`

  try {
    // Use OpenAI SDK with Perplexity base URL — fully compatible protocol
    const client = new OpenAI({ apiKey, baseURL: BASE_URL })

    const response = await client.chat.completions.create({
      model: SEARCH_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input.question },
      ],
    })

    const rawResponse = response.choices[0]?.message?.content ?? ''

    // Perplexity returns citations as a top-level array (not in OpenAI type)
    const citations = extractCitations(response)

    const inputTok = response.usage?.prompt_tokens ?? 0
    const outputTok = response.usage?.completion_tokens ?? 0
    const costUsd =
      (inputTok / 1_000_000) * PRICE_INPUT_PER_M +
      (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

    return {
      ai_engine: 'perplexity',
      ai_model: SEARCH_MODEL,
      raw_response: rawResponse,
      citations,
      tokens_used: inputTok + outputTok,
      cost_usd: costUsd,
      latency_ms: Date.now() - start,
      error_message: null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // 接上断电台账 —— 跟 gemini.ts 同一套接线。
    const kind = classifyPerplexityFailure(err)
    void recordRunnerOutage('perplexity', kind, `Perplexity ${SEARCH_MODEL}: ${message}`)

    return errorOutput(start, message)
  }
}

function errorOutput(start: number, errorMessage: string): RunnerOutput {
  return {
    ai_engine: 'perplexity',
    ai_model: SEARCH_MODEL,
    raw_response: '',
    citations: [],
    tokens_used: null,
    cost_usd: null,
    latency_ms: Date.now() - start,
    error_message: errorMessage,
  }
}

/**
 * Perplexity returns citations as a top-level `citations` string[] on the
 * response object. Not part of the OpenAI type, so we narrow defensively.
 */
function extractCitations(response: unknown): string[] {
  if (!response || typeof response !== 'object') return []
  const r = response as { citations?: unknown }
  if (!Array.isArray(r.citations)) return []
  return r.citations.filter((c): c is string => typeof c === 'string')
}
