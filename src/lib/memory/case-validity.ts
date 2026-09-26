/**
 * Is an action a valid learning case right now?
 *
 * ONE function decides it, and the memory extractor uses it both to switch a memory ON
 * (step 4) and to switch it OFF (reconcile step) — so within one run the two can never
 * disagree and a memory cannot be opened and closed again. It applies only to pillars in
 * EXECUTION_GATED_FLYWHEELS; other pillars keep the extractor's original path.
 *
 * Checks, first match wins:
 *   action_missing        the memory points at an action row that no longer exists
 *   no_execution_evidence an AI suggestion that was never carried out
 *   no_outcome            the action has no outcome row at all
 *   direction_unknown     the pillar's verdict direction cannot be trusted yet (ads:
 *                         cost metrics are scored "up = success"; its owner is fixing it)
 *   site_level_metric     the action's representative reading is a whole-site metric —
 *                         decided by rule, whatever its age
 *   stale                 no outcome row recomputed within OUTCOME_FRESH_DAYS
 *   immature              the representative reading's window has not ended yet; the
 *                         verdict still moves day to day, so neither open nor close
 *   no_strong_verdict     the current verdict is not confirmed/reversed at MIN confidence
 * The first five are decided by a rule and do not depend on attribution having re-run
 * recently; `stale` and `no_strong_verdict` do (see RULE_BASED_REASONS).
 */

import {
  effectiveVerdict,
  isSiteLevelUnattributable,
  keepOneCasePerAction,
} from '@/lib/flywheel/attribution/outcome-identity'
import {
  isUnexecutedSuggestion,
  type ExecutionEvidence,
} from '@/lib/flywheel/attribution/execution-evidence'
import type { FlywheelName } from './types'

/** Pillars whose memories must come from an executed action with a valid verdict. geo waits for its owner. */
export const EXECUTION_GATED_FLYWHEELS: readonly FlywheelName[] = ['seo', 'ads']

/** Pillars whose verdict direction cannot be trusted yet — deactivate only, never open. */
export const DIRECTION_UNKNOWN_FLYWHEELS: readonly FlywheelName[] = ['ads']

/** Outcome rows not recomputed within this many days are not current evidence. */
export const OUTCOME_FRESH_DAYS = 7

/** Minimum outcome confidence for a verdict to count as strong. */
export const MIN_OUTCOME_CONFIDENCE = 0.6

export interface CaseAction extends ExecutionEvidence {
  id: string
  flywheel: FlywheelName
  executed_at: string
  expected_metric: string | null
}

export interface CaseOutcome {
  id: string
  action_id: string
  metric_key: string
  window_days: number | null
  verdict: string
  confidence: number | null
  computed_at: string
}

export type CaseReason =
  | 'action_missing'
  | 'no_execution_evidence'
  | 'no_outcome'
  | 'direction_unknown'
  | 'site_level_metric'
  | 'stale'
  | 'immature'
  | 'no_strong_verdict'

export type CaseStatus =
  | { kind: 'valid'; side: 'proven' | 'failed'; representative: CaseOutcome }
  | { kind: 'invalid'; reason: CaseReason }

/** Reasons decided by a rule, independent of whether attribution re-ran recently. */
export const RULE_BASED_REASONS: ReadonlySet<CaseReason> = new Set<CaseReason>([
  'action_missing',
  'no_execution_evidence',
  'no_outcome',
  'direction_unknown',
  'site_level_metric',
])

export function isGatedFlywheel(flywheel: string | null | undefined): boolean {
  return flywheel != null && (EXECUTION_GATED_FLYWHEELS as readonly string[]).includes(flywheel)
}

function invalid(reason: CaseReason): CaseStatus {
  return { kind: 'invalid', reason }
}

export function classifyActionCase(input: {
  action: CaseAction | null
  outcomes: readonly CaseOutcome[]
  now: Date
}): CaseStatus {
  const { action, outcomes, now } = input
  if (!action) return invalid('action_missing')
  if (isUnexecutedSuggestion(action)) return invalid('no_execution_evidence')
  if (outcomes.length === 0) return invalid('no_outcome')
  if ((DIRECTION_UNKNOWN_FLYWHEELS as readonly string[]).includes(action.flywheel)) {
    return invalid('direction_unknown')
  }

  const withPromise = outcomes.map((o) => ({ ...o, expected_metric: action.expected_metric }))

  // Site-level is decided on ALL rows, before freshness: it is a rule, not a staleness.
  const [overall] = keepOneCasePerAction(withPromise)
  if (overall && isSiteLevelUnattributable(overall.metric_key)) return invalid('site_level_metric')

  // Filter to fresh rows FIRST, then fold: a stale strong row must not represent the
  // action just because another of its metrics was recomputed recently.
  const cutoff = now.getTime() - OUTCOME_FRESH_DAYS * 86_400_000
  const fresh = withPromise.filter((o) => {
    const t = Date.parse(o.computed_at)
    // An unreadable timestamp is kept: an unknown format is not the same as "old".
    return Number.isNaN(t) || t >= cutoff
  })
  const [rep] = keepOneCasePerAction(fresh)
  if (!rep) return invalid('stale')
  if (isSiteLevelUnattributable(rep.metric_key)) return invalid('site_level_metric')

  const executedAt = Date.parse(action.executed_at)
  const windowMs = (rep.window_days ?? 0) * 86_400_000
  if (Number.isNaN(executedAt) || now.getTime() < executedAt + windowMs) return invalid('immature')

  const verdict = effectiveVerdict(rep)
  if ((verdict === 'confirmed' || verdict === 'reversed') && (rep.confidence ?? 0) >= MIN_OUTCOME_CONFIDENCE) {
    return { kind: 'valid', side: verdict === 'confirmed' ? 'proven' : 'failed', representative: rep }
  }
  return invalid('no_strong_verdict')
}
