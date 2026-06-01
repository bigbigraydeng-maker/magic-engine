/**
 * Google Ads safety guardrails — P18.B
 *
 * Auto-executable budget changes are capped at ±20% of the current daily
 * budget (in micro-currency units). Larger swings must route to manual
 * review ("Talk to Us") — identical policy to Meta Ads (P18.A).
 *
 * All amounts are in Google Ads micro-units: 1 AUD = 1_000_000 micros.
 */

export const MAX_BUDGET_ADJUSTMENT_RATIO = 0.2 // ±20%

export interface BudgetGuardrailResult {
  ok:              boolean
  allowedMinMicros: number
  allowedMaxMicros: number
}

/**
 * Check whether a proposed daily budget (in micro-currency units) is within
 * the ±20% safe-adjustment band. Bounds are rounded outward so a change of
 * exactly ±20% is allowed. A non-positive current budget yields ok = false.
 *
 * @param currentMicros  Current daily budget in micros (from Google Ads API)
 * @param newMicros      Proposed new daily budget in micros
 */
export function checkBudgetWithinSafeRange(
  currentMicros: number,
  newMicros: number,
): BudgetGuardrailResult {
  const allowedMinMicros = Math.floor(currentMicros * (1 - MAX_BUDGET_ADJUSTMENT_RATIO))
  const allowedMaxMicros = Math.ceil(currentMicros * (1 + MAX_BUDGET_ADJUSTMENT_RATIO))

  return {
    ok: currentMicros > 0 && newMicros >= allowedMinMicros && newMicros <= allowedMaxMicros,
    allowedMinMicros,
    allowedMaxMicros,
  }
}

/**
 * Convert micro-units to a human-readable currency string.
 * e.g. microsToDisplay(5000000) → "$5.00"
 */
export function microsToDisplay(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}
