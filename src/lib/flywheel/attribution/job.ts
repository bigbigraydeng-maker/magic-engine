/**
 * Attribution Job — P12.A.8
 *
 * For every flywheel_action that has an expected_metric:
 *   1. Find the most recent flywheel_metrics row BEFORE the action (baseline).
 *   2. Find the most recent flywheel_metrics row AFTER the action and within
 *      window_days (after_value).
 *   3. Compute delta, delta_pct, verdict, and confidence.
 *   4. Delete any existing outcome for that action and insert a fresh row.
 *
 * Called by the attribution Cron route (P12.A.9).
 */

import { supabaseAdmin } from '../../supabase'
import type { OutcomeVerdict } from '../adapters/types'

const DEFAULT_WINDOW_DAYS = 14

export interface AttributionJobOptions {
  /** Days after action.executed_at to look for an "after" metric. Default 14. */
  windowDays?: number
  /** Restrict to a single client (e.g. for manual reruns). */
  clientId?: string
}

export interface AttributionJobResult {
  processed: number
  written: number
  skipped: number
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAttributionJob(
  options: AttributionJobOptions = {}
): Promise<AttributionJobResult> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS

  let actionsQuery = supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, expected_metric, expected_delta, executed_at')
    .not('expected_metric', 'is', null)

  if (options.clientId) {
    actionsQuery = actionsQuery.eq('client_id', options.clientId)
  }

  const { data: actions, error: actionsError } = await actionsQuery

  if (actionsError) {
    throw new Error(`runAttributionJob: failed to fetch actions — ${actionsError.message}`)
  }

  if (!actions?.length) return { processed: 0, written: 0, skipped: 0 }

  let written = 0
  let skipped = 0

  for (const action of actions) {
    try {
      const didWrite = await processAction(action as ActionRow, windowDays)
      if (didWrite) written++
      else skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Attribution job: action ${action.id} — ${msg}`)
      skipped++
    }
  }

  return { processed: actions.length, written, skipped }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface ActionRow {
  id: string
  client_id: string
  expected_metric: string
  expected_delta: number | null
  executed_at: string
}

async function processAction(action: ActionRow, windowDays: number): Promise<boolean> {
  const { id, client_id, expected_metric, expected_delta, executed_at } = action
  const executedAt = new Date(executed_at)
  const windowEnd = new Date(executedAt)
  windowEnd.setDate(windowEnd.getDate() + windowDays)

  // ── Baseline: most recent metric BEFORE the action ────────────────────────
  const { data: baselineRow, error: baselineErr } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value')
    .eq('client_id', client_id)
    .eq('metric_key', expected_metric)
    .lt('measured_at', executedAt.toISOString())
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (baselineErr) throw new Error(`baseline query: ${baselineErr.message}`)
  if (!baselineRow) return false  // no baseline → skip

  // ── After: most recent metric AFTER action, within window ─────────────────
  const { data: afterRow, error: afterErr } = await supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value')
    .eq('client_id', client_id)
    .eq('metric_key', expected_metric)
    .gte('measured_at', executedAt.toISOString())
    .lte('measured_at', windowEnd.toISOString())
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (afterErr) throw new Error(`after query: ${afterErr.message}`)
  if (!afterRow) return false  // too early, no measurement yet

  // ── Compute attribution ───────────────────────────────────────────────────
  const baseline = Number(baselineRow.metric_value)
  const afterValue = Number(afterRow.metric_value)
  const delta = afterValue - baseline
  const deltaPct = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : null

  const { verdict, confidence } = computeVerdict(delta, deltaPct, expected_delta)

  // ── Upsert outcome (delete old, insert fresh for idempotency) ─────────────
  const { error: deleteErr } = await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', id)

  if (deleteErr) throw new Error(`outcome delete: ${deleteErr.message}`)

  const { error: insertErr } = await supabaseAdmin
    .from('flywheel_outcomes')
    .insert({
      action_id: id,
      client_id,
      metric_key: expected_metric,
      baseline,
      after_value: afterValue,
      delta,
      delta_pct: deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      computed_at: new Date().toISOString(),
    })

  if (insertErr) throw new Error(`outcome insert: ${insertErr.message}`)

  return true
}

// ── Verdict computation ───────────────────────────────────────────────────────

/**
 * Classify the outcome of an attribution window.
 *
 * Rules:
 *  - |delta_pct| < 3%   → inconclusive (noise floor)
 *  - expected_delta set → direction match = confirmed, mismatch = reversed
 *  - no expected_delta  → positive delta = confirmed, negative = reversed
 *  - confidence ∝ |delta_pct| / 20 (20 % change → full confidence, cap 0.95)
 */
export function computeVerdict(
  delta: number,
  deltaPct: number | null,
  expectedDelta: number | null
): { verdict: OutcomeVerdict; confidence: number } {
  const absPct = deltaPct !== null ? Math.abs(deltaPct) : 0

  if (absPct < 3) {
    return { verdict: 'inconclusive', confidence: 0.2 }
  }

  const confidence = round2(Math.min(0.95, absPct / 20))

  if (expectedDelta !== null && expectedDelta !== 0) {
    const expectedPositive = expectedDelta > 0
    const actualPositive = delta > 0

    if (expectedPositive === actualPositive) {
      return {
        verdict: confidence >= 0.35 ? 'confirmed' : 'inconclusive',
        confidence,
      }
    }
    return { verdict: 'reversed', confidence }
  }

  // No expected direction — use sign of actual delta
  return {
    verdict: delta > 0 ? 'confirmed' : 'reversed',
    confidence: round2(Math.min(0.7, absPct / 20)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
