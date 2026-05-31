/**
 * Phase 21.6 — Token Budget Governance + circuit breaker
 *
 * The AI Content Factory can fan a single topic out to many platforms and run
 * in bulk. Without a ceiling, a runaway batch (or a misconfigured cadence) would
 * drain a client's MTC. This guard sits in front of Factory generation:
 *
 *   getMonthlySpend → sums this calendar month's mtc_ledger debits
 *   getMonthlyCap   → reads clients.monthly_mtc_cap, falls back to global default
 *   checkBudget     → composes both into a BudgetStatus (allowed / remaining / cap)
 *
 * Layered ON TOP of deductMtc — deductMtc guards the lifetime balance, this guard
 * guards the per-month burn rate. P21.5 orchestrator and runFactoryJob call
 * checkBudget before generating; recordSpend is just deductMtc (no new ledger).
 *
 * Graceful degradation: if clients.monthly_mtc_cap doesn't exist yet (migration
 * not applied) or the row is missing, the global default applies — the guard
 * never throws on a missing optional column.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_MONTHLY_MTC_CAP } from './types'
import type { BudgetStatus } from './types'

/** First instant of the current calendar month, ISO 8601 (UTC). */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/** Sum of MTC debited for this client since the start of the current month. */
export async function getMonthlySpend(
  clientId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('mtc_ledger')
    .select('mtc_amount')
    .eq('client_id', clientId)
    .eq('direction', 'debit')
    .gte('created_at', monthStartIso(now))

  if (error) throw new Error(`MTC monthly spend lookup failed: ${error.message}`)

  return (data ?? []).reduce((sum, row) => sum + (row.mtc_amount as number), 0)
}

/**
 * Effective monthly cap for a client: the per-client override when set and valid,
 * otherwise the global default. Degrades to the default on any read failure
 * (e.g. column not yet migrated) rather than blocking generation.
 */
export async function getMonthlyCap(clientId: string): Promise<{ cap: number; capIsCustom: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('monthly_mtc_cap')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) {
    return { cap: DEFAULT_MONTHLY_MTC_CAP, capIsCustom: false }
  }

  const override = data.monthly_mtc_cap as number | null
  if (typeof override === 'number' && override > 0) {
    return { cap: override, capIsCustom: true }
  }
  return { cap: DEFAULT_MONTHLY_MTC_CAP, capIsCustom: false }
}

/**
 * Check whether a client may spend `projectedMtc` more this month.
 *
 * @param projectedMtc estimated MTC cost of the pending generation (default 0 =
 *        pure status read). The breaker trips when spent + projected would meet
 *        or exceed the cap.
 */
export async function checkBudget(
  clientId: string,
  projectedMtc = 0,
  now: Date = new Date(),
): Promise<BudgetStatus> {
  const [spent, { cap, capIsCustom }] = await Promise.all([
    getMonthlySpend(clientId, now),
    getMonthlyCap(clientId),
  ])

  const remaining = Math.max(0, cap - spent)
  const allowed = spent + projectedMtc <= cap

  return { allowed, spent, cap, remaining, capIsCustom }
}
