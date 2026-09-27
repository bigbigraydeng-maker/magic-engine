/**
 * Reads for the memory extractor (Phase 23.C · 1b).
 *
 * Everything is paginated: PostgREST returns at most 1000 rows without an error, and a
 * truncated read here is not "a few rows short" — a memory whose action or outcome was
 * cut off would be judged on missing evidence and switched off.
 *
 * Actions are read by `client_id`, never by `.in('id', …)`: a few hundred ids make the
 * request URL too long and PostgREST rejects it with an opaque 400, which would stop the
 * whole client's run.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { DerivedMemoryTable } from './service'
import type { FlywheelName } from './types'

/** One flywheel_outcomes row, any verdict, any age. */
export interface OutcomeRow {
  id: string
  client_id: string
  action_id: string
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number | null
  verdict: 'confirmed' | 'inconclusive' | 'reversed'
  computed_at: string
  window_days: number | null
}

/** One flywheel_actions row with the two payload keys the execution rule reads. */
export interface ActionRow {
  id: string
  action_type: string
  flywheel: FlywheelName
  vendor: string | null
  executed_at: string
  expected_metric: string | null
  execution_item_id: string | null
  action_run_id: string | null
  zhuge_session_key: string | null
  payload_source: string | null
}

/** A derived memory row, as far as reconciliation cares. */
export interface DerivedMemoryRow {
  id: string
  source_id: string | null
  source_action_id: string | null
  is_active: boolean
  created_at: string
  /** The row's own pillar column (proven: flywheel; failed: dimension, ai_visibility → geo). */
  pillar_column: string | null
}

export interface ClientEvidence {
  outcomes: OutcomeRow[]
  actions: ActionRow[]
}

type LooseRow = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export async function loadClientEvidence(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientEvidence> {
  const outcomes = await fetchAll<OutcomeRow>((from, to) =>
    supabase
      .from('flywheel_outcomes')
      .select('id, client_id, action_id, metric_key, delta, delta_pct, confidence, verdict, computed_at, window_days')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )

  const rawActions = await fetchAll<LooseRow>((from, to) =>
    supabase
      .from('flywheel_actions')
      .select(
        'id, action_type, flywheel, vendor, executed_at, expected_metric, execution_item_id, action_run_id, ' +
          // Only the two payload keys the execution rule needs — not the whole payload.
          'zhuge_session_key:payload->>zhuge_session_key, payload_source:payload->>source',
      )
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to)
      // The select-string type parser cannot read `->>` aliases; the rows are mapped below.
      .overrideTypes<LooseRow[], { merge: false }>(),
  )

  const actions: ActionRow[] = rawActions.map((a) => ({
    id: String(a.id),
    action_type: String(a.action_type ?? ''),
    flywheel: a.flywheel as FlywheelName,
    vendor: str(a.vendor),
    executed_at: String(a.executed_at ?? ''),
    expected_metric: str(a.expected_metric),
    execution_item_id: str(a.execution_item_id),
    action_run_id: str(a.action_run_id),
    zhuge_session_key: str(a.zhuge_session_key),
    payload_source: str(a.payload_source),
  }))

  return { outcomes, actions }
}

/**
 * Every row of one derived memory table for this client, active or not.
 *
 * Inactive rows must come back too: when a verdict flips back, the old row is reopened
 * instead of a duplicate being written. The two tables have different pillar columns —
 * proven patterns carry `flywheel`, failed experiments only `dimension` — so each is read
 * with its own column list; a shared list would fail on the table without that column.
 */
export async function loadDerivedMemory(
  supabase: SupabaseClient,
  clientId: string,
  table: DerivedMemoryTable,
): Promise<DerivedMemoryRow[]> {
  const pillarColumn = table === 'client_proven_patterns' ? 'flywheel' : 'dimension'
  let rows: LooseRow[]
  try {
    rows = await fetchAll<LooseRow>((from, to) =>
      supabase
        .from(table)
        .select(`id, source_id, source_action_id, is_active, created_at, ${pillarColumn}`)
        .eq('client_id', clientId)
        .eq('source_table', 'flywheel_outcomes')
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (err) {
    throw new Error(`${table}: ${err instanceof Error ? err.message : String(err)}`)
  }

  return rows.map((r) => ({
    id: String(r.id),
    source_id: str(r.source_id),
    source_action_id: str(r.source_action_id),
    is_active: r.is_active === true,
    created_at: String(r.created_at ?? ''),
    pillar_column: pillarFromColumn(r[pillarColumn]),
  }))
}

/** failed_experiments.dimension says `ai_visibility` where flywheels say `geo`. */
function pillarFromColumn(value: unknown): string | null {
  const v = str(value)
  return v === 'ai_visibility' ? 'geo' : v
}

/**
 * Clients the batch run must visit: every client with an outcome, plus every client that
 * still has an active derived memory. A client whose outcomes were all deleted would
 * otherwise keep its memories forever, because nothing would ever look at them again.
 */
export async function loadExtractorClientIds(supabase: SupabaseClient): Promise<string[]> {
  const [outcomes, proven, failed, prefs] = await Promise.all([
    fetchAll<LooseRow>((from, to) =>
      supabase.from('flywheel_outcomes').select('client_id').order('id', { ascending: true }).range(from, to),
    ),
    fetchAll<LooseRow>((from, to) =>
      supabase
        .from('client_proven_patterns')
        .select('client_id')
        .eq('source_table', 'flywheel_outcomes')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<LooseRow>((from, to) =>
      supabase
        .from('client_failed_experiments')
        .select('client_id')
        .eq('source_table', 'flywheel_outcomes')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<LooseRow>((from, to) =>
      supabase
        .from('client_learned_preferences')
        .select('client_id')
        .eq('source', 'auto_extracted')
        .eq('extracted_from_table', 'flywheel_outcomes')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])

  const ids = new Set<string>()
  for (const r of [...outcomes, ...proven, ...failed, ...prefs]) {
    const id = str(r.client_id)
    if (id) ids.add(id)
  }
  return Array.from(ids).sort()
}
