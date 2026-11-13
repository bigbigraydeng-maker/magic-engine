/**
 * Tuesday tune: a budget increase or decrease becomes the existing budget card.
 *
 * Issuing the card does not change a budget. A person confirms it on the
 * budget-card route, which re-checks the guards and then runs the existing path.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { issueTuesdayBudgetTunes, productionTuesdayPorts, type TuesdayIssueResult } from './tuesday-budget-execute'
import type { WeeklyBudgetSuggestion, WeeklyCheckSummary } from './prescription-weekly-check'

export type { TuesdayIssueResult as TuesdayBudgetTuneResult }

/**
 * Only suggestions that already carry a before and after amount become cards.
 * The weekly read does not invent those numbers.
 */
export function planTuesdayBudgetTunes(summary: WeeklyCheckSummary): readonly WeeklyBudgetSuggestion[] {
  return summary.budgetSuggestions ?? []
}

export async function runTuesdayBudgetTune(
  openKernel: () => KernelDeps,
  summary: WeeklyCheckSummary,
  now?: Date,
): Promise<TuesdayIssueResult[]> {
  const proposals = planTuesdayBudgetTunes(summary)
  if (proposals.length === 0) return []
  const kernel = openKernel()
  const clock = now ?? kernel.now()
  return issueTuesdayBudgetTunes(kernel, proposals, productionTuesdayPorts(kernel.supabase, clock), clock)
}
