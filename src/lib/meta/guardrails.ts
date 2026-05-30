/**
 * Meta Ads safety guardrails — P18.A
 *
 * Auto-executable budget changes are capped at ±20% of the current daily
 * budget. Larger swings are a strategy decision, not a safe tweak, so they
 * must route to manual review ("Talk to Us") instead of being applied live.
 */

export const MAX_BUDGET_ADJUSTMENT_RATIO = 0.2 // ±20%

export interface BudgetGuardrailResult {
  ok: boolean
  allowedMinCents: number
  allowedMaxCents: number
}

/**
 * Check whether a proposed daily budget (in minor units / cents) is within the
 * ±20% safe-adjustment band of the current budget. Bounds are rounded outward
 * so a change of exactly ±20% is allowed. A non-positive current budget yields
 * an empty band (ok = false), forcing manual review.
 */
export function checkBudgetWithinSafeRange(
  currentCents: number,
  newCents: number,
): BudgetGuardrailResult {
  const allowedMinCents = Math.floor(currentCents * (1 - MAX_BUDGET_ADJUSTMENT_RATIO))
  const allowedMaxCents = Math.ceil(currentCents * (1 + MAX_BUDGET_ADJUSTMENT_RATIO))

  return {
    ok: currentCents > 0 && newCents >= allowedMinCents && newCents <= allowedMaxCents,
    allowedMinCents,
    allowedMaxCents,
  }
}
