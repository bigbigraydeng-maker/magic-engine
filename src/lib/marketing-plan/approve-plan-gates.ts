import type { ApprovalVerdict, GateResult } from '@/lib/marketing-plan/promo/gates'

/**
 * Applicable checks that are not green, on every evaluated phase.
 *
 * Co-approval refuses unless this list is empty. Due or later, hard or soft,
 * yellow, gray, or red all count. A later phase's yellow budget gate is not in
 * `deferred_blockers` (that list is only hard red/gray), so it has to be read
 * from the phase results. Plan-page approval does not use this.
 */
export function hardNotGreen(verdict: ApprovalVerdict): GateResult[] {
  return verdict.per_phase.flatMap(phase => phase.results).filter(result => result.light !== 'green')
}
