import type { ApprovalVerdict, GateResult } from '@/lib/marketing-plan/promo/gates'

/** Hard checks that are not green, across due phases and later phases that still must be filled in. */
export function hardNotGreen(verdict: ApprovalVerdict): GateResult[] {
  const dueHard = verdict.per_phase
    .filter(p => p.due)
    .flatMap(p => p.results)
    .filter(r => r.hard && r.light !== 'green')
  const seen = new Set(dueHard)
  return [...dueHard, ...verdict.deferred_blockers.filter(r => !seen.has(r))]
}
