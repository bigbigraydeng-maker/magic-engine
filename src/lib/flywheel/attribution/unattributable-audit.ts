/**
 * Actions no evaluator can attribute — Issue #859, Codex P1 on PR #862.
 *
 * An action whose `expected_metric` is owned by an evaluator that cannot load
 * its flywheel will never produce an outcome: the owner never sees it, and the
 * `flywheel_outcomes_evaluator_owns_metric` CHECK forbids anyone else writing
 * it. Attribution detects this every run, but a count in a cron summary is not
 * a report — CLAUDE.md §3 is explicit that a finding which cannot be fixed
 * automatically has to reach a human through the same pipeline as everything
 * else, with what / how / href.
 *
 * This audit is the detection half. It reads the same routing rule the writers
 * use, so it cannot disagree with them about which actions are stranded.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import {
  evaluatorCanLoad,
  resolveAuthoritativeEvaluator,
  resolveAttributionRoutingDetailed,
  type UnattributableReason,
} from './outcome-identity'

export interface UnattributableAction {
  action_id: string
  client_id: string
  flywheel: string
  expected_metric: string
  action_type: string | null
  executed_at: string | null
  /** Why nobody can attribute it — the three causes have different fixes. */
  reason: UnattributableReason
  /** The metric this action would actually get, when one exists. */
  suggested_metric: string | null
}

interface ActionRow {
  id: string
  client_id: string
  flywheel: string
  action_type: string | null
  payload: Record<string, unknown> | null
  expected_metric: string
  executed_at: string | null
}

/**
 * Every action currently stranded, newest first.
 *
 * Throws on a query failure rather than returning [] — "no stranded actions"
 * and "we could not check" must not look the same to the caller.
 */
export async function auditUnattributableActions(
  supabase: SupabaseClient,
  clientIds?: string[],
): Promise<UnattributableAction[]> {
  // Paginated, not a bare select: PostgREST caps a single response at 1000 rows
  // and says nothing about it. Combined with newest-first ordering, an
  // unpaginated read silently drops the OLDEST actions — and a stranded action
  // only gets older, so precisely the ones most overdue for attention would be
  // the ones that never reach the todo. `fetchAll` throws rather than handing
  // back half a result, which is the whole reason it exists.
  const rows = await fetchAll<ActionRow>((from, to) => {
    let query = supabase
      .from('flywheel_actions')
      .select('id, client_id, flywheel, action_type, payload, expected_metric, executed_at')
      .not('expected_metric', 'is', null)
      // `id` as tiebreak: executed_at is not unique, and an unstable sort across
      // page boundaries duplicates or drops rows there.
      .order('executed_at', { ascending: false })
      .order('id', { ascending: false })

    if (clientIds?.length) query = query.in('client_id', clientIds)

    return query.range(from, to)
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`auditUnattributableActions: ${message}`)
  })

  const stranded: UnattributableAction[] = []

  for (const row of rows) {
    const result = resolveAttributionRoutingDetailed(row)
    if (result.routing !== 'unattributable') continue

    stranded.push({
      action_id: row.id,
      client_id: row.client_id,
      flywheel: row.flywheel,
      expected_metric: row.expected_metric,
      action_type: row.action_type,
      executed_at: row.executed_at,
      reason: result.reason,
      suggested_metric: result.suggestedMetric,
    })
  }

  return stranded
}

// ── Outcome rows nobody can maintain ─────────────────────────────────────────

export interface OrphanedOutcome {
  client_id: string
  action_id: string
  metric_key: string
  flywheel: string
  /** What the action promises now — the reason the old row was abandoned. */
  expected_metric: string
  /** How many rows share this (action, metric) pair, across windows. */
  rows: number
}

/**
 * Outcome rows whose owning evaluator cannot load their action.
 *
 * Reachable through a correction the system itself asks for: the
 * `action_unattributable` todo tells a human to change an action's
 * `expected_metric`, and if the old value belonged to a DIFFERENT evaluator's
 * metric family, the rows it already wrote become unmaintainable. Pass 1 will
 * not touch them — they are not its evaluator's — and the owning evaluator
 * cannot load the action, so it never sees them either. They are frozen at
 * whatever they last said, while still being read as evidence.
 *
 * DELETING THEM IS NOT AN OPTION. A writer removing rows it does not own is the
 * exact defect this Work Package removed (main's `DELETE WHERE action_id = ?`),
 * and re-adding it under a narrower condition would just make the same mistake
 * harder to see. So this is detection: it goes to a human through the same
 * pipeline as everything else, and a human decides.
 *
 * Throws on a query failure — "no orphans" and "we could not check" must not
 * look the same. (Codex P2, round 19 on PR #862.)
 */
export async function auditOrphanedOutcomes(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<OrphanedOutcome[]> {
  if (clientIds.length === 0) return []

  const actions = await loadActionsFor(supabase, clientIds)
  if (actions.length === 0) return []

  const byId = new Map(actions.map(a => [a.id, a]))
  const rows = await loadOutcomesFor(supabase, clientIds)

  const grouped = new Map<string, OrphanedOutcome>()

  for (const row of rows) {
    const action = byId.get(row.action_id)
    if (!action) continue                       // orphan of a deleted action — different problem
    if (row.metric_key === action.expected_metric) continue

    // Only a row the action no longer promises AND whose owner cannot load it
    // is stuck. A metric the owner CAN load is refreshed or retired by that
    // owner on its own schedule — the three seo.gsc.* rows the bridge writes
    // for an SEO action are exactly that, and must not be reported.
    const owner = resolveAuthoritativeEvaluator(row.metric_key)
    if (evaluatorCanLoad(owner, action.flywheel)) continue

    const key = `${row.action_id}::${row.metric_key}`
    const existing = grouped.get(key)
    if (existing) {
      existing.rows++
      continue
    }
    grouped.set(key, {
      client_id: row.client_id,
      action_id: row.action_id,
      metric_key: row.metric_key,
      flywheel: action.flywheel,
      expected_metric: action.expected_metric,
      rows: 1,
    })
  }

  return Array.from(grouped.values())
}

interface OutcomeRow {
  action_id: string
  client_id: string
  metric_key: string
}

/** Paginated: PostgREST truncates at 1000 rows without saying so. */
async function loadActionsFor(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<ActionRow[]> {
  return fetchAll<ActionRow>((from, to) =>
    supabase
      .from('flywheel_actions')
      .select('id, client_id, flywheel, action_type, payload, expected_metric, executed_at')
      .in('client_id', clientIds)
      .not('expected_metric', 'is', null)
      .order('id', { ascending: true })
      .range(from, to),
  )
}

async function loadOutcomesFor(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<OutcomeRow[]> {
  return fetchAll<OutcomeRow>((from, to) =>
    supabase
      .from('flywheel_outcomes')
      .select('action_id, client_id, metric_key')
      .in('client_id', clientIds)
      .order('id', { ascending: true })
      .range(from, to),
  )
}
