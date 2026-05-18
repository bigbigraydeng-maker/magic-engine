/**
 * Synthesis persistence — P8.10.S3.5
 *
 * Thin upsert helpers that write Synthesis-layer outputs into the
 * `diagnostic_narratives` table. One helper per synthesis module so the Report
 * Composer (P8.10.S4) can decide which sections to persist on a given run.
 *
 * Rows are keyed by (run_id, kind, dimension) and upserted via
 * `onConflict='run_id,kind,dimension'`. `dimension` is NULL for `market_context`
 * — the SQL migration uses a `COALESCE(dimension, '')` unique index so the
 * NULL case still dedupes cleanly.
 *
 * Errors are caught and logged but NEVER re-thrown (CLAUDE.md convention for
 * Synthesis writes — they are opt-in, must not block the diagnostic). The
 * helpers return `{ ok, error? }` so callers can surface partial-failure UX.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { CompetitorAnalystResult } from './competitor-analyst'
import type { DimensionNarrativeResult } from './dimension-narrator'
import type { MarketContextResult } from './market-context'
import type { ScoreExplainerResult } from './score-explainer'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NarrativeKind =
  | 'competitor_market_structure'
  | 'competitor_benchmarking_path'
  | 'dimension_narrative'
  | 'score_explanation'
  | 'market_context'

export interface NarrativeRow {
  id: string
  run_id: string
  client_id: string
  kind: NarrativeKind
  dimension: string | null
  narrative_md: string
  metadata: Record<string, unknown> | null
  /** Extracted from metadata.evidence_refs on load. Empty array when absent. */
  evidence_refs: string[]
  model: string
  cost_usd: number
  generated_at: string
  created_at: string
}

export interface PersistResult {
  ok: boolean
  /** Number of narrative rows written for this call (0 on failure). */
  rows_written: number
  error?: string
}

interface PersistContext {
  runId: string
  clientId: string
}

interface InsertableRow {
  run_id: string
  client_id: string
  kind: NarrativeKind
  dimension: string | null
  narrative_md: string
  metadata: Record<string, unknown> | null
  model: string
  cost_usd: number
  generated_at: string
}

const TABLE = 'diagnostic_narratives'
const ON_CONFLICT = 'run_id,kind,dimension'

// ---------------------------------------------------------------------------
// Save helpers — one per synthesis module
// ---------------------------------------------------------------------------

export async function saveCompetitorAnalysis(
  supabase: SupabaseClient,
  ctx: PersistContext,
  result: CompetitorAnalystResult,
): Promise<PersistResult> {
  const rows: InsertableRow[] = [
    {
      run_id: ctx.runId,
      client_id: ctx.clientId,
      kind: 'competitor_market_structure',
      dimension: 'competitor',
      narrative_md: result.market_structure_md,
      metadata: { evidence_refs: result.evidence_refs },
      model: result.model_used,
      cost_usd: result.cost_usd,
      generated_at: result.generated_at,
    },
    {
      run_id: ctx.runId,
      client_id: ctx.clientId,
      kind: 'competitor_benchmarking_path',
      dimension: 'competitor',
      narrative_md: result.benchmarking_path_md,
      metadata: { evidence_refs: result.evidence_refs },
      model: result.model_used,
      cost_usd: result.cost_usd,
      generated_at: result.generated_at,
    },
  ]
  return upsertRows(supabase, rows)
}

export async function saveDimensionNarrative(
  supabase: SupabaseClient,
  ctx: PersistContext,
  result: DimensionNarrativeResult,
): Promise<PersistResult> {
  const row: InsertableRow = {
    run_id: ctx.runId,
    client_id: ctx.clientId,
    kind: 'dimension_narrative',
    dimension: result.dimension,
    narrative_md: result.narrative_md,
    metadata: { evidence_refs: result.evidence_refs },
    model: result.model_used,
    cost_usd: result.cost_usd,
    generated_at: result.generated_at,
  }
  return upsertRows(supabase, [row])
}

export async function saveDimensionNarratives(
  supabase: SupabaseClient,
  ctx: PersistContext,
  results: DimensionNarrativeResult[],
): Promise<PersistResult> {
  if (results.length === 0) return { ok: true, rows_written: 0 }
  const rows: InsertableRow[] = results.map(r => ({
    run_id: ctx.runId,
    client_id: ctx.clientId,
    kind: 'dimension_narrative',
    dimension: r.dimension,
    narrative_md: r.narrative_md,
    metadata: { evidence_refs: r.evidence_refs },
    model: r.model_used,
    cost_usd: r.cost_usd,
    generated_at: r.generated_at,
  }))
  return upsertRows(supabase, rows)
}

export async function saveScoreExplanations(
  supabase: SupabaseClient,
  ctx: PersistContext,
  result: ScoreExplainerResult,
): Promise<PersistResult> {
  if (result.explanations.length === 0) return { ok: true, rows_written: 0 }

  // Cost is reported once for the whole call; attribute it to the 'overall'
  // row so per-dimension rows don't double-count when summed.
  const rows: InsertableRow[] = result.explanations.map(exp => ({
    run_id: ctx.runId,
    client_id: ctx.clientId,
    kind: 'score_explanation',
    dimension: exp.target,
    narrative_md: exp.explanation_md,
    metadata: { score: exp.score, evidence_refs: exp.evidence_refs },
    model: result.model_used,
    cost_usd: exp.target === 'overall' ? result.cost_usd : 0,
    generated_at: result.generated_at,
  }))
  return upsertRows(supabase, rows)
}

export async function saveMarketContext(
  supabase: SupabaseClient,
  ctx: PersistContext,
  result: MarketContextResult,
): Promise<PersistResult> {
  const narrative = [
    result.industry_overview_md,
    result.category_benchmarks_md,
    result.opportunities_md,
  ]
    .filter(s => s && s.trim().length > 0)
    .join('\n\n')

  const row: InsertableRow = {
    run_id: ctx.runId,
    client_id: ctx.clientId,
    kind: 'market_context',
    dimension: null,
    narrative_md: narrative,
    metadata: {
      industry_overview_md: result.industry_overview_md,
      category_benchmarks_md: result.category_benchmarks_md,
      opportunities_md: result.opportunities_md,
      key_trends: result.key_trends,
      citations: result.citations,
      web_search_calls: result.web_search_calls,
      evidence_refs: result.evidence_refs,
    },
    model: result.model_used,
    cost_usd: result.cost_usd,
    generated_at: result.generated_at,
  }
  return upsertRows(supabase, [row])
}

// ---------------------------------------------------------------------------
// Load helper — for the Report Composer / debugging UI
// ---------------------------------------------------------------------------

export async function loadNarrativesForRun(
  supabase: SupabaseClient,
  runId: string,
): Promise<NarrativeRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('run_id', runId)
    .order('kind', { ascending: true })
    .order('dimension', { ascending: true, nullsFirst: true })

  if (error) {
    console.warn('[synthesis-persistence] loadNarrativesForRun failed:', error.message)
    return []
  }
  return (data ?? []).map(row => {
    const r = row as Omit<NarrativeRow, 'evidence_refs'>
    const refs = (r.metadata as Record<string, unknown> | null)?.evidence_refs
    return {
      ...r,
      evidence_refs: Array.isArray(refs) ? (refs as string[]) : [],
    } satisfies NarrativeRow
  })
}

// ---------------------------------------------------------------------------
// Internal — upsert with shared error swallowing
// ---------------------------------------------------------------------------

async function upsertRows(
  supabase: SupabaseClient,
  rows: InsertableRow[],
): Promise<PersistResult> {
  if (rows.length === 0) return { ok: true, rows_written: 0 }

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: ON_CONFLICT })

    if (error) {
      console.warn('[synthesis-persistence] upsert failed:', error.message)
      return { ok: false, rows_written: 0, error: error.message }
    }
    return { ok: true, rows_written: rows.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[synthesis-persistence] upsert threw:', message)
    return { ok: false, rows_written: 0, error: message }
  }
}
