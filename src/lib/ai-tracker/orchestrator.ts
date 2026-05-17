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
import { supabaseAdmin } from '../supabase'
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
  client_brand_mentions: number
  total_cost_usd: number
  total_latency_ms: number
  snapshot_id: string | null
  errors: Array<{ query_id: string; engine: AiEngine; message: string }>
}

interface ClientRow {
  id: string
  name: string
  domain: string | null
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
    client_brand_mentions: 0,
    total_cost_usd: 0,
    total_latency_ms: 0,
    snapshot_id: null,
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
      result,
    })
    console.log(`[runTracker] Engine ${engine} completed: succeeded=${result.runs_succeeded}, failed=${result.runs_failed}`)
  }

  // 4. Aggregate weekly snapshot (only if we got at least one successful run)
  console.log('[runTracker] Aggregating snapshot...')
  if (result.runs_succeeded > 0) {
    const agg = await aggregateSnapshot(client.id, brandName)
    result.snapshot_id = agg?.snapshotId ?? null

    // 5. Write GEO flywheel metrics so attribution job can compute outcomes
    if (agg) {
      await writeTrackerFlywheelMetrics(client.id, {
        snapshotId: agg.snapshotId,
        mentionsCount: agg.mentionsCount,
        totalRuns: agg.totalRuns,
        avgRank: agg.avgRank,
        engineCoverage: agg.engineCoverage,
      })
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
    .select('id, name, domain')
    .eq('id', clientId)
    .single<ClientRow>()

  if (error || !client) {
    throw new Error(`Client not found: ${clientId}`)
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
  result: RunTrackerResult
}

/**
 * Process all queries for one engine, in serial batches to respect RPM.
 * Add delay between batches to prevent rate limiting on both runner and parser calls.
 */
async function runEngineLane(input: EngineLaneInput): Promise<void> {
  const { engine, queries, clientId, brandName, result } = input

  console.log(`[runEngineLane] ${engine}: starting with ${queries.length} queries, batch size = ${PER_ENGINE_BATCH_SIZE}`)

  for (let i = 0; i < queries.length; i += PER_ENGINE_BATCH_SIZE) {
    const batch = queries.slice(i, i + PER_ENGINE_BATCH_SIZE)
    console.log(`[runEngineLane] ${engine}: processing batch at index ${i}, batch size = ${batch.length}`)

    const startBatch = Date.now()
    await Promise.all(
      batch.map(q => {
        console.log(`[runEngineLane] ${engine}: processing query ${q.id}`)
        return processOne({ engine, query: q, clientId, brandName, result })
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
  result: RunTrackerResult
}

/**
 * Run + parse one (query, engine) pair, persisting results.
 * Catches all errors so one failure doesn't kill the whole pass.
 */
async function processOne(input: ProcessOneInput): Promise<void> {
  const { engine, query, clientId, brandName, result } = input
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

    await supabaseAdmin
      .from('ai_visibility_runs')
      .update(updatePayload)
      .eq('id', runRow.id)

    result.runs_succeeded++
    result.total_cost_usd += (runnerOut.cost_usd ?? 0) + parseCost
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
 * Aggregate this week's runs into ai_visibility_snapshots.
 * Uses Monday of the current week as the snapshot key.
 * Returns metric data alongside the snapshot id for flywheel writes.
 */
async function aggregateSnapshot(clientId: string, brandName: string): Promise<AggregateResult | null> {
  const weekOf = mondayOfThisWeek().toISOString().slice(0, 10) // YYYY-MM-DD

  // Pull all runs for this client this week
  const weekStart = new Date(weekOf + 'T00:00:00.000Z').toISOString()
  const { data: runs, error } = await supabaseAdmin
    .from('ai_visibility_runs')
    .select('ai_engine, ai_model, client_brand_rank, brands_mentioned')
    .eq('client_id', clientId)
    .gte('ran_at', weekStart)

  if (error || !runs) return null

  const totalRuns = runs.length
  const ranks = runs
    .map(r => (r as { client_brand_rank: number | null }).client_brand_rank)
    .filter((r): r is number => r !== null)
  const mentionsCount = ranks.length
  const avgRank =
    mentionsCount > 0 ? ranks.reduce((a, b) => a + b, 0) / mentionsCount : null
  const modelsCovered = Array.from(
    new Set(runs.map(r => (r as { ai_model: string }).ai_model))
  )
  // Distinct engines where brand appeared at least once
  const engineCoverage = new Set(
    runs
      .filter(r => (r as { client_brand_rank: number | null }).client_brand_rank !== null)
      .map(r => (r as { ai_engine: string }).ai_engine)
  ).size

  // Build a compact ranking_table for reporting:
  //   { brands: [{ name, mentions, avg_rank, by_engine }] }
  const ranking_table = buildRankingTable(
    runs as Array<{
      ai_engine: string
      brands_mentioned: BrandMention[]
    }>,
    brandName
  )

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

  if (upsertErr || !snapshot) return null
  return { snapshotId: snapshot.id, mentionsCount, totalRuns, avgRank, engineCoverage }
}

/** Aggregate brand mentions across all runs into a flat ranking table. */
function buildRankingTable(
  runs: Array<{ ai_engine: string; brands_mentioned: BrandMention[] }>,
  clientBrandName?: string
): Record<string, unknown> {
  const byBrand = new Map<
    string,
    { mentions: number; rankSum: number; byEngine: Record<string, number[]> }
  >()

  for (const run of runs) {
    const mentions = Array.isArray(run.brands_mentioned)
      ? run.brands_mentioned
      : []
    for (const m of mentions) {
      if (!m.brand) continue
      const key = m.brand.trim()
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

  // Merge brand name variants for the client (e.g. "CTS Tours" and
  // "CTS Tours - China Travel Service (NZ) Limited" → one canonical entry)
  if (clientBrandName) {
    mergeClientBrandVariants(byBrand, clientBrandName)
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

/**
 * Merge all brand-name variants of the client into a single canonical entry.
 * Variants are detected by substring inclusion (case-insensitive):
 *   "CTS Tours - China Travel Service (NZ) Limited" includes "CTS Tours"
 *   → both collapse into the canonical client brand name.
 */
function mergeClientBrandVariants(
  byBrand: Map<string, { mentions: number; rankSum: number; byEngine: Record<string, number[]> }>,
  clientBrandName: string
): void {
  const canon = clientBrandName.trim()
  const canonLower = canon.toLowerCase()

  let canonicalKey = ''
  const variantKeys: string[] = []

  for (const key of Array.from(byBrand.keys())) {
    const keyLower = key.toLowerCase().trim()
    if (keyLower === canonLower) {
      canonicalKey = key
    } else if (keyLower.includes(canonLower)) {
      // Only merge when the RAW CANDIDATE contains the canonical brand name
      // (e.g. "CTS Tours - China Travel Service NZ" contains "CTS Tours").
      // Deliberately NOT merging the reverse direction — that would absorb
      // short competitor names into a longer client name (e.g. "Magic" into
      // "Magic Engine"), corrupting competitor rankings in the snapshot.
      variantKeys.push(key)
    }
  }

  if (variantKeys.length === 0) return

  const canonEntry = (canonicalKey ? byBrand.get(canonicalKey) : undefined) ?? {
    mentions: 0,
    rankSum: 0,
    byEngine: {} as Record<string, number[]>,
  }

  for (const variantKey of variantKeys) {
    const variant = byBrand.get(variantKey)
    if (!variant) continue
    canonEntry.mentions += variant.mentions
    canonEntry.rankSum += variant.rankSum
    for (const [engine, ranks] of Object.entries(variant.byEngine)) {
      canonEntry.byEngine[engine] = [...(canonEntry.byEngine[engine] ?? []), ...ranks]
    }
    byBrand.delete(variantKey)
  }

  if (canonicalKey && canonicalKey !== canon) byBrand.delete(canonicalKey)
  byBrand.set(canon, canonEntry)
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
