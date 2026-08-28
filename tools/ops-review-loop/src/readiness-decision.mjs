/**
 * Thin, shared wiring between `quality.mjs`'s two calls — `scoreDelivery` and
 * `decideReadiness` — used by both places that reach a final readiness
 * verdict: `handle-review.mjs` (a Codex review landed clean) and
 * `recheck-readiness.mjs` (an unsampled C-level PR's required CI just went
 * green). One shared function means the gate-construction shape cannot drift
 * between the two callers.
 *
 * Deliberately does NOT call `evaluateSpecializedEvidence` itself — the
 * caller already has to compute `categories` and `observedSpecializedEvidence`
 * to build `observedSignals` (the `specialized-evidence-complete` signal
 * depends on the same result), so computing it twice here would either
 * duplicate that work or silently use a different input. The caller passes
 * the finished `specialized` object straight into `gates`.
 *
 * `NEEDS_PRODUCT_DECISION` never comes out of this wiring: this function
 * never sets `gates.productDecisionNeeded`, and no caller in this tool does
 * either — a technical dead end from these signals is a technical problem,
 * not a business one, and routing it to the Product Owner as a "decision" is
 * exactly what the spec this module implements forbids.
 *
 * Pure module: no I/O. `tests/readiness-decision.test.ts` exercises it
 * offline.
 */
import { scoreDelivery, decideReadiness } from './quality.mjs'

/**
 * @param {{
 *   risk: string,
 *   observedSignals: Iterable<string>,
 *   specialized: {required: unknown[], missing: unknown[], complete: boolean, readable: boolean},
 *   shaMatches: boolean,
 *   evidenceReadable: boolean,
 *   requiredCiPassed: boolean|null,
 *   scopeGuardPassed: boolean|null,
 *   openBlockerCount: number|null,
 * }} input
 * @returns {{score: {total: number, dimensions: unknown[]}, decision: ReturnType<typeof decideReadiness>}}
 */
export function evaluateReadiness({
  risk,
  observedSignals,
  specialized,
  shaMatches,
  evidenceReadable,
  requiredCiPassed,
  scopeGuardPassed,
  openBlockerCount,
}) {
  const score = scoreDelivery({ signals: observedSignals })
  const gates = { evidenceReadable, shaMatches, requiredCiPassed, scopeGuardPassed, openBlockerCount, specialized }
  const decision = decideReadiness({ risk, score, gates, observedSignals })
  return { score, decision }
}
