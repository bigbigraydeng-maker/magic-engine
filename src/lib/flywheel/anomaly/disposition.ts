/**
 * Disposition — how a detected problem is allowed to be handled.
 *
 * PM rule (2026-07-28), verbatim intent:
 *   costs nothing + not customer-facing + reversible  → `auto`
 *   touches money / goes outward / hard to undo (ANY) → `needs_approval`
 *
 * FIRST VERSION IS CLASSIFY-ONLY. Nothing is executed, including `auto`.
 * The point of v1 is to prove the judgement is right before any power is
 * handed over. Do not wire an executor to this without explicit PM sign-off.
 */

export type Disposition = 'auto' | 'needs_approval'

/**
 * The three properties of the REMEDY (not of the problem) that decide routing.
 * Each watcher rule declares these for the fix it would apply.
 */
export interface RemedyProfile {
  /** Would applying the fix spend, move, or commit money? */
  spendsMoney: boolean
  /** Would the result be visible to the client's audience or the client? */
  customerFacing: boolean
  /** Is undoing it slow, lossy, or impossible? */
  hardToReverse: boolean
}

export interface DispositionVerdict {
  disposition: Disposition
  /** Plain-language justification, stored so a human can audit the call. */
  reason: string
}

/**
 * Classify a remedy. Fails safe: anything that trips a single gate escalates.
 */
export function classifyDisposition(remedy: RemedyProfile): DispositionVerdict {
  const tripped: string[] = []
  if (remedy.spendsMoney) tripped.push('spends money')
  if (remedy.customerFacing) tripped.push('customer-facing')
  if (remedy.hardToReverse) tripped.push('hard to reverse')

  if (tripped.length > 0) {
    return {
      disposition: 'needs_approval',
      reason: `Needs a human: ${tripped.join(' + ')}.`,
    }
  }

  return {
    disposition: 'auto',
    reason: 'Safe to automate: costs nothing, stays internal, fully reversible.',
  }
}
