/**
 * AI Visibility Tracker — OpenAI (Content Engine) runner.
 *
 * Sends one question to GPT-4o with web search enabled (gpt-4o-search-preview),
 * localized to the client's target market (AU/NZ).
 *
 * Reference: ROADMAP.md P7.1.5, ARCHITECTURE.md §12.4
 */

import OpenAI from 'openai'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { marketToLocation, type RunnerInput, type RunnerOutput } from './types'

// gpt-4o-search-preview pricing per million tokens (mirrors gpt-4o)
const PRICE_INPUT_PER_M = 2.5
const PRICE_OUTPUT_PER_M = 10.0
const SEARCH_MODEL = 'gpt-4o-search-preview'

export async function runOpenAI(input: RunnerInput): Promise<RunnerOutput> {
  const start = Date.now()
  if (!process.env.OPENAI_API_KEY) {
    return errorOutput(start, 'OPENAI_API_KEY environment variable is not set')
  }

  const { country, timezone } = marketToLocation(input.market)
  const approximate: Record<string, string> = {}
  if (country) approximate.country = country
  if (timezone) approximate.timezone = timezone

  const webSearchOptions =
    Object.keys(approximate).length > 0
      ? {
          user_location: {
            type: 'approximate' as const,
            approximate,
          },
        }
      : undefined

  try {
    const client = getOpenAIClient()
    // The web_search_options field is supported by gpt-4o-search-preview
    // models but isn't in the public type definition for chat.completions.
    // Cast to unknown to bypass — the runtime API accepts it.
    const params = {
      model: SEARCH_MODEL,
      messages: [{ role: 'user' as const, content: input.question }],
      ...(webSearchOptions ? { web_search_options: webSearchOptions } : {}),
    } as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming

    const response = await client.chat.completions.create(params)

    const choice = response.choices[0]
    const rawResponse = choice?.message?.content ?? ''
    const citations = extractCitations(choice?.message)

    const inputTok = response.usage?.prompt_tokens ?? 0
    const outputTok = response.usage?.completion_tokens ?? 0
    const costUsd =
      (inputTok / 1_000_000) * PRICE_INPUT_PER_M +
      (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M

    return {
      ai_engine: 'openai',
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
    return errorOutput(start, message)
  }
}

function errorOutput(start: number, errorMessage: string): RunnerOutput {
  return {
    ai_engine: 'openai',
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
 * gpt-4o-search-preview returns citations as `annotations` of type
 * `url_citation` on the assistant message. SDK 6.x doesn't type these
 * annotations, so we narrow defensively.
 */
function extractCitations(message: unknown): string[] {
  if (!message || typeof message !== 'object') return []
  const annotations = (message as { annotations?: unknown }).annotations
  if (!Array.isArray(annotations)) return []
  const urls: string[] = []
  for (const anno of annotations) {
    if (!anno || typeof anno !== 'object') continue
    const a = anno as { type?: string; url_citation?: { url?: string } }
    if (a.type === 'url_citation' && a.url_citation?.url) {
      urls.push(a.url_citation.url)
    }
  }
  return Array.from(new Set(urls))
}
