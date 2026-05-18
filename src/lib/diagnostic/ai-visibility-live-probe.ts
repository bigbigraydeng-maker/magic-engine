/**
 * AI Visibility — diagnostic-time live probe (P8.10.S2.5).
 *
 * The cron-based weekly snapshot is too coarse for a fresh diagnostic:
 * a client onboarded today has no snapshot until next Monday. This module
 * runs a small, synchronous probe (3 priority questions × 1 engine) so the
 * diagnostic produces a real signal immediately.
 *
 * Design constraints:
 *   - Single engine (OpenAI Content Engine) keeps latency under ~30s
 *   - No DB writes — probe results are ephemeral evidence on findings
 *   - Graceful no-op when OPENAI_API_KEY missing or queries unconfigured
 *   - Mockable via the LiveProbe interface for tests
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runOpenAI } from '@/lib/ai-tracker/runners/openai'
import { parseRanking } from '@/lib/ai-tracker/parser'
import type { AiVisibilityQuery, MarketTag } from '@/types/magic-engine'

export const LIVE_PROBE_QUESTION_LIMIT = 3
export const LIVE_PROBE_TIMEOUT_MS = 45_000

export interface LiveProbeInput {
  clientId: string
  brandName: string
}

export interface LiveProbeQuestionResult {
  question: string
  client_brand_rank: number | null
}

export interface LiveProbeResult {
  runs: number
  mentions: number
  avg_rank: number | null
  questions: LiveProbeQuestionResult[]
  /** Total latency for the probe call, in milliseconds. */
  latency_ms: number
  /** `true` when the probe could not run (missing API key, no queries, etc.). */
  skipped: boolean
  skip_reason?: string
}

export interface LiveProbe {
  run(input: LiveProbeInput): Promise<LiveProbeResult>
}

// ---------------------------------------------------------------------------
// Default implementation — wires real runners + parser
// ---------------------------------------------------------------------------

export function createDefaultLiveProbe(supabase: SupabaseClient): LiveProbe {
  return {
    async run({ clientId, brandName }: LiveProbeInput): Promise<LiveProbeResult> {
      const start = Date.now()
      if (!process.env.OPENAI_API_KEY) {
        return emptyResult(start, 'OPENAI_API_KEY not set')
      }

      const queries = await loadPriorityQueries(supabase, clientId)
      if (queries.length === 0) {
        return emptyResult(start, 'no enabled queries configured')
      }

      const questions: LiveProbeQuestionResult[] = []
      let mentions = 0
      const ranks: number[] = []

      for (const q of queries) {
        const market: MarketTag = (q.market_tag ?? 'au-nz') as MarketTag
        try {
          const out = await runOpenAI({ question: q.question, market })
          if (out.error_message || !out.raw_response) {
            questions.push({ question: q.question, client_brand_rank: null })
            continue
          }
          const parsed = await parseRanking({
            rawResponse: out.raw_response,
            clientBrandName: brandName,
          })
          questions.push({ question: q.question, client_brand_rank: parsed.client_brand_rank })
          if (parsed.client_brand_rank !== null) {
            mentions++
            ranks.push(parsed.client_brand_rank)
          }
        } catch {
          questions.push({ question: q.question, client_brand_rank: null })
        }
      }

      const runs = questions.length
      const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null

      return {
        runs,
        mentions,
        avg_rank: avgRank,
        questions,
        latency_ms: Date.now() - start,
        skipped: false,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(start: number, reason: string): LiveProbeResult {
  return {
    runs: 0,
    mentions: 0,
    avg_rank: null,
    questions: [],
    latency_ms: Date.now() - start,
    skipped: true,
    skip_reason: reason,
  }
}

async function loadPriorityQueries(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AiVisibilityQuery[]> {
  const { data, error } = await supabase
    .from('ai_visibility_queries')
    .select('*')
    .eq('client_id', clientId)
    .eq('enabled', true)
    .order('created_at', { ascending: true })
    .limit(LIVE_PROBE_QUESTION_LIMIT)

  if (error || !data) return []
  return data as AiVisibilityQuery[]
}

/** Wraps a probe call with an overall timeout so a stuck engine cannot hang the diagnostic. */
export async function runProbeWithTimeout(
  probe: LiveProbe,
  input: LiveProbeInput,
  timeoutMs: number = LIVE_PROBE_TIMEOUT_MS,
): Promise<LiveProbeResult> {
  const start = Date.now()
  return new Promise<LiveProbeResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        runs: 0,
        mentions: 0,
        avg_rank: null,
        questions: [],
        latency_ms: Date.now() - start,
        skipped: true,
        skip_reason: `live probe exceeded ${timeoutMs}ms`,
      })
    }, timeoutMs)

    probe.run(input).then(
      (res) => {
        clearTimeout(timer)
        resolve(res)
      },
      () => {
        clearTimeout(timer)
        resolve({
          runs: 0,
          mentions: 0,
          avg_rank: null,
          questions: [],
          latency_ms: Date.now() - start,
          skipped: true,
          skip_reason: 'live probe threw',
        })
      },
    )
  })
}
