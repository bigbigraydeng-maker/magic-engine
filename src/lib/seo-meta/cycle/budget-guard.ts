/**
 * SEO Meta-Cycle v1 — global (cross-client) DataForSEO call budget (魏征
 * finding #9).
 *
 * MAX_PAGES_PER_RUN caps spend PER CLIENT, but a dedup bug in the
 * candidate-merging step (candidates.ts) could still multiply spend ACROSS
 * every enabled client in the same weekly cycle. This is the circuit
 * breaker on top of that per-client cap.
 *
 * No new table: each per-client worker already writes a step-2 receipt to
 * cron_run_logs (receipts.ts) recording how many DataForSEO calls it made.
 * The guard sums those receipts for the current week_key before a client
 * starts its own DataForSEO enrichment. Best-effort, not a hard financial
 * lock — concurrent per-client workers can race past this cheaply, which is
 * an accepted trade-off (documented, not hidden) for not adding a new table
 * for a circuit breaker whose job is to catch a 10x/100x runaway, not to
 * meter to the cent.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { STEP2_JOB_NAME } from './receipts'

/** Conservative ceiling for one weekly cycle across ALL enabled clients — a client-count-independent constant, not derived from the roster size (see file header: this must not scale with a dedup bug's multiplication). */
export const GLOBAL_DATAFORSEO_CALL_BUDGET_PER_WEEK = 250

export interface BudgetStatus {
  readonly callsSoFar: number
  readonly remaining: number
  readonly overBudget: boolean
}

/**
 * Fail-open on a lookup error (unlike the fail-closed oscillation/cooldown
 * guards): this is a spend circuit-breaker, not a correctness guard — if we
 * can't read prior spend, blocking the whole week's cycle over a transient
 * read error would cost more (a fully skipped IMPACT cycle for every client)
 * than the rare case this guard exists to catch.
 */
export async function checkGlobalDataForSeoBudget(
  supabase: SupabaseClient,
  weekKey: string,
): Promise<BudgetStatus> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', STEP2_JOB_NAME)
    .gte('started_at', weekStartIso(weekKey))

  if (error) {
    return { callsSoFar: 0, remaining: GLOBAL_DATAFORSEO_CALL_BUDGET_PER_WEEK, overBudget: false }
  }

  const callsSoFar = (data ?? []).reduce((sum, row) => {
    const summary = (row as { summary?: unknown }).summary as { week_key?: string; dataforseo_calls?: number } | null
    if (!summary || summary.week_key !== weekKey) return sum
    return sum + (typeof summary.dataforseo_calls === 'number' ? summary.dataforseo_calls : 0)
  }, 0)

  const remaining = Math.max(0, GLOBAL_DATAFORSEO_CALL_BUDGET_PER_WEEK - callsSoFar)
  return { callsSoFar, remaining, overBudget: remaining <= 0 }
}

/** Rough week-start bound for the started_at filter — a coarse pre-filter only; the real scoping is the week_key check in the summary above. */
function weekStartIso(weekKey: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey)
  if (!m) return new Date(0).toISOString()
  const year = Number(m[1])
  const week = Number(m[2])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000)
  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000)
  return monday.toISOString()
}
