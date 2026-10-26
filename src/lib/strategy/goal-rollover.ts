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
 * Stopping a chain: clients with client_status='archived' are skipped
 * automatically. To stop one client's chain while keeping the client, clear
 * `recurrence` on the chain's newest goal (older rows cannot resurrect it,
 * see the "ends after the source" pre-check). There is still no product
 * surface that sets recurrence='monthly' (enrollment is a manual UPDATE).
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

/**
 * Next natural month after `periodEndIso` that has not already ended by
 * `todayIso`. When the cron missed whole months (outage, chain enrolled late)
 * we do not back-fill goals for months that are already over — they would be
 * born active with a past period and be flagged expired the next morning —
 * we jump to the month that is running now (or the next one, if the source's
 * period ended in the future).
 */
export function nextLiveMonth(
  periodEndIso: string,
  todayIso: string,
): { start: string; end: string; skippedMonths: number } {
  let next = nextNaturalMonth(periodEndIso)
  let skippedMonths = 0
  // 120 = ten years of months; a bound so a bad date can never spin forever.
  while (next.end < todayIso && skippedMonths < 120) {
    skippedMonths += 1
    next = nextNaturalMonth(next.end)
  }
  return { ...next, skippedMonths }
}

function rolloverReasoning(goal: GoalRow): string {
  const note = `（系统自动续建自目标 ${goal.id}，目标值沿用上月、未做任何调整）`
  return goal.fde_reasoning ? `${goal.fde_reasoning}\n${note}` : note
}

export interface PlannedRollover {
  source_goal_id: string
  client_id: string
  primary_metric_key: string
  next_period_start: string
  next_period_end: string
  /** Natural months not created because they were already over (see nextLiveMonth). */
  skipped_past_months: number
  /** Carried over from the source goal unchanged — shown in dry_run / cron summary so PM can see it. */
  target_value: number
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
  // No .limit()/pagination: the pool is every expired/archived monthly goal, i.e.
  // one row per past month per enrolled chain. We only ever act on the NEWEST
  // row of each (client, metric) chain (picked below), so old months are read
  // but never planned. Enrollment is manual-SQL-only today, so this is tens of
  // rows; revisit if self-serve enrollment ships and it nears the PostgREST
  // 1000-row page size.
  const { data: expiredGoals, error: fetchError } = await supabase
    .from('goals')
    .select('*')
    .eq('recurrence', 'monthly')
    .lt('period_end', todayIso)
    // dry_run skips flagExpiredGoals, so a goal that the real run would flag
    // 'expired' a moment before rolling is still 'active' here — include it, or
    // the preview says "nothing to do" on exactly the day it matters.
    .in('status', dryRun ? ['active', 'expired', 'archived'] : ['expired', 'archived'])

  if (fetchError) {
    return { planned: [], rolled: [], skipped_existing: [], error: fetchError.message }
  }

  const planned: PlannedRollover[] = []
  const rolled: PlannedRollover[] = []
  const skippedExisting: PlannedRollover[] = []
  const errors: string[] = []
  const fail = () => ({
    planned, rolled, skipped_existing: skippedExisting,
    ...(errors.length > 0 ? { error: errors.join(' | ') } : {}),
  })

  // Only the newest source of each (client, metric) chain: older months would
  // otherwise re-plan the same target month every day.
  const newest = new Map<string, GoalRow>()
  for (const raw of expiredGoals ?? []) {
    const g = raw as GoalRow
    const key = `${g.client_id}::${g.primary_metric_key}`
    const cur = newest.get(key)
    if (!cur || g.period_end > cur.period_end) newest.set(key, g)
  }

  // A client PM has archived (churned) must not keep getting live goals.
  const clientIds = Array.from(new Set(Array.from(newest.values()).map(g => g.client_id)))
  const archivedClients = new Set<string>()
  if (clientIds.length > 0) {
    const { data: clientRows, error: clientErr } = await supabase
      .from('clients')
      .select('id, client_status')
      .in('id', clientIds)
    if (clientErr) {
      // Fail closed: not knowing whether a client has churned must not create goals.
      return { planned, rolled, skipped_existing: skippedExisting, error: `clients lookup: ${clientErr.message}` }
    }
    for (const c of (clientRows ?? []) as Array<{ id: string; client_status: string | null }>) {
      if (c.client_status === 'archived') archivedClients.add(c.id)
    }
  }

  for (const goal of newest.values()) {
    if (archivedClients.has(goal.client_id)) continue

    // period_end is a DB `date` column so a malformed value shouldn't occur,
    // but nextNaturalMonth throws on one — catch it here so a single bad row
    // degrades to the same {error} shape every other failure path in this
    // function returns, instead of an uncaught exception that would blow past
    // the cron route's own try/catch-free call site and leave cron_run_logs
    // stuck in 'running' instead of cleanly marked 'failed'.
    let nextStart: string, nextEnd: string, skippedMonths: number
    try {
      ({ start: nextStart, end: nextEnd, skippedMonths } = nextLiveMonth(goal.period_end, todayIso))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`goal ${goal.id}: ${message}`)
      continue
    }

    const plan: PlannedRollover = {
      source_goal_id: goal.id,
      client_id: goal.client_id,
      primary_metric_key: goal.primary_metric_key,
      next_period_start: nextStart,
      next_period_end: nextEnd,
      skipped_past_months: skippedMonths,
      target_value: goal.target_value,
    }
    planned.push(plan)

    // Pre-check — skip when ANY goal of this client+metric ends after the source
    // does, whatever its recurrence or status. That covers: a successor made by an
    // earlier run; a goal a human created by hand (recurrence NULL, invisible to
    // the partial unique index); and a chain PM stopped by clearing recurrence on
    // its newest row (older monthly rows must not resurrect it). The unique index
    // stays as the last line of defence against two cron runs racing.
    const { data: existing, error: checkError } = await supabase
      .from('goals')
      .select('id')
      .eq('client_id', goal.client_id)
      .eq('primary_metric_key', goal.primary_metric_key)
      .gt('period_end', goal.period_end)
      .limit(1)

    if (checkError) {
      errors.push(`goal ${goal.id}: ${checkError.message}`)
      continue
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
      target_value: goal.target_value, // never scaled up automatically — PM changes it by hand
      target_direction: goal.target_direction,
      supporting_metrics: goal.supporting_metrics ?? [],
      period_start: nextStart,
      period_end: nextEnd,
      budget_amount: goal.budget_amount,
      budget_currency: goal.budget_currency,
      status: 'active',
      recurrence: 'monthly',
      fde_reasoning: rolloverReasoning(goal),
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
      errors.push(`goal ${goal.id}: ${insertError.message}`)
      continue
    }

    rolled.push(plan)
  }

  return fail()
}
