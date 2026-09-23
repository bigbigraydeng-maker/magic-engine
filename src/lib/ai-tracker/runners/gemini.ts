/**
 * AI Visibility Tracker — Gemini (Google AI) runner.
 *
 * Sends one question to Gemini 2.0 Flash with Google Search Grounding,
 * giving real-time Google search results as context. Represents what
 * Google's AI surfaces when users search — highest relevance for AU/NZ
 * where Google holds ~90% search market share.
 *
 * Reference: ROADMAP.md P7.1.13, ARCHITECTURE.md §12.4
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { classifyGeminiFailure } from '@/lib/ai/provider-failure'
import { recordRunnerOutage } from './outage-bridge'
import { marketToLocation, type RunnerInput, type RunnerOutput } from './types'

const SEARCH_MODEL = 'gemini-2.5-flash'

// Gemini 2.0 Flash pricing per million tokens
const PRICE_INPUT_PER_M = 0.075
const PRICE_OUTPUT_PER_M = 0.30

export async function runGemini(input: RunnerInput): Promise<RunnerOutput> {
  const start = Date.now()
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // 漏挂 / 删 secret 跟运行时 credential_invalid 是同一件事：只有人能修，必须落断电台账。
    void recordRunnerOutage('google', 'credential_invalid', 'GEMINI_API_KEY environment variable is not set')
    return errorOutput(start, 'GEMINI_API_KEY environment variable is not set')
  }

  const { country } = marketToLocation(input.market)
  const locationContext = country === 'AU'
    ? 'Focus on results relevant to Australia.'
    : country === 'NZ'
    ? 'Focus on results relevant to New Zealand.'
    : 'Focus on results relevant to Australia and New Zealand.'

  const prompt = `${locationContext}\n\n${input.question}`

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: SEARCH_MODEL,
      // Enable Google Search Grounding — answers are based on real-time
      // Google search results, closely mirroring Google AI Overview behaviour.
      // Cast required: SDK runtime supports googleSearch but TS types lag behind.
      tools: [{ googleSearch: {} }] as any,
    })

    const result = await model.generateContent(prompt)
    const response = result.response

    const rawResponse = response.text()

    // Extract grounding citations from groundingMetadata
    const citations = extractCitations(response)

    // Gemini usage metadata (may be undefined for grounded requests)
    const usageMeta = response.usageMetadata
    const inputTok = usageMeta?.promptTokenCount ?? null
    const outputTok = usageMeta?.candidatesTokenCount ?? null
    const costUsd =
      inputTok !== null && outputTok !== null
        ? (inputTok / 1_000_000) * PRICE_INPUT_PER_M +
          (outputTok / 1_000_000) * PRICE_OUTPUT_PER_M
        : null

    return {
      ai_engine: 'google',
      ai_model: SEARCH_MODEL,
      raw_response: rawResponse,
      citations,
      tokens_used: inputTok !== null && outputTok !== null ? inputTok + outputTok : null,
      cost_usd: costUsd,
      latency_ms: Date.now() - start,
      error_message: null,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // 接上断电台账 —— Gemini 挂掉时 PM 能在今日待办看到，不再只是 run 行里一行 error_message。
    // void：绝不阻塞返回，绝不向调用方抛（outage-bridge 内部已吞错）。
    const kind = classifyGeminiFailure(err)
    void recordRunnerOutage('google', kind, `Gemini ${SEARCH_MODEL}: ${message}`)

    return errorOutput(start, message)
  }
}

function errorOutput(start: number, errorMessage: string): RunnerOutput {
  return {
    ai_engine: 'google',
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
 * Extract web URLs from Gemini's groundingMetadata.
 * The SDK types groundingChunks as optional — narrow defensively.
 */
function extractCitations(response: unknown): string[] {
  if (!response || typeof response !== 'object') return []
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string } }>
      }
    }>
  }
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  const urls = chunks
    .map(c => c.web?.uri)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
  return Array.from(new Set(urls))
}
