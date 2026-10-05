/**
 * 1b · Switch derived memories OFF when their action is no longer a valid learning case.
 *
 * Only pillars in EXECUTION_GATED_FLYWHEELS are touched; every other pillar keeps the
 * extractor's original behaviour. The decision uses the same `classifyActionCase` the
 * extractor's step 4 uses to switch memories ON, so one run can never open a memory
 * and close it again.
 *
 * Nothing is deleted: only `is_active` changes, and every switched-off row is returned
 * with its table so the cron run log holds a complete rollback list. `source_action_id`
 * is never written here, so restoring a row from the list puts it back exactly as it was.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  RULE_BASED_REASONS,
  isGatedFlywheel,
  type CaseReason,
  type CaseStatus,
} from './case-validity'
import type { DerivedMemoryTable } from './service'

export type MemoryTable = DerivedMemoryTable | 'client_learned_preferences'

export type DeactivationReason =
  | Exclude<CaseReason, 'immature'>
  | 'source_missing'
  | 'opposite_side'
  | 'preference_no_support'

export interface DeactivatedMemory {
  table: MemoryTable
  id: string
  reason: DeactivationReason
}

/** A derived memory row with what reconciliation needs to judge it. */
export interface ReconcileRow {
  id: string
  table: DerivedMemoryTable
  is_active: boolean
  source_action_id: string | null
  /** Resolved via source_action_id, or via source_id → outcome → action; null if neither. */
  action_id: string | null
  /** The action's flywheel when the action is known, otherwise the row's own column. */
  pillar: string | null
}

export interface ReconcilePlan {
  deactivate: DeactivatedMemory[]
  skippedStalled: number
  skippedImmature: number
  skippedUnknownPillar: number
}

const SIDE_TABLE: Record<'proven' | 'failed', DerivedMemoryTable> = {
  proven: 'client_proven_patterns',
  failed: 'client_failed_experiments',
}

/** Decide which active rows to switch off. Pure — the caller applies the plan. */
export function planDerivedMemoryDeactivations(
  rows: readonly ReconcileRow[],
  classify: (actionId: string) => CaseStatus,
  attributionHealthy: boolean,
): ReconcilePlan {
  const plan: ReconcilePlan = { deactivate: [], skippedStalled: 0, skippedImmature: 0, skippedUnknownPillar: 0 }

  for (const row of rows) {
    if (!row.is_active) continue
    if (row.pillar === null) {
      plan.skippedUnknownPillar++
      continue
    }
    if (!isGatedFlywheel(row.pillar)) continue

    // The row cannot be tied to any action: its source outcome is gone and it never
    // recorded the action. There is nothing left that could make it true.
    if (row.action_id === null) {
      plan.deactivate.push({ table: row.table, id: row.id, reason: 'source_missing' })
      continue
    }

    const status = classify(row.action_id)
    if (status.kind === 'valid') {
      // Same side: step 4 keeps it on. Opposite side and carrying the action's id: step 4's
      // loser switch-off reaches it. Only an older row that step 4 cannot reach — no
      // source_action_id, found through its outcome — is switched off here.
      const onOppositeSide = SIDE_TABLE[status.side] !== row.table
      if (onOppositeSide && row.source_action_id !== row.action_id) {
        plan.deactivate.push({ table: row.table, id: row.id, reason: 'opposite_side' })
      }
      continue
    }

    const reason = status.reason
    // Inside its measurement window the verdict still moves day to day: neither open nor close.
    if (reason === 'immature') {
      plan.skippedImmature++
      continue
    }
    // With attribution stalled, "stale" and "no strong verdict" describe our pipeline,
    // not the action. Rule-based reasons do not depend on a recent run and still apply.
    if (!attributionHealthy && !RULE_BASED_REASONS.has(reason)) {
      plan.skippedStalled++
      continue
    }
    plan.deactivate.push({ table: row.table, id: row.id, reason })
  }

  return plan
}

/** Keep each `.in('id', …)` short enough for PostgREST's URL limit. */
const DEACTIVATE_BATCH = 150

/**
 * Switch the planned rows off, in batches, scoped to the client. Only rows whose batch
 * succeeded are returned as done. Never throws: a batch that fails — by error result or
 * by exception — is reported and the rest carry on, so the caller always gets back the
 * list of what was actually switched off (it is the rollback list).
 */
export async function applyDeactivations(
  supabase: SupabaseClient,
  clientId: string,
  planned: readonly DeactivatedMemory[],
): Promise<{ done: DeactivatedMemory[]; errors: string[] }> {
  const done: DeactivatedMemory[] = []
  const errors: string[] = []
  const tables = Array.from(new Set(planned.map((p) => p.table)))

  for (const table of tables) {
    const items = planned.filter((p) => p.table === table)
    for (let i = 0; i < items.length; i += DEACTIVATE_BATCH) {
      const batch = items.slice(i, i + DEACTIVATE_BATCH)
      try {
        const { error } = await supabase
          .from(table)
          .update({ is_active: false })
          .eq('client_id', clientId)
          .in('id', batch.map((b) => b.id))
        if (error) errors.push(`deactivate ${table}: ${error.message}`)
        else done.push(...batch)
      } catch (err) {
        errors.push(`deactivate ${table}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  return { done, errors }
}

/** How recent the last good attribution run must be before freshness-based switch-offs are trusted. */
export const ATTRIBUTION_STALL_HOURS = 24

export interface AttributionHealth {
  healthy: boolean
  detail: string
}

/**
 * Is attribution running normally? Healthy = the last `attribution-cron` run that
 * completed finished within ATTRIBUTION_STALL_HOURS and its GSC pass did not fail as a
 * whole. A read failure counts as stalled — the safe side is to switch fewer memories off.
 *
 * "Failed as a whole" = it reported errors AND wrote no outcome at all. A sporadic
 * per-action error is not a stall: production 2026-09-19..26 had 1 such run in 25
 * (one `fetch failed`, with 630 outcomes written), and a stale verdict needs 7 days
 * without any recompute anyway.
 *
 * Known gap: a manual single-client attribution run (`?client_id=`) also records a
 * completed run, and the run summary does not say which client it covered, so it can mask
 * a stalled full run for up to a day. Rule-based switch-offs are unaffected.
 */
export async function loadAttributionHealth(supabase: SupabaseClient, now: Date): Promise<AttributionHealth> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'attribution-cron')
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)

  if (error) return { healthy: false, detail: `attribution health unreadable: ${error.message}` }

  const last = ((data ?? []) as Array<{ finished_at: string | null; summary: unknown }>)[0]
  if (!last?.finished_at) return { healthy: false, detail: 'no completed attribution run on record' }

  const ageMs = now.getTime() - Date.parse(last.finished_at)
  if (!(ageMs <= ATTRIBUTION_STALL_HOURS * 3_600_000)) {
    return { healthy: false, detail: `last completed attribution run finished ${last.finished_at}` }
  }

  const gsc = gscPass(last.summary)
  if (gsc.errors > 0 && gsc.outcomesWritten === 0) {
    return { healthy: false, detail: `last attribution run's GSC pass wrote nothing and reported ${gsc.errors} error(s)` }
  }
  return { healthy: true, detail: 'ok' }
}

function gscPass(summary: unknown): { errors: number; outcomesWritten: number } {
  const none = { errors: 0, outcomesWritten: 0 }
  if (typeof summary !== 'object' || summary === null) return none
  const gsc = (summary as Record<string, unknown>).gsc
  if (typeof gsc !== 'object' || gsc === null) return none
  const record = gsc as Record<string, unknown>
  return {
    errors: Array.isArray(record.errors) ? record.errors.length : 0,
    outcomesWritten: typeof record.outcomes_written === 'number' ? record.outcomes_written : 0,
  }
}

/** An auto-extracted preference row, as far as reconciliation cares. */
export interface PreferenceRow {
  id: string
  content: string
  flywheel: string | null
  preference_type: string
  is_active: boolean
  extracted_from_table: string | null
}

/** The action_type a preference was written for, from its `action_type='…'` marker. */
export function preferenceActionType(content: string): string | null {
  const m = /action_type='([^']*)'/.exec(content)
  return m ? m[1] : null
}

/**
 * Active auto-extracted preferences of gated pillars whose action type no longer has
 * enough valid confirmed actions behind it. `support` is keyed `${flywheel}::${actionType}`
 * and must be the SAME count the extractor uses to write preferences — otherwise a
 * preference would be written and switched off on alternate days.
 *
 * `holdKeys` (same key format) are action types whose low support may only be a symptom
 * of a stalled attribution pipeline — the caller passes them while attribution is stalled,
 * and they are held back instead of switched off. A type whose every action is invalid for
 * a rule-based reason (e.g. whole-site metric, never executed) is never held.
 */
export function planPreferenceDeactivations(
  rows: readonly PreferenceRow[],
  support: ReadonlyMap<string, number>,
  minSupport: number,
  holdKeys: ReadonlySet<string> = new Set(),
): { planned: DeactivatedMemory[]; held: number } {
  const planned: DeactivatedMemory[] = []
  let held = 0
  for (const row of rows) {
    if (!row.is_active || row.extracted_from_table !== 'flywheel_outcomes') continue
    if (!isGatedFlywheel(row.flywheel)) continue
    const actionType = preferenceActionType(row.content)
    if (actionType === null) continue
    const key = `${row.flywheel}::${actionType}`
    if ((support.get(key) ?? 0) >= minSupport) continue
    if (holdKeys.has(key)) {
      held++
      continue
    }
    planned.push({ table: 'client_learned_preferences', id: row.id, reason: 'preference_no_support' })
  }
  return { planned, held }
}
