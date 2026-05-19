/**
 * 诸葛亮 Action Persister — P12.G.3
 *
 * After the conductor produces a ZhugeOutput, this module persists each
 * PriorityAction to flywheel_actions with idempotency protection.
 *
 * Idempotency: a 16-char session key derived from (client_id, discovery_id,
 * diagnostic_run_id) is stored in payload->>'zhuge_session_key'.
 * A second call with the same inputs returns the existing rows without
 * inserting duplicates.
 *
 * Dimension → flywheel mapping (mirrors package-publish.ts and the
 * flywheel_data_skeleton migration):
 *   seo           → seo
 *   ai_visibility → geo
 *   ads           → ads
 *   social        → social
 *   reputation    → skip  (external_manual, no flywheel ingest)
 *   competitor    → skip  (external_manual, no flywheel ingest)
 *
 * Reference: ROADMAP.md P12.G.3
 */

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ZhugeOutput, PriorityAction, DiagnosticDimension } from './types'
import type { FlywheelName, ExecutionMode } from '@/lib/flywheel/adapters/types'

// ── Dimension mappings ────────────────────────────────────────────────────────

const DIMENSION_TO_FLYWHEEL: Partial<Record<DiagnosticDimension, FlywheelName>> = {
  seo: 'seo',
  ai_visibility: 'geo',
  ads: 'ads',
  social: 'social',
  // reputation + competitor: external_manual, no flywheel ingest
}

const DIMENSION_TO_METRIC: Partial<Record<DiagnosticDimension, string>> = {
  seo: 'seo.domain.organic_traffic',
  ai_visibility: 'geo.query.mention_rate',
  ads: 'ads.account.roas',
  social: 'social.posts.published_count',
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface PersistZhugeActionsInput {
  clientId: string
  discoveryId: string
  diagnosticRunId: string | null
  output: ZhugeOutput
}

export interface PersistZhugeActionsResult {
  /** Number of rows actually inserted (0 = idempotent hit or no mappable actions). */
  inserted: number
  /** True when a previous call already persisted these actions. */
  idempotent: boolean
  /** IDs of all flywheel_action rows for this session (existing or newly created). */
  action_ids: string[]
  /** Stable 16-char hex key used for idempotency. */
  session_key: string
}

// ── Session key ───────────────────────────────────────────────────────────────

/**
 * Derives a stable 16-char hex session key from the three inputs that
 * uniquely identify a conductor call.
 */
export function buildSessionKey(
  clientId: string,
  discoveryId: string,
  diagnosticRunId: string | null,
): string {
  return createHash('sha256')
    .update(`${clientId}|${discoveryId}|${diagnosticRunId ?? 'null'}`)
    .digest('hex')
    .slice(0, 16)
}

// ── Persister ─────────────────────────────────────────────────────────────────

/**
 * Persists ZhugeOutput.top_actions to flywheel_actions.
 *
 * Returns immediately without inserting if an identical session key already
 * exists in flywheel_actions (idempotency guard).
 */
export async function persistZhugeActions(
  supabase: SupabaseClient,
  input: PersistZhugeActionsInput,
): Promise<PersistZhugeActionsResult> {
  const sessionKey = buildSessionKey(
    input.clientId,
    input.discoveryId,
    input.diagnosticRunId,
  )

  // Idempotency check — did we already persist actions for this conductor run?
  const { data: existing, error: checkError } = await supabase
    .from('flywheel_actions')
    .select('id')
    .eq('client_id', input.clientId)
    .eq('payload->>zhuge_session_key', sessionKey)
    .limit(20)

  if (checkError) {
    throw new Error(`DB error checking idempotency: ${checkError.message}`)
  }

  if (existing && existing.length > 0) {
    return {
      inserted: 0,
      idempotent: true,
      action_ids: (existing as { id: string }[]).map((r) => r.id),
      session_key: sessionKey,
    }
  }

  // Filter to dimensions that map to a flywheel
  const insertable = input.output.top_actions.filter(
    (a) => DIMENSION_TO_FLYWHEEL[a.dimension] !== undefined,
  )

  if (insertable.length === 0) {
    return { inserted: 0, idempotent: false, action_ids: [], session_key: sessionKey }
  }

  const rows = insertable.map((action) => buildRow(action, input.clientId, sessionKey, input))

  const { data: inserted, error: insertError } = await supabase
    .from('flywheel_actions')
    .insert(rows)
    .select('id')

  if (insertError) {
    throw new Error(`DB error inserting flywheel_actions: ${insertError.message}`)
  }

  const ids = (inserted as { id: string }[]).map((r) => r.id)

  return {
    inserted: ids.length,
    idempotent: false,
    action_ids: ids,
    session_key: sessionKey,
  }
}

// ── Row builder ───────────────────────────────────────────────────────────────

function buildRow(
  action: PriorityAction,
  clientId: string,
  sessionKey: string,
  input: PersistZhugeActionsInput,
) {
  return {
    client_id: clientId,
    execution_item_id: null as string | null,
    flywheel: DIMENSION_TO_FLYWHEEL[action.dimension]!,
    action_type: action.action_type,
    execution_mode: action.execution_mode as ExecutionMode,
    vendor: null as string | null,
    payload: {
      zhuge_session_key: sessionKey,
      rank: action.rank,
      why_now: action.why_now,
      evidence_refs: action.evidence_refs,
      expected_impact: action.expected_impact,
      effort: action.effort,
      executable_by: action.executable_by,
      discovery_id: input.discoveryId,
      diagnostic_run_id: input.diagnosticRunId,
    },
    expected_metric: DIMENSION_TO_METRIC[action.dimension] ?? null,
    expected_delta: null as number | null,
    executed_at: input.output.generated_at,
  }
}
