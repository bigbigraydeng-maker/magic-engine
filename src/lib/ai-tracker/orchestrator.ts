/**
 * AI Visibility Tracker — Orchestrator.
 *
 * Runs one full Tracker pass for a client:
 *   N questions × 3 engines (OpenAI + Perplexity + Gemini) = 3N runner calls
 *   plus 3N parser calls (OpenAI GPT-4o-mini) = ~6N total LLM round-trips per pass
 *
 * Pipeline per (query, engine):
 *   1. Runner returns raw natural-language response + citations
 *   2. Insert ai_visibility_runs row with raw_response (no rankings yet)
 *   3. Parser converts raw_response → BrandMention[] + client_brand_rank
 *   4. Update the row with parsed rankings
 *
 * After all runs complete, aggregate into a weekly ai_visibility_snapshots row.
 *
 * Reference: ROADMAP.md P7.1.9, ARCHITECTURE.md §12.4
 */

import { runOpenAI } from './runners/openai'
import { runClaude } from './runners/claude'
import { runPerplexity } from './runners/perplexity'
import { runGemini } from './runners/gemini'
import { parseRanking } from './parser'
import {
  buildClientIdentifiers,
  hasGeoGate,
  isClientBrand,
  type ClientBrandIdentity,
} from './client-brand-match'
import { isRunConclusive } from './run-conclusive'
import { supabaseAdmin } from '../supabase'
import { fetchAll } from '../supabase-paginate'
import {
  RUN_CONCLUSIVENESS_COLUMNS,
  partitionConclusiveRuns,
  summariseRunFailures,
  type RunConclusiveness,
} from './run-conclusive'
import { writeTrackerFlywheelMetrics } from '../flywheel/metrics/writeTrackerMetrics'
import type {
  AiEngine,
  AiVisibilityQuery,
  BrandMention,
  MarketTag,
} from '@/types/magic-engine'

// Concurrency: process one query at a time per engine to respect RPM limits.
// Engines run sequentially (not in parallel) to prevent cross-engine burst.
const PER_ENGINE_BATCH_SIZE = 1


export interface RunTrackerInput {
  client_id: string
  /** Optional subset of query IDs; defaults to all enabled queries. */
  query_ids?: string[]
  /** Override the engines run; defaults to both. */
  engines?: AiEngine[]
}

export interface RunTrackerResult {
  client_id: string
  runs_attempted: number
  runs_succeeded: number
  runs_failed: number
  /**
   * Runs that produced a real, usable ranking — same standard as
   * `isRunConclusive` (shared with the snapshot gate and monthly-aggregator).
   * Deliberately separate from `runs_succeeded`: that counter goes up even
   * when `parseRanking` throws (see processOne — the DB update still
   * succeeds, so `runs_succeeded++` fires regardless of `parse_error_message`).
   * Callers that need "did this client get any real data" — not "did the
   * provider call and DB write both not error" — should read this field
   * instead (Codex review 2026-09-28, on the old ai-tracker-weekly cron
   * still trusting runs_succeeded for its all-failed detection).
   */
  runs_conclusive: number
  client_brand_mentions: number
  total_cost_usd: number
  total_latency_ms: number
  snapshot_id: string | null
  /**
   * Why no snapshot / no flywheel metric was written, in plain language.
   * Non-null means "we could not compute a number", which is NOT the same as
   * "the number is zero" — see run-conclusive.ts. Kept on the result so the
   * cron log and the caller name the real cause instead of leaving FDE/PM to
   * read a missing row as a system fault (playbook-geo §9.5).
   */
  snapshot_skipped_reason: string | null
  errors: Array<{ query_id: string; engine: AiEngine; message: string }>
}

interface ClientRow {
  id: string
  name: string
  domain: string | null
  brand_aliases: string[] | null
  brand_geo_anchors: string[] | null
}

interface BriefRow {
  brand_name: string | null
}

/**
 * Run a complete tracker pass for a client.
 * This is a long-running async function — typical runtime 1-5 minutes for
 * 18 questions × 2 engines.
 */
export async function runTracker(
  input: RunTrackerInput
): Promise<RunTrackerResult> {
  const startTime = Date.now()
  const engines: AiEngine[] = input.engines ?? ['openai', 'google']

  console.log('[runTracker] Starting for client:', input.client_id, 'engines:', engines)

  // 1. Load client info + brand name
  console.log('[runTracker] Loading client context...')
  const { client, brandName } = await loadClientContext(input.client_id)
  console.log('[runTracker] Client loaded:', client.name, 'brand:', brandName)

  // 2. Load enabled queries (filtered by query_ids if provided)
  console.log('[runTracker] Loading queries...')
  const queries = await loadQueries(input.client_id, input.query_ids)
  console.log('[runTracker] Queries loaded:', queries.length)

  if (queries.length === 0) {
    throw new Error(
      `No enabled queries found for client ${input.client_id}. Generate questions first.`
    )
  }

  const result: RunTrackerResult = {
    client_id: input.client_id,
    runs_attempted: queries.length * engines.length,
    runs_succeeded: 0,
    runs_failed: 0,
    runs_conclusive: 0,
    client_brand_mentions: 0,
    total_cost_usd: 0,
    total_latency_ms: 0,
    snapshot_id: null,
    snapshot_skipped_reason: null,
    errors: [],
  }

  // 3. Run engines sequentially (not in parallel) to respect rate limits
  // Each engine processes its queries in batches with delays between batches
  console.log('[runTracker] Starting engine lanes for', engines.length, 'engines')
  for (const engine of engines) {
    console.log('[runTracker] Processing engine:', engine)
    await runEngineLane({
      engine,
      queries,
      clientId: client.id,
      brandName,
      clientDomain: client.domain,
      clientAliases: client.brand_aliases,
      clientGeoAnchors: client.brand_geo_anchors,
      result,
    })
    console.log(`[runTracker] Engine ${engine} completed: succeeded=${result.runs_succeeded}, failed=${result.runs_failed}`)
  }

  // 4. Aggregate weekly snapshot.
  //
  // A pass where nothing completed produces NO snapshot and NO metric — not a
  // snapshot full of zeros. `runs_succeeded` is not a sufficient gate on its
  // own: a run whose parser threw still increments it (the engine answered),
  // yet its rank is null for want of parsing, so a pass can reach here with
  // zero conclusive evidence. aggregateSnapshot re-checks against the stored
  // rows and refuses rather than publishing a 0% mention rate.
  console.log('[runTracker] Aggregating snapshot...')
  if (result.runs_succeeded === 0) {
    const topError = result.errors[0]?.message ?? '无错误详情'
    result.snapshot_skipped_reason = `本次 ${result.runs_attempted} 次探测全部失败，没有可用于计算的结果（首个错误：${topError}）`
    console.warn('[runTracker] Snapshot skipped:', result.snapshot_skipped_reason)
  } else {
    const agg = await aggregateSnapshot(client.id, {
      brandName,
      domain: client.domain,
      aliases: client.brand_aliases,
      geoAnchors: client.brand_geo_anchors,
    })

    if (agg.ok) {
      result.snapshot_id = agg.value.snapshotId

      // 5. Write GEO flywheel metrics so attribution job can compute outcomes
      await writeTrackerFlywheelMetrics(client.id, {
        snapshotId: agg.value.snapshotId,
        mentionsCount: agg.value.mentionsCount,
        totalRuns: agg.value.totalRuns,
        avgRank: agg.value.avgRank,
        engineCoverage: agg.value.engineCoverage,
      })
    } else {
      result.snapshot_skipped_reason = agg.reason
      console.warn('[runTracker] Snapshot skipped:', agg.reason)
    }
  }

  result.total_latency_ms = Date.now() - startTime
  console.log('[runTracker] Complete! Total latency:', result.total_latency_ms, 'ms')
  return result
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function loadClientContext(
  clientId: string
): Promise<{ client: ClientRow; brandName: string }> {
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, brand_aliases, brand_geo_anchors')
    .eq('id', clientId)
    .single<ClientRow>()

  if (error || !client) {
    // Carry the driver message: the most likely cause of a sudden failure
    // here is a column in the select above missing from the database (a
    // migration that never ran), and "client not found" would send whoever
    // is on call looking for the wrong thing.
    throw new Error(
      `Client context load failed (${clientId}): ${error?.message ?? 'no row returned'}`
    )
  }

  // Try active master_brief first; fall back to client.name
  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select('brand_name')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .maybeSingle<BriefRow>()

  const brandName = brief?.brand_name?.trim() || client.name
  return { client, brandName }
}

async function loadQueries(
  clientId: string,
  queryIds?: string[]
): Promise<AiVisibilityQuery[]> {
  let query = supabaseAdmin
    .from('ai_visibility_queries')
    .select('*')
    .eq('client_id', clientId)
    .eq('enabled', true)

  if (queryIds && queryIds.length > 0) {
    query = query.in('id', queryIds)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load queries: ${error.message}`)
  }
  return (data ?? []) as AiVisibilityQuery[]
}

interface EngineLaneInput {
  engine: AiEngine
  queries: AiVisibilityQuery[]
  clientId: string
  brandName: string
  clientDomain: string | null
  clientAliases: string[] | null
  clientGeoAnchors: string[] | null
  result: RunTrackerResult
}

/**
 * Process all queries for one engine, in serial batches to respect RPM.
 * Add delay between batches to prevent rate limiting on both runner and parser calls.
 */
async function runEngineLane(input: EngineLaneInput): Promise<void> {
  const { engine, queries, clientId, brandName, clientDomain, clientAliases, clientGeoAnchors, result } = input

  console.log(`[runEngineLane] ${engine}: starting with ${queries.length} queries, batch size = ${PER_ENGINE_BATCH_SIZE}`)

  for (let i = 0; i < queries.length; i += PER_ENGINE_BATCH_SIZE) {
    const batch = queries.slice(i, i + PER_ENGINE_BATCH_SIZE)
    console.log(`[runEngineLane] ${engine}: processing batch at index ${i}, batch size = ${batch.length}`)

    const startBatch = Date.now()
    await Promise.all(
      batch.map(q => {
        console.log(`[runEngineLane] ${engine}: processing query ${q.id}`)
        return processOne({
          engine, query: q, clientId, brandName, clientDomain, clientAliases, clientGeoAnchors, result,
        })
      })
    )
    const batchElapsed = Date.now() - startBatch
    console.log(`[runEngineLane] ${engine}: batch complete in ${batchElapsed}ms`)

    // Add 10-second delay between batches to prevent rate limiting
    // Claude's rate limit (30k tokens/min) is tight; even 2sec wasn't enough
    // 10sec = 600ms per query, safer margin
    if (i + PER_ENGINE_BATCH_SIZE < queries.length) {
      console.log(`[runEngineLane] ${engine}: adding 10-second delay before next batch`)
      await new Promise(resolve => setTimeout(resolve, 10000))
    }
  }

  console.log(`[runEngineLane] ${engine}: complete`)
}

interface ProcessOneInput {
  engine: AiEngine
  query: AiVisibilityQuery
  clientId: string
  brandName: string
  clientDomain: string | null
  clientAliases: string[] | null
  clientGeoAnchors: string[] | null
  result: RunTrackerResult
}

/**
 * Run + parse one (query, engine) pair, persisting results.
 * Catches all errors so one failure doesn't kill the whole pass.
 */
async function processOne(input: ProcessOneInput): Promise<void> {
  const { engine, query, clientId, brandName, clientDomain, clientAliases, clientGeoAnchors, result } = input
  const market: MarketTag = (query.market_tag ?? 'au-nz') as MarketTag

  try {
    // 1. Runner call — select based on engine type
    const runner =
      engine === 'openai'     ? runOpenAI :
      engine === 'perplexity' ? runPerplexity :
      engine === 'google'     ? runGemini :
      runClaude
    const runnerOut = await runner({ question: query.question, market })

    // 2. Insert ai_visibility_runs row immediately (we have raw response)
    const { data: runRow, error: insertErr } = await supabaseAdmin
      .from('ai_visibility_runs')
      .insert({
        client_id: clientId,
        query_id: query.id,
        ai_engine: runnerOut.ai_engine,
        ai_model: runnerOut.ai_model,
        raw_response: runnerOut.raw_response || null,
        brands_mentioned: [],
        client_brand_rank: null,
        tokens_used: runnerOut.tokens_used,
        cost_usd: runnerOut.cost_usd,
        latency_ms: runnerOut.latency_ms,
        error_message: runnerOut.error_message,
      })
      .select('id')
      .single<{ id: string }>()

    if (insertErr || !runRow) {
      result.runs_failed++
      result.errors.push({
        query_id: query.id,
        engine,
        message: `DB insert failed: ${insertErr?.message ?? 'no row'}`,
      })
      return
    }

    if (runnerOut.error_message) {
      // Runner itself failed — count as failed, no parse
      result.runs_failed++
      result.errors.push({
        query_id: query.id,
        engine,
        message: runnerOut.error_message,
      })
      if (runnerOut.cost_usd) result.total_cost_usd += runnerOut.cost_usd
      return
    }

    // 3. Parser call — convert raw response to structured rankings
    let brands: BrandMention[] = []
    let clientBrandRank: number | null = null
    let parseCost = 0
    let parseError: string | null = null
    try {
      const parsed = await parseRanking({
        rawResponse: runnerOut.raw_response,
        clientBrandName: brandName,
        clientDomain,
        clientAliases,
        clientGeoAnchors,
      })
      brands = parsed.brands
      clientBrandRank = parsed.client_brand_rank
      parseCost = parsed.parse_cost_usd
    } catch (parseErr) {
      // Parser failed but runner succeeded — keep raw, log warning
      const msg =
        parseErr instanceof Error ? parseErr.message : 'Unknown parse error'
      parseError = msg
      result.errors.push({
        query_id: query.id,
        engine,
        message: `Parser failed: ${msg}`,
      })
    }

    // 4. Update the run row with parsed data
    const updatePayload: Record<string, unknown> = {
      brands_mentioned: brands,
      client_brand_rank: clientBrandRank,
      cost_usd: (runnerOut.cost_usd ?? 0) + parseCost,
    }
    // Store parser error if the column exists
    if (parseError !== null) {
      updatePayload.parse_error_message = parseError
    }

    const { error: updateErr } = await supabaseAdmin
      .from('ai_visibility_runs')
      .update(updatePayload)
      .eq('id', runRow.id)

    result.total_cost_usd += (runnerOut.cost_usd ?? 0) + parseCost

    if (updateErr) {
      result.runs_failed++
      result.errors.push({
        query_id: query.id,
        engine,
        message: `DB update failed: ${updateErr.message}`,
      })
      return
    }

    result.runs_succeeded++
    // 🔴 Deliberately separate from runs_succeeded above, and deliberately
    //    NOT changing what runs_succeeded/runs_failed count: a parse failure
    //    (parseRanking threw, parse_error_message got set) still reaches
    //    here and still increments runs_succeeded — that's the existing,
    //    tested behavior (see orchestrator.test.ts "still counts the run
    //    as succeeded when the update itself succeeds"). Two other callers
    //    read runs_succeeded/runs_failed directly (weekly-fanout.ts's
    //    Inngest path uses `runs_succeeded > 0` for its receipt status;
    //    ai-visibility-weekly.ts logs both fields) — flipping their meaning
    //    here would silently change those paths' behavior too, with no
    //    tests covering that. runs_conclusive is purely additive instead:
    //    same isRunConclusive standard the snapshot gate already uses, so
    //    a caller that needs "did we get real data" (the old
    //    ai-tracker-weekly cron's all-failed detection) can read this
    //    field without anyone else's behavior changing (Codex review
    //    2026-09-28).
    if (isRunConclusive({ error_message: null, parse_error_message: parseError })) {
      result.runs_conclusive++
    }
    if (clientBrandRank !== null) result.client_brand_mentions++
  } catch (err: unknown) {
    result.runs_failed++
    const msg = err instanceof Error ? err.message : 'Unknown error'
    result.errors.push({ query_id: query.id, engine, message: msg })
  }
}

interface AggregateResult {
  snapshotId: string
  mentionsCount: number
  totalRuns: number
  avgRank: number | null
  engineCoverage: number
}

/**
 * Either a computed snapshot, or a named reason why no number could be
 * produced. There is no third branch that returns zeros: "we could not
 * measure" must never reach a consumer wearing the clothes of "we measured
 * zero" (run-conclusive.ts).
 */
type AggregateOutcome =
  | { ok: true; value: AggregateResult }
  | { ok: false; reason: string }

/** The row shape aggregateSnapshot reads. */
interface WeekRunRow extends RunConclusiveness {
  ai_engine: string
  ai_model: string
  client_brand_rank: number | null
  brands_mentioned: BrandMention[]
}

/**
 * Aggregate this week's runs into ai_visibility_snapshots.
 * Uses Monday of the current week as the snapshot key.
 * Returns metric data alongside the snapshot id for flywheel writes.
 *
 * Only runs that completed end to end are counted — in the numerator AND the
 * denominator. Counting failed rows in `total_runs` was measurably deflating
 * every client's mention rate (CTS: 39.5% reported vs 50.3% actual across
 * 4031 rows, 2026-09-23), because a row whose engine call threw looks exactly
 * like a row where the AI genuinely did not name the client.
 */
async function aggregateSnapshot(
  clientId: string,
  identity: ClientBrandIdentity
): Promise<AggregateOutcome> {
  const weekOf = mondayOfThisWeek().toISOString().slice(0, 10) // YYYY-MM-DD

  // Pull all runs for this client this week.
  //
  // Paged: PostgREST caps a single response at 1000 rows and says nothing
  // about it (src/lib/supabase-paginate.ts). A busy week goes past that —
  // CTS week of 2026-04-27 stored 1194 runs — so an unpaged read would have
  // silently aggregated the first 1000 and called it the week. Ordered by
  // `id` because the page boundaries need a stable unique key; `ran_at` has
  // ties within a batch and would drop or duplicate rows across pages.
  const weekStart = new Date(weekOf + 'T00:00:00.000Z').toISOString()
  let runs: WeekRunRow[]
  try {
    runs = await fetchAll<WeekRunRow>((from, to) =>
      supabaseAdmin
        .from('ai_visibility_runs')
        .select(
          `ai_engine, ai_model, client_brand_rank, brands_mentioned, ${RUN_CONCLUSIVENESS_COLUMNS}`
        )
        .eq('client_id', clientId)
        .gte('ran_at', weekStart)
        .order('id', { ascending: true })
        .range(from, to)
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, reason: `读取本周探测记录失败：${msg}` }
  }

  // Failed runs are kept in the table as history, but they are not evidence.
  const { conclusive, failed } = partitionConclusiveRuns(runs)

  if (conclusive.length === 0) {
    const detail =
      runs.length === 0
        ? '本周没有任何探测记录'
        : `本周 ${runs.length} 条探测记录没有一条完成（${summariseRunFailures(failed)}）`
    return {
      ok: false,
      reason: `${detail}，提及率算不出来——这不是"AI 没提到我们"，是"这次没探测成"`,
    }
  }

  const totalRuns = conclusive.length
  const ranks = conclusive
    .map(r => r.client_brand_rank)
    .filter((r): r is number => r !== null)
  const mentionsCount = ranks.length
  const avgRank =
    mentionsCount > 0 ? ranks.reduce((a, b) => a + b, 0) / mentionsCount : null
  const modelsCovered = Array.from(new Set(conclusive.map(r => r.ai_model)))
  const engineCoverage = new Set(
    conclusive.filter(r => r.client_brand_rank !== null).map(r => r.ai_engine)
  ).size

  // Build a compact ranking_table for reporting:
  //   { brands: [{ name, mentions, avg_rank, by_engine }] }
  const ranking_table = buildRankingTable(conclusive, identity)

  // Upsert by (client_id, week_of)
  const { data: snapshot, error: upsertErr } = await supabaseAdmin
    .from('ai_visibility_snapshots')
    .upsert(
      {
        client_id: clientId,
        week_of: weekOf,
        avg_rank: avgRank,
        mentions_count: mentionsCount,
        total_runs: totalRuns,
        models_covered: modelsCovered,
        ranking_table,
      },
      { onConflict: 'client_id,week_of' }
    )
    .select('id')
    .single<{ id: string }>()

  if (upsertErr || !snapshot) {
    return {
      ok: false,
      reason: `写入本周快照失败：${upsertErr?.message ?? '没有返回行'}`,
    }
  }
  return {
    ok: true,
    value: { snapshotId: snapshot.id, mentionsCount, totalRuns, avgRank, engineCoverage },
  }
}

/**
 * Aggregate brand mentions across all runs into a flat ranking table.
 *
 * The client's name variants ("CTS Tours", "CTS Tours - China Travel Service
 * (NZ) Limited") collapse into one canonical row. Which entry IS the client
 * is decided per run, by the rank `resolveClientBrandRank` already resolved
 * against that run's answer text — not by matching the brand name on its own.
 * A brand name carries no market signal of its own, so judging it in
 * isolation would un-merge every variant that happens not to spell out the
 * country, and would re-credit the client with a same-named sibling's
 * mentions in answers the run layer had already rejected.
 */
export function buildRankingTable(
  runs: Array<{
    ai_engine: string
    brands_mentioned: BrandMention[]
    client_brand_rank: number | null
  }>,
  identity?: ClientBrandIdentity
): Record<string, unknown> {
  const byBrand = new Map<
    string,
    { mentions: number; rankSum: number; byEngine: Record<string, number[]> }
  >()

  const ids = identity ? buildClientIdentifiers(identity) : []
  const canonicalKey = identity?.brandName.trim() ?? ''
  // Only a client with the gate on defers to the per-run decision. Without
  // anchors this table stays exactly what it was, including for legacy rows
  // that name the client in brands_mentioned while client_brand_rank is null
  // — re-adjudicating those is a separate job, not this change's to do.
  const gated = identity ? hasGeoGate(identity) : false

  for (const run of runs) {
    const mentions = Array.isArray(run.brands_mentioned)
      ? run.brands_mentioned
      : []
    for (const m of mentions) {
      if (!m.brand) continue
      // Every client-matching entry in an accepted run belongs to the client,
      // not only the one sitting at client_brand_rank — that rank is the
      // MINIMUM of the client's entries, so keying on it would throw the
      // client's other spellings out into their own competitor rows. (Measured
      // on CTS: 333 runs, 686 entries.)
      const isClient =
        canonicalKey !== '' &&
        isClientBrand(m.brand, ids) &&
        (!gated || run.client_brand_rank !== null)
      const key = isClient ? canonicalKey : m.brand.trim()
      if (!key) continue
      const entry = byBrand.get(key) ?? {
        mentions: 0,
        rankSum: 0,
        byEngine: {},
      }
      entry.mentions++
      entry.rankSum += m.rank
      const ranksForEngine = entry.byEngine[run.ai_engine] ?? []
      ranksForEngine.push(m.rank)
      entry.byEngine[run.ai_engine] = ranksForEngine
      byBrand.set(key, entry)
    }
  }

  const brands = Array.from(byBrand.entries())
    .map(([name, e]) => ({
      name,
      mentions: e.mentions,
      avg_rank: e.mentions > 0 ? e.rankSum / e.mentions : null,
      by_engine: e.byEngine,
    }))
    .sort((a, b) => {
      // Higher mention count first, then lower avg_rank
      if (b.mentions !== a.mentions) return b.mentions - a.mentions
      return (a.avg_rank ?? 999) - (b.avg_rank ?? 999)
    })

  return { brands }
}

/** Returns this week's Monday at 00:00 UTC. */
function mondayOfThisWeek(): Date {
  const now = new Date()
  const day = now.getUTCDay() // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? -6 : 1 - day // ISO week starts Monday
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff)
  )
  return monday
}
