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
 * safe-adjustment band of the current budget. The default band is ±20%.
 * A tighter per-client ratio may be passed; anything outside (0, 20%] fails
 * closed. Bounds are rounded outward so a change of exactly the ratio is
 * allowed. A non-positive current budget yields an empty band (ok = false).
 */
export function checkBudgetWithinSafeRange(
  currentCents: number,
  newCents: number,
  ratio: number = MAX_BUDGET_ADJUSTMENT_RATIO,
): BudgetGuardrailResult {
  const ratioOk = Number.isFinite(ratio) && ratio > 0 && ratio <= MAX_BUDGET_ADJUSTMENT_RATIO
  const band = ratioOk ? ratio : MAX_BUDGET_ADJUSTMENT_RATIO
  const { allowedMinCents, allowedMaxCents } = outwardBand(currentCents, band)

  return {
    ok: ratioOk && currentCents > 0 && newCents >= allowedMinCents && newCents <= allowedMaxCents,
    allowedMinCents,
    allowedMaxCents,
  }
}

/** One part in a million. Daily ratios are at most 20%, so this stays exact. */
const BAND_SCALE = 1_000_000

/**
 * Floor the lower edge and ceil the upper edge in integer arithmetic.
 * `Math.ceil(cents * 1.1)` is 111 for 100 cents, which would allow a jump
 * past the stated ratio.
 */
function outwardBand(
  currentCents: number,
  band: number,
): { allowedMinCents: number; allowedMaxCents: number } {
  if (!Number.isSafeInteger(currentCents)) {
    return {
      allowedMinCents: Math.floor(currentCents * (1 - band)),
      allowedMaxCents: Math.ceil(currentCents * (1 + band)),
    }
  }
  const units = BigInt(Math.round(band * BAND_SCALE))
  const current = BigInt(currentCents)
  const scale = BigInt(BAND_SCALE)
  return {
    allowedMinCents: Number((current * (scale - units)) / scale),
    allowedMaxCents: Number((current * (scale + units) + scale - 1n) / scale),
  }
}
