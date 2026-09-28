/**
 * Monthly recurring goals — auto-rollover on natural month boundary.
 *
 * For every goal marked recurrence='monthly' whose period has ended, create the
 * next natural month's goal so the ads autonomy engine (and any other consumer
 * reading `listActiveGoals`) never loses its target reference. Idempotent via
 * partial unique index uniq_goals_monthly_per_client_metric_month —
 * running the cron twice a day (or twice a minute) never produces duplicates.
 *
 * Explicit design choices (see PR / ledger 2026-09-27):
 *   - Trigger ONLY on recurrence='monthly'. Never infer "recurring" from
 *     "there was a goal last month" — one-shot event goals would then be
 *     resurrected indefinitely.
 *   - Fields copied verbatim: intent, sub_type, awareness_subtype, title,
 *     primary_metric_*, baseline_value, target_value, target_direction,
 *     supporting_metrics, budget_amount, budget_currency, fde_reasoning,
 *     is_beta.
 *   - Fields reset: current_value, current_value_fetched_at,
 *     current_value_source, verdict, verdict_at, verdict_summary.
 *   - New goal goes straight to status='active' — this is a continuation of an
 *     approved monthly commitment, not a fresh draft that needs FDE activation.
 *
 * Known gap (子牙 review, PR #2194): if a client churns mid-period and their
 * monthly goal is archived early, nothing here distinguishes that from a
 * normal end-of-period archive — the chain still rolls forward next month.
 * There is currently no product surface that sets recurrence='monthly' in the
 * first place (enrollment is a manual SQL UPDATE, see PR follow-up), so the
 * only way to stop a chain today is the same manual UPDATE, clearing
 * recurrence back to NULL when a client's goal is archived for churn rather
 * than period completion. Revisit once enrollment gets a real UI/API.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GoalRow } from '@/types/strategy'

/**
 * Given the previous period's end ISO date, return the first and last day of
 * the natural month that starts immediately after. UTC throughout so DST /
 * timezone shifts cannot skew month boundaries.
 *
 * Examples:
 *   '2026-09-30' → { start: '2026-10-01', end: '2026-10-31' }
 *   '2026-12-31' → { start: '2027-01-01', end: '2027-01-31' }
 *   '2027-01-31' → { start: '2027-02-01', end: '2027-02-28' }  // non-leap
 *   '2028-01-31' → { start: '2028-02-01', end: '2028-02-29' }  // leap
 */
export function nextNaturalMonth(periodEndIso: string): { start: string; end: string } {
  const d = new Date(`${periodEndIso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`nextNaturalMonth: invalid ISO date ${periodEndIso}`)
  }
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() // 0-indexed
  const nextStart = new Date(Date.UTC(y, m + 1, 1))
  // Day 0 of month (m + 2) = last day of month (m + 1).
  const nextEnd = new Date(Date.UTC(y, m + 2, 0))
  return {
    start: nextStart.toISOString().slice(0, 10),
    end: nextEnd.toISOString().slice(0, 10),
  }
}

export interface PlannedRollover {
  source_goal_id: string
  client_id: string
  primary_metric_key: string
  next_period_start: string
  next_period_end: string
}

export interface RolloverResult {
  planned: PlannedRollover[]
  rolled: PlannedRollover[]
  skipped_existing: PlannedRollover[]
  error?: string
}

export interface RolloverOptions {
  /** ISO date; defaults to today (UTC). Test-only injection point. */
  today?: string
  /** When true, compute the plan but do not write anything. Used by cron ?dry_run=1. */
  dryRun?: boolean
}

/**
 * Scan for monthly-recurring goals whose period has ended and create each one's
 * successor for the next natural month. Idempotent: relies on the partial
 * unique index for the final safety net, plus a pre-check to keep the log tidy.
 */
export async function rolloverMonthlyGoals(
  supabase: SupabaseClient,
  opts: RolloverOptions = {},
): Promise<RolloverResult> {
  const todayIso = opts.today ?? new Date().toISOString().slice(0, 10)
  const dryRun = opts.dryRun === true

  // Include both 'expired' (just flagged by flagExpiredGoals) and 'archived'
  // (verdict already written) — either is a valid template for the next month.
  // Skip 'draft' (never active) and 'active' (period must have ended).
  //
  // No .limit()/pagination: this candidate pool is bounded by "how many goals
  // are currently enrolled in monthly recurrence AND not yet rolled over" —
  // unlike an ever-growing log table, a goal leaves this pool the moment it
  // rolls (its successor's period_end is in the future). Enrollment today is
  // manual-SQL-only (see module doc), so the pool is single digits. Revisit
  // if/when self-serve enrollment ships and this could approach the PostgREST
  // 1000-row default page size.
  const { data: expiredGoals, error: fetchError } = await supabase
    .from('goals')
    .select('*')
    .eq('recurrence', 'monthly')
    .lt('period_end', todayIso)
    .in('status', ['expired', 'archived'])

  if (fetchError) {
    return { planned: [], rolled: [], skipped_existing: [], error: fetchError.message }
  }

  const planned: PlannedRollover[] = []
  const rolled: PlannedRollover[] = []
  const skippedExisting: PlannedRollover[] = []

  for (const raw of expiredGoals ?? []) {
    const goal = raw as GoalRow

    // period_end is a DB `date` column so a malformed value shouldn't occur,
    // but nextNaturalMonth throws on one — catch it here so a single bad row
    // degrades to the same {error} shape every other failure path in this
    // function returns, instead of an uncaught exception that would blow past
    // the cron route's own try/catch-free call site and leave cron_run_logs
    // stuck in 'running' instead of cleanly marked 'failed'.
    let nextStart: string, nextEnd: string
    try {
      ({ start: nextStart, end: nextEnd } = nextNaturalMonth(goal.period_end))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { planned, rolled, skipped_existing: skippedExisting, error: `goal ${goal.id}: ${message}` }
    }

    const plan: PlannedRollover = {
      source_goal_id: goal.id,
      client_id: goal.client_id,
      primary_metric_key: goal.primary_metric_key,
      next_period_start: nextStart,
      next_period_end: nextEnd,
    }
    planned.push(plan)

    // Pre-check keeps output clean: without it every steady-state run would
    // log an insert attempt that the unique index then rejected. Index is
    // still the source of truth on race.
    const { data: existing, error: checkError } = await supabase
      .from('goals')
      .select('id')
      .eq('client_id', goal.client_id)
      .eq('primary_metric_key', goal.primary_metric_key)
      .eq('period_start', nextStart)
      .eq('recurrence', 'monthly')
      .limit(1)

    if (checkError) {
      return { planned, rolled, skipped_existing: skippedExisting, error: checkError.message }
    }
    if (existing && existing.length > 0) {
      skippedExisting.push(plan)
      continue
    }

    if (dryRun) continue

    const { error: insertError } = await supabase.from('goals').insert({
      client_id: goal.client_id,
      intent: goal.intent,
      awareness_subtype: goal.awareness_subtype,
      sub_type: goal.sub_type,
      title: goal.title,
      primary_metric_key: goal.primary_metric_key,
      primary_metric_label: goal.primary_metric_label,
      primary_metric_unit: goal.primary_metric_unit,
      baseline_value: goal.baseline_value,
      target_value: goal.target_value,
      target_direction: goal.target_direction,
      supporting_metrics: goal.supporting_metrics ?? [],
      period_start: nextStart,
      period_end: nextEnd,
      budget_amount: goal.budget_amount,
      budget_currency: goal.budget_currency,
      status: 'active',
      recurrence: 'monthly',
      fde_reasoning: goal.fde_reasoning,
      is_beta: goal.is_beta,
      // current_value*, verdict* left null so the new period starts fresh.
    })

    if (insertError) {
      // 23505 = unique_violation — a parallel cron beat us to it. Not an error.
      const code = (insertError as { code?: string }).code
      if (code === '23505') {
        skippedExisting.push(plan)
        continue
      }
      return { planned, rolled, skipped_existing: skippedExisting, error: insertError.message }
    }

    rolled.push(plan)
  }

  return { planned, rolled, skipped_existing: skippedExisting }
}
