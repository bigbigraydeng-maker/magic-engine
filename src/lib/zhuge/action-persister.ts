/**
 * 诸葛亮 Action Persister — P12.G.3 / P24.A.2
 *
 * After the conductor produces a ZhugeOutput, this module persists each
 * PriorityAction to:
 *   1. flywheel_actions  — 4 flywheel-mapped dimensions (seo/geo/ads/social)
 *   2. execution_items   — ALL 6 dimensions (P24.A: full execution kanban)
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
 * Reference: ROADMAP.md P12.G.3, P24.A
 */

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ZhugeOutput, PriorityAction, DiagnosticDimension } from './types'
import type { FlywheelName, ExecutionMode } from '@/lib/flywheel/adapters/types'
import { saveDecisionHistory } from '@/lib/memory/service'

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

export interface WriteExecutionItemsResult {
  /** Number of execution_items rows inserted in this call. */
  inserted: number
  /** Number of old zhuge items marked superseded. */
  superseded: number
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
 * Persists ZhugeOutput in three places:
 *
 * 1. `zhuge_sessions` — stores the FULL output (all 6 dimensions) so the
 *    ZhugePriorityWidget can restore after navigation. Uses upsert so a
 *    fresh conduct call always overwrites the previous session for the same
 *    (client, session_key) pair. Returns the row ID for execution_items FK.
 *
 * 2. `flywheel_actions` — inserts the 4 flywheel-mapped dimensions
 *    (seo / geo / ads / social) for the data flywheel pipeline. Idempotency
 *    guard prevents duplicates on repeated opens of the drawer.
 *
 * 3. `execution_items` — inserts ALL 6 dimensions so 诸葛亮 recommendations
 *    appear on the execution kanban (P24.A). Deduplication prevents
 *    overwriting FDE/luban items; old zhuge items are superseded.
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

  // ── 1. Upsert full output into zhuge_sessions (all dimensions) ──────────────
  let zhugeSessionId: string | null = null
  try {
    const { data: sessionRow, error: sessionError } = await supabase
      .from('zhuge_sessions')
      .upsert(
        {
          client_id:    input.clientId,
          session_key:  sessionKey,
          output:       input.output,
          generated_at: input.output.generated_at,
        },
        { onConflict: 'client_id,session_key' },
      )
      .select('id')
      .single()

    if (sessionError) {
      console.warn('[action-persister] zhuge_sessions upsert failed:', sessionError.message)
    } else {
      zhugeSessionId = (sessionRow as { id: string } | null)?.id ?? null

      // Phase 23.D: 异步写入 client_decision_history（非阻塞）
      if (zhugeSessionId && input.output.top_actions.length > 0) {
        void writeDecisionHistory(supabase, input.clientId, zhugeSessionId, input.output)
          .catch((err: unknown) =>
            console.warn('[action-persister] decision_history write failed:', err instanceof Error ? err.message : String(err))
          )
      }
    }
  } catch (err: unknown) {
    // Non-fatal: continue even if session upsert fails
    console.warn('[action-persister] zhuge_sessions upsert threw:', err instanceof Error ? err.message : String(err))
  }

  // ── 2. Idempotency check for flywheel_actions ───────────────────────────────
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
    // ── 3a. Execution items (idempotent path — still need to write items if new session) ──
    // Awaited (not fire-and-forget): on Render serverless the handler returns
    // immediately after this function resolves, killing any un-awaited promise
    // before the kanban rows are written. try/catch preserves the original
    // "execution_items failure must not break the main flow" intent.
    try {
      await writeExecutionItems(supabase, input.clientId, zhugeSessionId, input.output.top_actions)
    } catch (err: unknown) {
      console.warn('[action-persister] execution_items write failed (idempotent path):', err instanceof Error ? err.message : String(err))
    }
    return {
      inserted: 0,
      idempotent: true,
      action_ids: (existing as { id: string }[]).map((r) => r.id),
      session_key: sessionKey,
    }
  }

  // Filter to dimensions that map to a flywheel (reputation/competitor skipped here)
  const insertable = input.output.top_actions.filter(
    (a) => DIMENSION_TO_FLYWHEEL[a.dimension] !== undefined,
  )

  let ids: string[] = []

  if (insertable.length > 0) {
    const rows = insertable.map((action) => buildRow(action, input.clientId, sessionKey, input))

    const { data: inserted, error: insertError } = await supabase
      .from('flywheel_actions')
      .insert(rows)
      .select('id')

    if (insertError) {
      throw new Error(`DB error inserting flywheel_actions: ${insertError.message}`)
    }

    ids = (inserted as { id: string }[]).map((r) => r.id)
  }

  // ── 3b. Write to execution_items (all 6 dimensions) ─────────────────────────
  // Awaited (not fire-and-forget): on Render serverless an un-awaited promise is
  // killed when the cron handler returns, so the kanban rows would never land
  // (flywheel_actions, written synchronously above, survived — execution_items
  // did not). try/catch keeps an execution_items failure from breaking the main
  // flow now that flywheel_actions has already committed.
  try {
    await writeExecutionItems(supabase, input.clientId, zhugeSessionId, input.output.top_actions)
  } catch (err: unknown) {
    console.warn('[action-persister] execution_items write failed:', err instanceof Error ? err.message : String(err))
  }

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

// ── Execution-items helpers ────────────────────────────────────────────────────

const EXECUTION_MODE_TO_FIX_TYPE: Record<ExecutionMode, 'me_auto' | 'fde_manual' | 'third_party'> = {
  in_house:        'me_auto',
  third_party:     'third_party',
  external_manual: 'fde_manual',
}

/** Convert an ExecutionMode to the diagnostic_fix_type enum value. */
export function executionModeToFixType(mode: ExecutionMode): 'me_auto' | 'fde_manual' | 'third_party' {
  return EXECUTION_MODE_TO_FIX_TYPE[mode] ?? 'fde_manual'
}

/**
 * Convert a dot-namespaced action_type slug to a human-readable title.
 * e.g. 'seo.fix_meta_titles' → 'Fix Meta Titles'
 */
export function actionTypeToTitle(actionType: string): string {
  const slug = actionType.includes('.') ? actionType.split('.').pop()! : actionType
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── writeExecutionItems ────────────────────────────────────────────────────────

/**
 * Write PriorityActions to the execution_items kanban table (P24.A).
 *
 * Writes ALL dimensions (including reputation + competitor) unlike
 * flywheel_actions which skips those two.
 *
 * Deduplication logic:
 *   - Existing pending `source='fde'` or `source='luban'` row → skip (don't overwrite human work)
 *   - Existing pending `source='zhuge'` row (old session) → mark superseded, insert new
 *   - No existing pending row → insert new
 */
export async function writeExecutionItems(
  supabase: SupabaseClient,
  clientId: string,
  zhugeSessionId: string | null,
  actions: PriorityAction[],
): Promise<WriteExecutionItemsResult> {
  if (actions.length === 0) return { inserted: 0, superseded: 0 }

  const actionTypes = actions.map((a) => a.action_type)

  // Fetch any existing pending rows for these action types for this client
  const { data: existingRows, error: selectErr } = await supabase
    .from('execution_items')
    .select('id, action_type, source, zhuge_session_id')
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .in('action_type', actionTypes)

  if (selectErr) {
    throw new Error(`execution_items dedup check failed: ${selectErr.message}`)
  }

  type ExistingRow = { id: string; action_type: string; source: string; zhuge_session_id: string | null }
  const byActionType = new Map<string, ExistingRow>()
  for (const row of (existingRows as ExistingRow[] | null) ?? []) {
    byActionType.set(row.action_type, row)
  }

  const toSupersede: string[] = []
  const toInsert: PriorityAction[] = []

  for (const action of actions) {
    const existing = byActionType.get(action.action_type)
    if (!existing) {
      toInsert.push(action)
    } else if (existing.source === 'zhuge') {
      // Old zhuge item from a different session: supersede it, insert fresh
      toSupersede.push(existing.id)
      toInsert.push(action)
    }
    // else fde/luban pending: leave it alone
  }

  if (toSupersede.length > 0) {
    const { error: updateErr } = await supabase
      .from('execution_items')
      .update({ status: 'superseded' })
      .in('id', toSupersede)

    if (updateErr) {
      throw new Error(`execution_items supersede failed: ${updateErr.message}`)
    }
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((action) => ({
      prescription_id:  null,
      client_id:        clientId,
      finding_id:       null,
      dimension:        action.dimension,
      title:            actionTypeToTitle(action.action_type),
      description:      action.why_now,
      fix_type:         executionModeToFixType(action.execution_mode),
      action_type:      action.action_type,
      status:           'pending',
      source:           'zhuge',
      zhuge_session_id: zhugeSessionId,
      sort_order:       action.rank,
      // Carry action-type-specific metadata (e.g. SEO patrol's real keyword)
      // so the Content Workbench can pre-fill domain fields without re-parsing
      // the description. null when the producer didn't supply metadata.
      steps_json:       action.metadata ?? null,
    }))

    const { error: insertErr } = await supabase
      .from('execution_items')
      .insert(rows)

    if (insertErr) {
      throw new Error(`execution_items insert failed: ${insertErr.message}`)
    }
  }

  return { inserted: toInsert.length, superseded: toSupersede.length }
}

// ── Decision history (Phase 23.D) ─────────────────────────────────────────────

/**
 * 将诸葛亮本次输出的 top_action 写入 client_decision_history。
 * 每个 action 生成一条记录，alternatives_rejected = 同次会话中排名更低的其他 action_type。
 * 全程非阻塞，失败只警告不抛出。
 */
async function writeDecisionHistory(
  supabase: SupabaseClient,
  clientId: string,
  zhugeSessionId: string,
  output: ZhugeOutput,
): Promise<void> {
  const sorted = [...output.top_actions].sort((a, b) => a.rank - b.rank)
  const allActionTypes = sorted.map((a) => a.action_type)

  for (const action of sorted) {
    const alternatives = allActionTypes.filter((t) => t !== action.action_type)
    const context = `rank=${action.rank}, dimension=${action.dimension}, impact=${action.expected_impact}, effort=${action.effort}`

    await saveDecisionHistory(supabase, {
      client_id: clientId,
      zhuge_session_id: zhugeSessionId,
      decision_context: context,
      chosen_action: action.action_type,
      alternatives_rejected: alternatives,
      reasoning: action.why_now,
    })
  }
}
