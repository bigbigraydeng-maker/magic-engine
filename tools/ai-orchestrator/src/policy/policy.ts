/**
 * Policy envelope: the limits and grants the runner checks before and after
 * every agent turn.
 *
 * Nothing here calls out to the network or reads a database. It is pure
 * evaluation over already-parsed values so the tests can drive every branch.
 *
 * The scope and tool checks take **authoritative facts** — git, GitHub, the
 * execution harness — not the model's description of its own turn. An agent that
 * under-reports a file it touched or a tool it ran must not thereby escape them.
 */

import type {
  AuthoritativeTurnFacts,
  ImplementerTurnOutput,
  OrchestrationRun,
  SideEffectClass,
  StopReason,
  WorkPackageAuthorization,
  WorkPackageScope,
} from '../domain/schema'
import { ALWAYS_PROHIBITED_OPERATIONS } from '../domain/schema'
import type { BudgetLedger } from '../domain/budget'
import { committedSpend, remainingBudget } from '../domain/budget'
import { matchesAnyWildcard, selectMatching, selectNotMatching } from './glob'
import { selectProtected, selectSelfModifyingPatterns } from './protected-paths'

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorLimits {
  /** One round == one agent turn. */
  max_rounds: number
  cost_cap_usd: number
  /**
   * Floor used by preflight, before a prompt exists to quote.
   *
   * NOT the reservation: since pricing became provider-quoted, the amount
   * reserved is `maxCostFor(request).max_cost_usd`, and the budget gate compares
   * the remaining balance against that quote. This value only bounds the
   * pre-prompt estimate and is validated against `cost_cap_usd`.
   */
  max_turn_cost_usd: number
  /** Output-token ceiling handed to the provider so one call cannot blow the reservation. */
  max_output_tokens: number
  max_wall_clock_ms: number
  /** Hard wall on one provider call. Must be shorter than the lease TTL. */
  provider_timeout_ms: number
  /** Safety gap between the end of a call and the end of the lease. */
  lease_margin_ms: number
  /** How many schema-invalid provider outputs before the run is declared FAILED. */
  max_invalid_outputs: number
}

export const DEFAULT_LIMITS: OrchestratorLimits = {
  max_rounds: 6,
  cost_cap_usd: 2,
  max_turn_cost_usd: 0.5,
  max_output_tokens: 16_000,
  max_wall_clock_ms: 20 * 60 * 1000,
  provider_timeout_ms: 8 * 60 * 1000,
  lease_margin_ms: 2 * 60 * 1000,
  max_invalid_outputs: 2,
}

// ─────────────────────────────────────────────────────────────────────────────
// Kill switch — default off
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tools no work package may grant, whatever its own lists say.
 *
 * This used to live in the Claude adapter with a comment claiming
 * `enforceToolUse` applied it. Nothing read it — the constant and the check had
 * never been connected, and the two lists had already drifted (`Bash(render*)`
 * was here and missing from the scaffold's disallowed list). It lives here now,
 * next to the function that actually consults it.
 */
export const NEVER_ALLOWED_TOOLS = [
  'Bash(gh pr merge*)',
  'Bash(git push*)',
  'Bash(git push --force*)',
  'Bash(git push -f*)',
  'Bash(npx supabase*)',
  'Bash(render*)',
  'Bash(curl*)',
  'WebFetch',
] as const

/**
 * The complete set of tools a reviewer turn may use. Everything else is denied.
 *
 * This is an allowlist of its own, not a filter over the work package's, and that
 * distinction is the fix: checking the reviewer against
 * `authorization.scope.allowed_tools` handed it the *implementer's* grant, which
 * in the scaffold includes `Write`, `Edit`, `Bash(git commit*)` and
 * `Bash(gh pr create*)`. A reviewer described everywhere as read-only would then
 * have written to the repository and passed the audit as compliant.
 *
 * The work package can narrow this further through `disallowed_tools`; nothing
 * can widen it, because widening would require editing this file — which is
 * inside `PROTECTED_PATHS`.
 */
export const REVIEWER_READ_ONLY_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Bash(git diff*)',
  'Bash(git log*)',
  'Bash(git show*)',
  'Bash(git status*)',
  'Bash(gh pr view*)',
  'Bash(gh pr diff*)',
  'Bash(gh issue view*)',
] as const

export const ENABLE_ENV_VAR = 'ME2_ORCHESTRATOR_ENABLED'
export const KILL_SWITCH_LABEL = 'me2-orchestrator:stop'

export interface KillSwitchInput {
  /** The workflow_dispatch `enabled` input. Defaults to false in the workflow. */
  workflowEnabledInput: boolean
  env: Readonly<Record<string, string | undefined>>
  issueLabels: readonly string[]
}

export interface KillSwitchResult {
  stopped: boolean
  reason: string | null
}

/**
 * Three independent ways to stop, all fail-closed. The env var must be the exact
 * string "true"; anything else — unset, empty, "1", "yes" — keeps the run off.
 */
export function evaluateKillSwitch(input: KillSwitchInput): KillSwitchResult {
  if (input.issueLabels.includes(KILL_SWITCH_LABEL)) {
    return { stopped: true, reason: `kill switch label "${KILL_SWITCH_LABEL}" is present` }
  }
  if (!input.workflowEnabledInput) {
    return { stopped: true, reason: 'workflow input `enabled` is false (default)' }
  }
  if (input.env[ENABLE_ENV_VAR] !== 'true') {
    return { stopped: true, reason: `${ENABLE_ENV_VAR} is not "true" (default off)` }
  }
  return { stopped: false, reason: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration invariants — checked before anything can be spent
// ─────────────────────────────────────────────────────────────────────────────

export interface TimingInvariantResult {
  ok: boolean
  message: string
}

/**
 * A provider call must finish well inside the lease.
 *
 * If a lease can expire while a call is still running, a second runner will take
 * the lease over and start a second paid call for the same turn — and no amount
 * of after-the-fact deduplication gets that money back. Checking the relationship
 * up front, and failing closed, is the only place this can be prevented.
 */
export function checkTimingInvariant(
  limits: OrchestratorLimits,
  leaseTtlMs: number,
  /**
   * How long a call can still be running after we stop waiting. Equal to our own
   * timeout when the provider genuinely cancels; equal to the provider's
   * server-side maximum when it does not — because then our timeout bounds
   * nothing and the lease has to cover the real worst case.
   */
  inFlightWindowMs: number = limits.provider_timeout_ms
): TimingInvariantResult {
  const required = inFlightWindowMs + limits.lease_margin_ms
  if (leaseTtlMs < required) {
    return {
      ok: false,
      message:
        `lease TTL ${leaseTtlMs}ms is shorter than the ${inFlightWindowMs}ms in-flight window ` +
        `+ ${limits.lease_margin_ms}ms margin; ` +
        'a lease could lapse mid-call and let a second runner start a duplicate paid call',
    }
  }
  if (limits.max_turn_cost_usd > limits.cost_cap_usd) {
    return {
      ok: false,
      message: `max_turn_cost_usd $${limits.max_turn_cost_usd} exceeds cost_cap_usd $${limits.cost_cap_usd}`,
    }
  }
  if (limits.max_turn_cost_usd <= 0) {
    return { ok: false, message: 'max_turn_cost_usd must be positive; a zero reservation reserves nothing' }
  }
  return { ok: true, message: 'timing and budget invariants hold' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget
// ─────────────────────────────────────────────────────────────────────────────

export type BudgetResult =
  | { ok: true; remaining_usd: number }
  | { ok: false; stop_reason: StopReason; message: string; remaining_usd: number }

/**
 * The three places a round or dollar ceiling can come from, reconciled.
 *
 * The authorization is the one a human actually signed. The run and the
 * deployment limits are configuration, and configuration is not approval: a run
 * constructed with `$2 / 6 rounds` under a work package a human approved for
 * `$0.50 / 2 rounds` must stop at the smaller pair. Taking the minimum of all
 * three is what makes the grant a hard ceiling instead of a suggestion the run
 * config can quietly out-vote.
 */
export interface EffectiveCaps {
  cost_cap_usd: number
  max_rounds: number
  /** Which of the three is binding, for the stop message. */
  cost_source: string
  rounds_source: string
}

export function effectiveCaps(
  run: OrchestrationRun,
  authorization: WorkPackageAuthorization,
  limits: OrchestratorLimits
): EffectiveCaps {
  const costs: readonly (readonly [string, number])[] = [
    ['run', run.cost_cap_usd],
    ['deployment limits', limits.cost_cap_usd],
    [`authorization ${authorization.work_package_id}`, authorization.cost_cap_usd],
  ]
  const rounds: readonly (readonly [string, number])[] = [
    ['run', run.max_rounds],
    ['deployment limits', limits.max_rounds],
    [`authorization ${authorization.work_package_id}`, authorization.max_rounds],
  ]

  const tightest = (
    candidates: readonly (readonly [string, number])[]
  ): readonly [string, number] =>
    candidates.reduce((best, candidate) => (candidate[1] < best[1] ? candidate : best))

  const [costSource, costCap] = tightest(costs)
  const [roundsSource, roundCap] = tightest(rounds)

  return {
    cost_cap_usd: costCap,
    max_rounds: roundCap,
    cost_source: costSource,
    rounds_source: roundsSource,
  }
}

/**
 * The pre-flight budget gate.
 *
 * `remaining` subtracts settled spend, live reservations and orphaned
 * reservations alike, and the turn only proceeds if the whole `requiredUsd` —
 * the provider's own worst-case quote for this specific call — still fits. That
 * is what makes the cap a ceiling rather than a tripwire.
 */
export function checkBudget(
  run: OrchestrationRun,
  /** The signed grant. Its `max_rounds` and `cost_cap_usd` bind like any other cap. */
  authorization: WorkPackageAuthorization,
  limits: OrchestratorLimits,
  ledger: BudgetLedger,
  now: Date,
  /**
   * The worst case this specific turn could cost, from the provider's own price
   * table. Falls back to the configured floor only in preflight, before a prompt
   * exists to quote.
   */
  requiredUsd: number = limits.max_turn_cost_usd
): BudgetResult {
  const caps = effectiveCaps(run, authorization, limits)
  const costCap = caps.cost_cap_usd
  const remaining = remainingBudget(costCap, ledger)

  const roundCap = caps.max_rounds
  if (run.current_round >= roundCap) {
    return {
      ok: false,
      stop_reason: 'max_rounds_reached',
      message: `round ${run.current_round} reached the cap of ${roundCap} (${caps.rounds_source})`,
      remaining_usd: remaining,
    }
  }

  if (remaining < requiredUsd) {
    return {
      ok: false,
      stop_reason: 'cost_cap_reached',
      message:
        `remaining budget $${remaining.toFixed(6)} cannot cover the ` +
        `$${requiredUsd.toFixed(6)} worst case this turn requires ` +
        `(committed $${committedSpend(ledger).toFixed(6)} of $${costCap.toFixed(6)} ` +
        `from ${caps.cost_source})`,
      remaining_usd: remaining,
    }
  }

  if (now.getTime() >= Date.parse(run.deadline_at)) {
    return {
      ok: false,
      stop_reason: 'wall_clock_exceeded',
      message: `wall-clock deadline ${run.deadline_at} has passed`,
      remaining_usd: remaining,
    }
  }

  return { ok: true, remaining_usd: remaining }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope / tool / side-effect enforcement
// ─────────────────────────────────────────────────────────────────────────────

export type PolicyViolationCode =
  | 'PROTECTED_PATH_TOUCHED'
  | 'PATH_OUT_OF_SCOPE'
  | 'PATH_EXPLICITLY_DENIED'
  | 'TOOL_NOT_ALLOWED'
  | 'COMMIT_NOT_AUTHORIZED'
  | 'PR_NOT_AUTHORIZED'
  | 'AUTHORIZATION_EXPIRED'
  | 'SIDE_EFFECT_CLASS_NOT_ALLOWED'
  | 'PROHIBITED_OPERATION_MISSING'
  | 'SELF_MODIFYING_SCOPE'
  | 'PR_ALREADY_MERGED'
  | 'PUSH_NOT_AUTHORIZED'
  | 'REMOTE_FACTS_UNAVAILABLE'
  /** A reviewer turn used a write tool, or the repository moved underneath it. */
  | 'REVIEWER_NOT_READ_ONLY'

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: PolicyViolationCode; message: string; offending: readonly string[] }

const ALLOWED: PolicyDecision = { allowed: true }

function deny(
  code: PolicyViolationCode,
  message: string,
  offending: readonly string[] = []
): PolicyDecision {
  return { allowed: false, code, message, offending }
}

export function enforceProtectedPaths(files: readonly string[]): PolicyDecision {
  const offending = selectProtected(files)
  if (offending.length > 0) {
    return deny(
      'PROTECTED_PATH_TOUCHED',
      'turn changed the control plane that governs it',
      offending
    )
  }
  return ALLOWED
}

export function enforceFileScope(scope: WorkPackageScope, files: readonly string[]): PolicyDecision {
  const denied = selectMatching(files, scope.denied_paths)
  if (denied.length > 0) {
    return deny('PATH_EXPLICITLY_DENIED', 'turn touched explicitly denied paths', denied)
  }

  const outOfScope = selectNotMatching(files, scope.allowed_paths)
  if (outOfScope.length > 0) {
    return deny('PATH_OUT_OF_SCOPE', 'turn touched paths outside the authorized scope', outOfScope)
  }

  return ALLOWED
}

export function enforceToolUse(scope: WorkPackageScope, tools: readonly string[]): PolicyDecision {
  // Checked first and independently of the work package: a scope that allows
  // `Bash(*)` must not thereby allow `gh pr merge`.
  const forbidden = tools.filter((tool) => matchesAnyWildcard(tool, NEVER_ALLOWED_TOOLS))
  if (forbidden.length > 0) {
    return deny(
      'TOOL_NOT_ALLOWED',
      'turn used a tool that no work package may grant',
      forbidden
    )
  }

  const offending = tools.filter(
    (tool) =>
      matchesAnyWildcard(tool, scope.disallowed_tools) ||
      !matchesAnyWildcard(tool, scope.allowed_tools)
  )
  if (offending.length > 0) {
    return deny('TOOL_NOT_ALLOWED', 'turn used tools outside the allowlist', offending)
  }
  return ALLOWED
}

/**
 * Tool enforcement for a reviewer turn.
 *
 * Deliberately does NOT consult `scope.allowed_tools`: the reviewer's ceiling is
 * `REVIEWER_READ_ONLY_TOOLS`, and the work package only ever narrows it. Passing
 * the scope in at all is for `disallowed_tools`, so a work package that wants an
 * even quieter reviewer gets one.
 */
export function enforceReviewerToolUse(
  scope: WorkPackageScope,
  tools: readonly string[]
): PolicyDecision {
  const forbidden = tools.filter((tool) => matchesAnyWildcard(tool, NEVER_ALLOWED_TOOLS))
  if (forbidden.length > 0) {
    return deny(
      'TOOL_NOT_ALLOWED',
      'reviewer used a tool that no work package may grant',
      forbidden
    )
  }

  const narrowed = tools.filter((tool) => matchesAnyWildcard(tool, scope.disallowed_tools))
  if (narrowed.length > 0) {
    return deny(
      'TOOL_NOT_ALLOWED',
      'reviewer used a tool this work package explicitly disallows',
      narrowed
    )
  }

  const notReadOnly = tools.filter((tool) => !matchesAnyWildcard(tool, REVIEWER_READ_ONLY_TOOLS))
  if (notReadOnly.length > 0) {
    return deny(
      'REVIEWER_NOT_READ_ONLY',
      'reviewer used a tool outside the read-only set; the reviewer never gets the ' +
        "implementer's write grant",
      notReadOnly
    )
  }

  return ALLOWED
}

/**
 * The workspace proof that a reviewer turn really was read-only.
 *
 * The tool allowlist above is checked against harness telemetry, which is an
 * authoritative record — but it is a record of *tool calls*, and it can only
 * catch a write that went through a tool the harness names. This asks the
 * repository instead: did anything move while the reviewer was running?
 *
 * Evaluated on the delta, never the cumulative set. Files the implementer changed
 * in round 2 are still there in round 3, and blaming the reviewer for them would
 * make the check fire on every honest run — which is how a check gets deleted.
 */
export function evaluateReviewerTurn(facts: AuthoritativeTurnFacts): PolicyDecision {
  if (!facts.remote_facts_available) {
    return deny(
      'REMOTE_FACTS_UNAVAILABLE',
      'the remote ref could not be read, so a push during the reviewer turn cannot be ruled out'
    )
  }

  if (facts.files_changed.length > 0) {
    return deny(
      'REVIEWER_NOT_READ_ONLY',
      'the working tree changed during the reviewer turn; the reviewer may not write',
      facts.files_changed
    )
  }

  if (facts.commit) {
    return deny('REVIEWER_NOT_READ_ONLY', 'the reviewer turn created a commit', [facts.commit.sha])
  }

  if (facts.pushed_this_turn) {
    const delta = facts.remote_head_delta
    return deny(
      'REVIEWER_NOT_READ_ONLY',
      'the tracked remote ref moved during the reviewer turn',
      delta ? [`${delta.ref}: ${delta.before_sha ?? 'none'} -> ${delta.after_sha ?? 'none'}`] : []
    )
  }

  if (facts.pull_request_opened_this_turn) {
    return deny('REVIEWER_NOT_READ_ONLY', 'the reviewer turn opened a pull request', [
      String(facts.pull_request?.number ?? 'unknown'),
    ])
  }

  if (facts.pull_request?.merged) {
    return deny('PR_ALREADY_MERGED', 'the pull request is merged; merging is never authorized', [
      String(facts.pull_request.number),
    ])
  }

  return ALLOWED
}

export function enforceAuthorizationWindow(
  authorization: WorkPackageAuthorization,
  now: Date
): PolicyDecision {
  if (Date.parse(authorization.expires_at) <= now.getTime()) {
    return deny(
      'AUTHORIZATION_EXPIRED',
      `work package ${authorization.work_package_id} expired at ${authorization.expires_at}`
    )
  }

  const declared = new Set(authorization.prohibited_operations)
  const missing = ALWAYS_PROHIBITED_OPERATIONS.filter((op) => !declared.has(op))
  if (missing.length > 0) {
    return deny(
      'PROHIBITED_OPERATION_MISSING',
      'authorization does not prohibit every always-prohibited operation',
      missing
    )
  }

  // Belt and braces: the schema already refuses to parse one of these, but the
  // check is cheap and the property is important enough to assert twice.
  const selfModifying = selectSelfModifyingPatterns(authorization.scope.allowed_paths)
  if (selfModifying.length > 0) {
    return deny(
      'SELF_MODIFYING_SCOPE',
      'authorization grants paths inside the orchestrator control plane',
      selfModifying
    )
  }

  return ALLOWED
}

export function enforceSideEffectClass(
  authorization: WorkPackageAuthorization,
  permitted: readonly SideEffectClass[]
): PolicyDecision {
  if (!permitted.includes(authorization.side_effect_class)) {
    return deny(
      'SIDE_EFFECT_CLASS_NOT_ALLOWED',
      `side effect class "${authorization.side_effect_class}" is not permitted in this deployment`,
      [authorization.side_effect_class]
    )
  }
  return ALLOWED
}

/**
 * The single call the runner makes after an implementer turn.
 *
 * Takes authoritative facts, not the model's output. Order matters:
 * self-protection first, then scope, then tools, then write permissions — so the
 * most serious violation is the one that gets reported.
 */
export function evaluateImplementerTurn(
  authorization: WorkPackageAuthorization,
  facts: AuthoritativeTurnFacts
): PolicyDecision {
  // Path rules run against the cumulative set as well as this turn's delta: a
  // protected or out-of-scope file introduced two rounds ago is still a breach,
  // and it must not become invisible just because this round did not touch it.
  const checks: readonly PolicyDecision[] = [
    enforceProtectedPaths(facts.cumulative_files_changed),
    enforceFileScope(authorization.scope, facts.cumulative_files_changed),
    enforceToolUse(authorization.scope, facts.tools_used),
  ]

  const violation = checks.find((decision) => !decision.allowed)
  if (violation) return violation

  // Pushing is never authorized in the scaffold (`can_push` is `z.literal(false)`),
  // so any movement of the tracked remote ref is a breach — and it has to be
  // established from the remote itself, because a local commit moves HEAD without
  // publishing anything. Not being able to read the remote is a refusal, not a pass:
  // "we did not see a push" and "we could not look" are different answers.
  if (!facts.remote_facts_available) {
    return deny(
      'REMOTE_FACTS_UNAVAILABLE',
      'the remote ref could not be read, so a push cannot be ruled out'
    )
  }

  if (facts.pushed_this_turn) {
    const delta = facts.remote_head_delta
    return deny(
      'PUSH_NOT_AUTHORIZED',
      'the tracked remote ref moved during this turn; pushing is never authorized here',
      delta ? [`${delta.ref}: ${delta.before_sha ?? 'none'} -> ${delta.after_sha ?? 'none'}`] : []
    )
  }

  // Write permissions run against the delta only. Round 2 must not be blamed for
  // round 1's commit, and "the repository has a HEAD" is not evidence that this
  // turn committed anything.
  if (facts.commit && !authorization.scope.can_commit) {
    return deny('COMMIT_NOT_AUTHORIZED', 'this turn created a commit but committing is not authorized', [
      facts.commit.sha,
    ])
  }

  if (facts.pull_request_opened_this_turn && !authorization.scope.can_open_draft_pr) {
    return deny('PR_NOT_AUTHORIZED', 'this turn opened a pull request but that is not authorized', [
      String(facts.pull_request?.number ?? 'unknown'),
    ])
  }

  if (facts.pull_request?.merged) {
    return deny('PR_ALREADY_MERGED', 'the pull request is merged; merging is never authorized', [
      String(facts.pull_request.number),
    ])
  }

  return ALLOWED
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-report comparison
// ─────────────────────────────────────────────────────────────────────────────

function diffSets(
  label: string,
  claimed: readonly string[],
  observed: readonly string[]
): string[] {
  const claimedSet = new Set(claimed)
  const observedSet = new Set(observed)
  const mismatches: string[] = []

  for (const value of observed) {
    if (!claimedSet.has(value)) mismatches.push(`${label}: under-reported "${value}"`)
  }
  for (const value of claimed) {
    if (!observedSet.has(value)) mismatches.push(`${label}: claimed "${value}" but it is not in the record`)
  }
  return mismatches
}

/**
 * Compares the model's account of its turn with what actually happened.
 *
 * The result never widens what is allowed — policy has already been decided on
 * the authoritative facts. It exists because an implementer whose self-report
 * does not match the record has either lost track of what it did or is
 * misrepresenting it, and neither is something to keep driving on.
 */
export function compareSelfReport(
  output: ImplementerTurnOutput,
  facts: AuthoritativeTurnFacts
): readonly string[] {
  const mismatches = [
    ...diffSets('files_changed', output.files_changed, facts.files_changed),
    ...diffSets('tools_used', output.tools_used, facts.tools_used),
  ]

  // Compared against this turn's delta: an implementer that reports round 1's
  // commit again in round 2 is misdescribing round 2.
  const claimedSha = output.commit_evidence?.commit_sha ?? null
  const actualSha = facts.commit?.sha ?? null
  if (claimedSha !== actualSha) {
    mismatches.push(`commit: reported ${claimedSha ?? 'none'} but this turn produced ${actualSha ?? 'none'}`)
  }

  const claimedPr = output.commit_evidence?.pr_number ?? null
  const actualPr = facts.pull_request?.number ?? null
  if (claimedPr !== actualPr) {
    mismatches.push(`pull_request: reported ${claimedPr ?? 'none'} but the record says ${actualPr ?? 'none'}`)
  }

  return mismatches
}
