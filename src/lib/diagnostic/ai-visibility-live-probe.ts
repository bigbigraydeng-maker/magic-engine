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
  /**
   * Set when this question could NOT be measured at all (engine error, empty
   * response, exception). `client_brand_rank: null` alongside a non-null
   * `error` means "we do not know", NOT "the brand was absent" — the two are
   * indistinguishable without this field, and conflating them fabricates a
   * client-facing measurement result. See CLAUDE.md 铁律 8.
   */
  error: string | null
}

export interface LiveProbeResult {
  /** Questions attempted. */
  runs: number
  /**
   * Questions that actually produced a usable engine answer. Only these can
   * carry evidence about the brand. `runs - failed_runs`.
   */
  measured_runs: number
  /**
   * Questions whose engine call failed (429 / timeout / model error). A brand
   * missing from a failed run is NOT evidence of absence.
   */
  failed_runs: number
  mentions: number
  avg_rank: number | null
  questions: LiveProbeQuestionResult[]
  /** Total latency for the probe call, in milliseconds. */
  latency_ms: number
  /** `true` when the probe did not produce a conclusive measurement. */
  skipped: boolean
  skip_reason?: string
  /**
   * Distinguishes WHY `skipped` is true. `'not_configured'` means the probe
   * never attempted a call (missing API key, no priority questions set up) —
   * a genuine "tracking was never enabled" state. `'attempt_failed'` means
   * the probe DID try and the attempt itself broke (the outer timeout fired,
   * or `probe.run()` rejected) — a transient failure, not evidence that
   * tracking is unconfigured. Callers must not collapse the two: reporting
   * an `attempt_failed` skip as "not tracked" tells the client to go
   * configure something that is already configured and simply timed out.
   */
  skip_kind?: 'not_configured' | 'attempt_failed'
}

export interface LiveProbe {
  run(input: LiveProbeInput): Promise<LiveProbeResult>
}

/**
 * Whether a probe result may back a client-facing conclusion.
 *
 * Fail-closed on purpose: the probe samples only
 * {@link LIVE_PROBE_QUESTION_LIMIT} questions, so losing even one of them
 * leaves too little to assert either presence or absence — and the lost one
 * may well have been the hit. A probe is therefore conclusive only when every
 * attempted question was actually measured.
 *
 * Callers must treat a non-conclusive probe as "not measured" (score `null`,
 * no findings, no evidence), never as "measured zero". See
 * docs/PITFALLS.md and CLAUDE.md 铁律 8 —— a measurement we failed to take is
 * not a measurement of zero.
 */
export function isProbeConclusive(probe: LiveProbeResult | null): probe is LiveProbeResult {
  return (
    probe !== null &&
    !probe.skipped &&
    probe.failed_runs === 0 &&
    probe.measured_runs > 0
  )
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

      const identity = await loadClientIdentity(supabase, clientId)
      const questions: LiveProbeQuestionResult[] = []
      let mentions = 0
      let failedRuns = 0
      const ranks: number[] = []

      for (const q of queries) {
        const market: MarketTag = (q.market_tag ?? 'au-nz') as MarketTag
        try {
          const out = await runOpenAI({ question: q.question, market })
          if (out.error_message || !out.raw_response) {
            // The engine call did not come back with an answer — we measured
            // NOTHING here. Recording this as a plain `rank: null` used to make
            // it indistinguishable from "the engine answered and did not name
            // the brand", which downstream turned into a critical client-facing
            // finding out of thin air.
            failedRuns++
            questions.push({
              question: q.question,
              client_brand_rank: null,
              error: out.error_message || 'engine returned an empty response',
            })
            continue
          }
          const parsed = await parseRanking({
            rawResponse: out.raw_response,
            clientBrandName: brandName,
            clientDomain: identity.domain,
            clientAliases: identity.brand_aliases,
            clientGeoAnchors: identity.brand_geo_anchors,
          })
          questions.push({
            question: q.question,
            client_brand_rank: parsed.client_brand_rank,
            error: null,
          })
          if (parsed.client_brand_rank !== null) {
            mentions++
            ranks.push(parsed.client_brand_rank)
          }
        } catch (err) {
          failedRuns++
          questions.push({
            question: q.question,
            client_brand_rank: null,
            error: err instanceof Error ? err.message : 'probe threw',
          })
        }
      }

      const runs = questions.length
      const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null

      return {
        runs,
        measured_runs: runs - failedRuns,
        failed_runs: failedRuns,
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
    measured_runs: 0,
    failed_runs: 0,
    mentions: 0,
    avg_rank: null,
    questions: [],
    latency_ms: Date.now() - start,
    skipped: true,
    skip_reason: reason,
    skip_kind: 'not_configured',
  }
}

interface ClientIdentityRow {
  domain: string | null
  brand_aliases: string[] | null
  brand_geo_anchors: string[] | null
}

async function loadClientIdentity(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientIdentityRow> {
  const { data, error } = await supabase
    .from('clients')
    .select('domain, brand_aliases, brand_geo_anchors')
    .eq('id', clientId)
    .maybeSingle<ClientIdentityRow>()
  // A missing ROW is fine — matching just falls back to the brand name. A
  // failed QUERY is not: it would drop domain, aliases and anchors together,
  // for every client at once, and the diagnostic score would quietly sag with
  // nothing in the run to explain it. Fail loudly instead.
  if (error) {
    throw new Error(
      `[ai-visibility-live-probe] client identity load failed (${clientId}): ${error.message}`
    )
  }
  return {
    domain: data?.domain ?? null,
    brand_aliases: data?.brand_aliases ?? null,
    brand_geo_anchors: data?.brand_geo_anchors ?? null,
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
        measured_runs: 0,
        failed_runs: 0,
        mentions: 0,
        avg_rank: null,
        questions: [],
        latency_ms: Date.now() - start,
        skipped: true,
        skip_reason: `live probe exceeded ${timeoutMs}ms`,
        skip_kind: 'attempt_failed',
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
          measured_runs: 0,
          failed_runs: 0,
          mentions: 0,
          avg_rank: null,
          questions: [],
          latency_ms: Date.now() - start,
          skipped: true,
          skip_reason: 'live probe threw',
          skip_kind: 'attempt_failed',
        })
      },
    )
  })
}
