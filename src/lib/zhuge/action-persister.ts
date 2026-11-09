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
import { assertAdsExpectedMetric } from '@/lib/flywheel/metric-registry'
import { resolveClientAdsExpectedMetric } from '@/lib/flywheel/ads-expected-metric'
import { canonicalUrl } from '@/lib/url/canonical-url'
import { isKnownActionType } from './action-vocabulary'

// ── Dimension mappings ────────────────────────────────────────────────────────

const DIMENSION_TO_FLYWHEEL: Partial<Record<DiagnosticDimension, FlywheelName>> = {
  seo: 'seo',
  ai_visibility: 'geo',
  ads: 'ads',
  social: 'social',
  // reputation + competitor: external_manual, no flywheel ingest
}

// `ads` is deliberately absent: it has no fixed answer. Which metric an ads
// action is judged on depends on what the client's campaigns actually produce,
// so it is resolved per client by resolveClientAdsExpectedMetric().
const DIMENSION_TO_METRIC: Partial<Record<DiagnosticDimension, string>> = {
  seo: 'seo.domain.organic_traffic',
  ai_visibility: 'geo.query.mention_rate',
  social: 'social.posts.published_count',
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface PersistZhugeActionsInput {
  clientId: string
  discoveryId: string
  diagnosticRunId: string | null
  /**
   * DAPE W5 (spec §2.4.3): when known, link new execution_items rows to the
   * prescription that birthed this conduct call so Kanban prescription filter
   * + outcome 回流 can survive. NULL = no active prescription yet (the column
   * stays NULL, still legal per the relaxed source_consistency constraint).
   */
  prescriptionId?: string | null
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
  /** Number of actions dropped because action_type is not in the registered vocabulary. */
  rejected_unknown_action_type: number
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
      await writeExecutionItems(
        supabase,
        input.clientId,
        zhugeSessionId,
        input.output.top_actions,
        input.prescriptionId ?? null,
      )
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
    // Ads actions get the metric this client is actually measured on, resolved
    // once for the batch. The old hard-coded `ads.account.roas` was a promise
    // no Messenger / lead-gen client could ever redeem, so every ads action
    // written here was unattributable from birth.
    const adsExpectedMetric = insertable.some((a) => DIMENSION_TO_FLYWHEEL[a.dimension] === 'ads')
      ? await resolveClientAdsExpectedMetric(supabase, input.clientId)
      : null
    assertAdsExpectedMetric(adsExpectedMetric, 'persistZhugeActions')

    const rows = insertable.map((action) =>
      buildRow(action, input.clientId, sessionKey, input, adsExpectedMetric),
    )

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
    await writeExecutionItems(
      supabase,
      input.clientId,
      zhugeSessionId,
      input.output.top_actions,
      input.prescriptionId ?? null,
    )
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
  /** Client-resolved ads metric; ignored for non-ads dimensions. */
  adsExpectedMetric: string | null,
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
    expected_metric: action.dimension === 'ads'
      ? adsExpectedMetric
      : DIMENSION_TO_METRIC[action.dimension] ?? null,
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

/**
 * Identity key of one kanban card for dedup/supersede purposes.
 *
 * action_type alone is NOT unique: the SEO patrol legitimately emits several
 * cards of the same action_type for different keywords (e.g. two
 * seo.refresh_blog cards for two dropped keywords), so the keyword carried in
 * metadata/steps_json is part of the identity. Actions without a keyword fall
 * back to action_type-only, preserving the original behaviour for
 * conduct-sourced actions.
 *
 * When the card also carries a page URL (`url` or `page_url`), the canonical URL
 * is part of the identity too: the patrol's "not indexed" / "missing internal
 * link" cards have a URL but no keyword, and without it two cards for different
 * pages collided — only one survived a batch and they superseded each other day
 * after day. Cards without a URL (ads, GEO, social, conduct) keep the old key.
 */
export function executionItemDedupKey(actionType: string, keyword: unknown, url?: unknown): string {
  const kw =
    typeof keyword === 'string' && keyword.trim().length > 0
      ? keyword.trim().toLowerCase()
      : ''
  const page = typeof url === 'string' && url.trim().length > 0 ? canonicalUrl(url.trim()) : null
  return page ? `${actionType}::${page}::${kw}` : `${actionType}::${kw}`
}

// ── writeExecutionItems ────────────────────────────────────────────────────────

/**
 * Write PriorityActions to the execution_items kanban table (P24.A).
 *
 * Writes ALL dimensions (including reputation + competitor) unlike
 * flywheel_actions which skips those two.
 *
 * Deduplication logic — keyed by (action_type, canonical page URL when present, keyword) via executionItemDedupKey,
 * NOT action_type alone (the patrol emits several cards of one action_type for
 * different keywords; keying on action_type alone let duplicates of the same
 * keyword accumulate +1 per run — Sungenix/IB 2026-08-01 incident):
 *   - Any existing pending `source='fde'`/`'luban'` row with the same key → skip (don't overwrite human work)
 *   - Existing pending `source='zhuge'` rows with the same key → mark ALL superseded, insert new
 *   - Duplicate key within the same batch → insert only the first
 *   - No existing pending row → insert new
 *
 * DAPE W5 (spec §2.4.3): `prescriptionId` (when non-null) lands in the new
 * execution_items.prescription_id column, restoring the P→E attribution link
 * for zhuge-sourced kanban cards. Passing null is still valid — the relaxed
 * source_consistency constraint allows it for source='zhuge'.
 */
export async function writeExecutionItems(
  supabase: SupabaseClient,
  clientId: string,
  zhugeSessionId: string | null,
  actions: PriorityAction[],
  prescriptionId: string | null = null,
): Promise<WriteExecutionItemsResult> {
  if (actions.length === 0) {
    return { inserted: 0, superseded: 0, rejected_unknown_action_type: 0 }
  }

  // 不认识的 action_type 不进待办：LLM 临场编的 slug（例如
  // `launch_google_search_ads_3pl`）没有执行器，写进 execution_items 只会
  // 卡在 pending 空转。词汇表的权威来源在 action-vocabulary.ts。
  const knownActions: PriorityAction[] = []
  const unknownActionTypes: string[] = []
  for (const action of actions) {
    if (isKnownActionType(action.action_type)) {
      knownActions.push(action)
    } else {
      unknownActionTypes.push(action.action_type)
    }
  }
  if (unknownActionTypes.length > 0) {
    console.warn(
      `[action-persister] 丢弃 ${unknownActionTypes.length} 个未登记的 action_type（client=${clientId}, session=${zhugeSessionId ?? 'none'}）: ${unknownActionTypes.join(', ')}`,
    )
  }
  if (knownActions.length === 0) {
    return {
      inserted: 0,
      superseded: 0,
      rejected_unknown_action_type: unknownActionTypes.length,
    }
  }

  const actionTypes = knownActions.map((a) => a.action_type)

  // Fetch any existing pending rows for these action types for this client.
  // steps_json is needed to rebuild each row's dedup key (keyword lives there).
  const { data: existingRows, error: selectErr } = await supabase
    .from('execution_items')
    .select('id, action_type, source, zhuge_session_id, steps_json')
    .eq('client_id', clientId)
    .eq('status', 'pending')
    .in('action_type', actionTypes)

  if (selectErr) {
    throw new Error(`execution_items dedup check failed: ${selectErr.message}`)
  }

  type ExistingRow = {
    id: string
    action_type: string
    source: string
    zhuge_session_id: string | null
    steps_json: Record<string, unknown> | null
  }
  // Group (not overwrite) by key: multiple old rows may share one key — e.g.
  // duplicates accumulated before this dedup existed — and ALL of them must
  // be superseded, not just whichever the Map kept last.
  const byDedupKey = new Map<string, ExistingRow[]>()
  for (const row of (existingRows as ExistingRow[] | null) ?? []) {
    const key = executionItemDedupKey(row.action_type, row.steps_json?.keyword, row.steps_json?.url ?? row.steps_json?.page_url)
    const group = byDedupKey.get(key)
    if (group) group.push(row)
    else byDedupKey.set(key, [row])
  }

  const toSupersede: string[] = []
  const toInsert: PriorityAction[] = []
  const batchKeys = new Set<string>()

  for (const action of knownActions) {
    const key = executionItemDedupKey(action.action_type, action.metadata?.keyword, action.metadata?.url ?? action.metadata?.page_url)
    // Same finding appearing twice in one batch: insert only the first
    if (batchKeys.has(key)) continue
    batchKeys.add(key)

    const existing = byDedupKey.get(key) ?? []
    if (existing.some((r) => r.source !== 'zhuge')) {
      // fde/luban pending owns this card: leave it alone
      continue
    }
    // Old zhuge items from prior sessions: supersede them all, insert fresh
    toSupersede.push(...existing.map((r) => r.id))
    toInsert.push(action)
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
      // DAPE W5 (spec §2.4.3): link zhuge-sourced items back to the prescription
      // that birthed this conduct call. NULL when no active prescription yet —
      // valid post-migration 20260628000001.
      prescription_id:  prescriptionId,
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

  return {
    inserted: toInsert.length,
    superseded: toSupersede.length,
    rejected_unknown_action_type: unknownActionTypes.length,
  }
}

// ── SEO weekly list items (docs/specs/2026-10-04-seo-weekly-list-v0.2.md) ───────
//
// The weekly list writes its items HERE (not in a new file) because this file is
// already on the Kernel architecture test's grandfathered execution_items writer
// list, which may only shrink. These items are `source='zhuge'` with
// `steps_json.loop` set; that marker is what keeps them out of the 14-day
// auto-expiry (card-expiry.ts) and the patrol's weekly card cap
// (seo-patrol/job.ts counts only cards carrying a string `rule_id`).

export const SEO_PLAN_LOOP = 'seo_goal_v1'

export interface SeoPlanItemInsert {
  actionType: string
  title: string
  description: string
  keyword: string | null
  url: string | null
  dueDate: string
  stepsJson: Record<string, unknown>
  initiativeId: string | null
}

/**
 * Insert weekly-list items. An item whose dedup key matches a still-open list item
 * (pending / in_progress) is skipped — never superseded: last week's item stays and
 * keeps its clock. Returns how many were inserted and how many were duplicates.
 */
export async function writeSeoPlanItems(
  supabase: SupabaseClient,
  clientId: string,
  items: SeoPlanItemInsert[],
): Promise<{ inserted: number; duplicates: number; ids: string[] }> {
  if (items.length === 0) return { inserted: 0, duplicates: 0, ids: [] }

  const { data: open, error: selErr } = await supabase
    .from('execution_items')
    .select('action_type, steps_json')
    .eq('client_id', clientId)
    .eq('dimension', 'seo')
    .in('status', ['pending', 'in_progress'])
    .in('action_type', Array.from(new Set(items.map((i) => i.actionType))))
  if (selErr) throw new Error(`seo plan items dedup check failed: ${selErr.message}`)

  const openKeys = new Set<string>()
  for (const row of (open as Array<{ action_type: string; steps_json: Record<string, unknown> | null }> | null) ?? []) {
    if (row.steps_json?.loop !== SEO_PLAN_LOOP) continue
    openKeys.add(executionItemDedupKey(row.action_type, row.steps_json.keyword, row.steps_json.url))
  }

  const fresh: SeoPlanItemInsert[] = []
  const batch = new Set<string>()
  let duplicates = 0
  for (const item of items) {
    const key = executionItemDedupKey(item.actionType, item.keyword, item.url)
    if (openKeys.has(key) || batch.has(key)) {
      duplicates += 1
      continue
    }
    batch.add(key)
    fresh.push(item)
  }
  if (fresh.length === 0) return { inserted: 0, duplicates, ids: [] }

  const rows = fresh.map((item, idx) => ({
    prescription_id: null,
    client_id: clientId,
    finding_id: null,
    dimension: 'seo',
    title: item.title,
    description: item.description,
    fix_type: 'fde_manual',
    action_type: item.actionType,
    status: 'pending',
    source: 'zhuge',
    zhuge_session_id: null,
    sort_order: idx + 1,
    due_date: item.dueDate,
    initiative_id: item.initiativeId,
    steps_json: { ...item.stepsJson, loop: SEO_PLAN_LOOP },
  }))
  const { data: inserted, error: insErr } = await supabase.from('execution_items').insert(rows).select('id')
  if (insErr) throw new Error(`seo plan items insert failed: ${insErr.message}`)
  const ids = ((inserted as Array<{ id: string }> | null) ?? []).map((r) => r.id)
  const lost = await resolveSeoPlanDuplicateRace(supabase, clientId, ids)
  return { inserted: ids.length - lost.length, duplicates: duplicates + lost.length, ids: ids.filter((id) => !lost.includes(id)) }
}

/**
 * Two overlapping runs (scheduled + manual) can both pass the "is it already open?" read.
 * There is no unique index to stop that, so after inserting we re-read: for each key with
 * more than one open list item, the smallest id wins and every other one inserted by THIS
 * call is skipped (with an audit row). Both racing runs reach the same verdict.
 */
export async function resolveSeoPlanDuplicateRace(
  supabase: SupabaseClient,
  clientId: string,
  myIds: string[],
): Promise<string[]> {
  if (myIds.length === 0) return []
  const { data, error } = await supabase
    .from('execution_items')
    .select('id, action_type, steps_json')
    .eq('client_id', clientId)
    .eq('dimension', 'seo')
    .eq('source', 'zhuge')
    .in('status', ['pending', 'in_progress'])
  if (error) throw new Error(`seo plan duplicate-race check failed: ${error.message}`)
  const rows = ((data as Array<{ id: string; action_type: string; steps_json: Record<string, unknown> | null }> | null) ?? [])
    .filter((r) => r.steps_json?.loop === SEO_PLAN_LOOP)
  const byKey = new Map<string, string[]>()
  for (const r of rows) {
    const key = executionItemDedupKey(r.action_type, r.steps_json?.keyword, r.steps_json?.url)
    byKey.set(key, [...(byKey.get(key) ?? []), r.id])
  }
  const lost: string[] = []
  for (const ids of Array.from(byKey.values())) {
    if (ids.length < 2) continue
    const winner = [...ids].sort()[0]
    for (const id of ids) if (id !== winner && myIds.includes(id)) lost.push(id)
  }
  for (const id of lost) {
    await transitionSeoPlanItem(supabase, {
      id, clientId, to: 'skipped', reason: 'duplicate_race（两次运行同时写入同一事项，保留较早的一条）',
      stepsJson: { ...(rows.find((r) => r.id === id)?.steps_json ?? {}), skip_reason: 'duplicate_race' },
    })
  }
  return lost
}

export interface SeoPlanItemTransition {
  id: string
  clientId: string
  to: 'completed' | 'skipped'
  /** Human-readable reason, also stored as steps_json.skip_reason / verified evidence. */
  reason: string
  /** Full steps_json to persist (caller merges verify/skip fields into the current one). */
  stepsJson: Record<string, unknown>
  now?: Date
}

/**
 * Close a list item (verified-complete, or skipped as expired). The audit row is
 * written FIRST and the status flips only if that insert succeeded, so a card can
 * never show "completed" without a receipt. execution_logs.author is constrained to
 * system / luban / fde — this uses 'system'. Returns false (and logs a correction) when the
 * card was no longer open, so callers must not count it as verified / expired.
 */
export async function transitionSeoPlanItem(
  supabase: SupabaseClient,
  t: SeoPlanItemTransition,
): Promise<boolean> {
  const now = (t.now ?? new Date()).toISOString()
  const { error: logErr } = await supabase.from('execution_logs').insert({
    execution_item_id: t.id,
    client_id: t.clientId,
    author: 'system',
    kind: 'status_change',
    content: t.to === 'completed' ? `系统核对通过：${t.reason}` : `放弃：${t.reason}`,
    meta: { to: t.to, reason: t.reason, loop: SEO_PLAN_LOOP, verified: t.to === 'completed' },
  })
  if (logErr) throw new Error(`seo plan item audit log failed: ${logErr.message}`)

  const patch: Record<string, unknown> = { status: t.to, steps_json: t.stepsJson, updated_at: now }
  if (t.to === 'completed') patch.completed_at = now
  const { data: hit, error: updErr } = await supabase
    .from('execution_items')
    .update(patch)
    .eq('id', t.id)
    .eq('client_id', t.clientId)
    .in('status', ['pending', 'in_progress'])
    .select('id')
  if (updErr) throw new Error(`seo plan item status update failed: ${updErr.message}`)
  if (((hit as unknown[] | null) ?? []).length === 0) {
    // Another flow closed the card between our read and this write. The audit row above
    // already exists, so leave a correcting row rather than a receipt that lies.
    await supabase.from('execution_logs').insert({
      execution_item_id: t.id,
      client_id: t.clientId,
      author: 'system',
      kind: 'status_change',
      content: '状态没有变更：这张卡在核对期间已被其他流程改动，上一条"核对通过/放弃"记录不生效',
      meta: { to: t.to, applied: false, loop: SEO_PLAN_LOOP },
    })
    return false
  }
  return true
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
