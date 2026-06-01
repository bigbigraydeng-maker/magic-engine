/**
 * TikTok Ads budget guardrails — P18.C
 *
 * Mirrors lib/meta/guardrails.ts and lib/google-ads/guardrails.ts.
 * Hard-limits budget adjustments to ±20% of the current daily budget.
 *
 * TikTok Ads budgets are in whole currency units (AUD/NZD), unlike
 * Google Ads which uses micro-currency. No conversion needed here.
 */

export const MAX_BUDGET_ADJUSTMENT_RATIO = 0.2   // ±20%

export interface BudgetGuardrailResult {
  ok:       boolean
  reason?:  string
  minBudget?: number
  maxBudget?: number
}

/**
 * Check that `newBudget` is within ±20% of `currentBudget`.
 *
 * @param currentBudget  Current daily budget in advertiser currency (whole units)
 * @param newBudget      Proposed new daily budget in advertiser currency (whole units)
 */
export function checkBudgetWithinSafeRange(
  currentBudget: number,
  newBudget: number,
): BudgetGuardrailResult {
  if (currentBudget <= 0) {
    return {
      ok:     false,
      reason: 'Current budget is zero or negative — cannot compute safe range.',
    }
  }

  if (newBudget <= 0) {
    return {
      ok:     false,
      reason: 'New budget must be a positive number.',
    }
  }

  const minBudget = currentBudget * (1 - MAX_BUDGET_ADJUSTMENT_RATIO)
  const maxBudget = currentBudget * (1 + MAX_BUDGET_ADJUSTMENT_RATIO)

  if (newBudget < minBudget || newBudget > maxBudget) {
    return {
      ok:     false,
      reason: `Budget change exceeds ±${MAX_BUDGET_ADJUSTMENT_RATIO * 100}% limit. ` +
              `Allowed range: $${minBudget.toFixed(2)} – $${maxBudget.toFixed(2)}. ` +
              `For larger changes, use Talk to Us.`,
      minBudget,
      maxBudget,
    }
  }

  return { ok: true, minBudget, maxBudget }
}

/**
 * Format a TikTok Ads budget value for display.
 * e.g. 50 → "$50.00"
 */
export function budgetToDisplay(amount: number): string {
  return `$${amount.toFixed(2)}`
}
