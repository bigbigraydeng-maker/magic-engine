/**
 * One agent turn, from cost quote to ledger record.
 *
 * The ordering is the safety property:
 *
 *   call under AbortSignal -> conflict re-check -> cost reconciliation
 *   -> telemetry -> capture workspace AFTER, diff against BEFORE
 *   -> policy (on the delta) -> integrity
 *   -> only now parse the model's output, and compare it to the record
 *
 * Both actors run that order. The reviewer used to skip the workspace half of it
 * on the grounds that it is read-only, which left "read-only" as an assertion
 * with nothing checking it.
 *
 * The quote, the reservation and the BEFORE capture happen in `runner.ts` before
 * this is called. Nothing the model writes can change what any step above the
 * last one concludes. The shared mechanics live in `turn-plumbing.ts`.
 */

import type { CostEstimate, TurnRequest } from './adapters/provider-types'
import { diffWorkspaceStates } from './adapters/workspace/inspector'
import type { TurnDelta, WorkspaceState } from './adapters/workspace/inspector'
import { digest, turnIdempotencyKey } from './domain/digest'
import {
  buildImplementerHandoff,
  buildReviewerHandoff,
  fitHandoff,
  recentHandoffs,
  renderHandoffSection,
} from './domain/handoff'
import { nextStateForVerdict } from './domain/state-machine'
import type {
  Actor,
  AuthoritativeTurnFacts,
  ImplementerTurnOutput,
  LedgerEvent,
  ReviewerTurnOutput,
  WaitDescriptor,
} from './domain/schema'
import { implementerTurnOutputSchema, reviewerTurnOutputSchema } from './domain/schema'
import {
  compareSelfReport,
  enforceReviewerToolUse,
  evaluateImplementerTurn,
  evaluateReviewerTurn,
} from './policy/policy'
import { buildPromptEnvelope } from './policy/untrusted'
import { IMPLEMENTER_PROMPT_VERSION, IMPLEMENTER_SYSTEM_POLICY } from './prompts/implementer-system.v1'
import { REVIEWER_PROMPT_VERSION, REVIEWER_SYSTEM_POLICY } from './prompts/reviewer-system.v1'
import { applyTurnState, baseEvent, nextWaitId, record } from './runner-context'
import type { RunnerContext } from './runner-types'
import {
  checkCostReconciliation,
  checkTelemetry,
  factsFrom,
  handleProviderFailure,
  invokeProvider,
  recordDuplicateSpend,
  rejectTurn,
  turnClaimedElsewhere,
} from './turn-plumbing'
import type { TurnOutcome } from './turn-plumbing'

export { ProviderTimeoutError } from './turn-plumbing'
export type { TurnOutcome } from './turn-plumbing'

// ─────────────────────────────────────────────────────────────────────────────
// Prompt and quote
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptDraft {
  system: string
  user: string
  untrusted_sources: readonly string[]
  input_digest: string
  idempotency_key: string
  max_output_tokens: number
}

/**
 * Everything about a turn that is known before its price is quoted.
 *
 * The prompt is the task brief **plus the handoffs recorded on earlier turns**.
 * Without the second half every round restated the original brief at the other
 * agent: a reviewer's REQUEST_CHANGES findings never reached the implementer and
 * the implementer's result never came back to the reviewer, so the loop produced
 * repeated independent attempts rather than the review conversation it claims to.
 *
 * The handoffs come out of the ledger rather than out of memory because rounds do
 * not share a process — every dispatch folds the Issue comments to rebuild state.
 *
 * The digest covers the handoff text, so each round is a genuinely different
 * prompt and gets its own idempotency key. That is the intended behaviour: a
 * re-dispatch that reads the same ledger recomputes the same key and skips.
 */
export function draftTurn(ctx: RunnerContext, actor: Actor, round: number): PromptDraft {
  const systemPolicy = actor === 'gpt_reviewer' ? REVIEWER_SYSTEM_POLICY : IMPLEMENTER_SYSTEM_POLICY
  const promptVersion =
    actor === 'gpt_reviewer' ? REVIEWER_PROMPT_VERSION : IMPLEMENTER_PROMPT_VERSION

  const priorRounds = renderHandoffSection(recentHandoffs(ctx.events, ctx.run.run_id))

  const envelope = buildPromptEnvelope({
    systemPolicy,
    task: [
      `Run: ${ctx.run.run_id} · mode ${ctx.run.mode} · round ${round}/${ctx.run.max_rounds}`,
      `Work package: ${ctx.input.authorization.work_package_id}`,
      `Prompt version: ${promptVersion}`,
      '',
      ctx.input.taskBrief,
      ...(priorRounds ? ['', priorRounds] : []),
    ].join('\n'),
    untrusted: ctx.input.untrusted,
  })

  const inputDigest = digest([envelope.system, envelope.user])

  return {
    system: envelope.system,
    user: envelope.user,
    untrusted_sources: envelope.untrusted_sources,
    input_digest: inputDigest,
    idempotency_key: turnIdempotencyKey({
      runId: ctx.run.run_id,
      round,
      actor,
      inputDigest,
    }),
    max_output_tokens: ctx.input.limits.max_output_tokens,
  }
}

export function providerFor(ctx: RunnerContext, actor: Actor) {
  return actor === 'gpt_reviewer' ? ctx.deps.reviewer : ctx.deps.implementer
}

/**
 * How long the provider may still be running and billing after we stop waiting.
 *
 * When the adapter cannot prove it cancels, our timeout bounds nothing, so the
 * claim and the lease have to cover the provider's server-side maximum instead.
 */
export function inFlightWindowMs(ctx: RunnerContext, actor: Actor): number {
  const provider = providerFor(ctx, actor)
  return provider.cancellation.supported
    ? ctx.input.limits.provider_timeout_ms
    : provider.cancellation.server_max_timeout_ms
}

export function finalizeRequest(
  ctx: RunnerContext,
  draft: PromptDraft,
  round: number,
  estimate: CostEstimate,
  signal: AbortSignal
): TurnRequest {
  return {
    run_id: ctx.run.run_id,
    round,
    system: draft.system,
    user: draft.user,
    untrusted_sources: draft.untrusted_sources,
    input_digest: draft.input_digest,
    idempotency_key: draft.idempotency_key,
    timeout_ms: ctx.input.limits.provider_timeout_ms,
    signal,
    max_output_tokens: draft.max_output_tokens,
    reserved_cost_usd: estimate.max_cost_usd,
    cost_estimate: estimate,
  }
}

/**
 * The blocking reason a reviewer verdict parks the run on.
 *
 * Machine-readable because a human authorization has to name it in `grants`:
 * "carry on" is not an approval of "and that policy breach was fine".
 */
function reviewerBlockingReason(verdict: ReviewerTurnOutput['verdict']): string {
  return verdict === 'STOP_POLICY_VIOLATION'
    ? 'reviewer_stop_policy_violation'
    : 'reviewer_waiting_human'
}

export async function runReviewerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest,
  before: WorkspaceState
): Promise<TurnOutcome> {
  const result = await invokeProvider(
    (signal) => ctx.deps.reviewer.review({ ...request, signal }),
    request
  )
  if ('failed' in result) {
    return handleProviderFailure(ctx, 'gpt_reviewer', round, request, result.failed)
  }

  if (await turnClaimedElsewhere(ctx, request)) {
    return recordDuplicateSpend(ctx, 'gpt_reviewer', round, request, result.ok.usage.cost_usd)
  }

  const overrun = await checkCostReconciliation(
    ctx,
    'gpt_reviewer',
    round,
    request,
    result.ok.usage.cost_usd
  )
  if (overrun) return overrun

  const telemetryProblem = checkTelemetry(result.ok)
  if (telemetryProblem) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'missing_telemetry',
      detail: [telemetryProblem],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'halted', stop_reason: 'policy_violation', message: telemetryProblem }
  }

  // The reviewer gets its own read-only allowlist, NOT the work package's. The
  // scaffold's implementer grant includes Write, Edit, `git commit` and
  // `gh pr create`; checking the reviewer against it would have let every one of
  // those through and recorded the turn as a compliant read-only review.
  const toolDecision = enforceReviewerToolUse(
    ctx.input.authorization.scope,
    result.ok.telemetry.tools_used
  )
  if (!toolDecision.allowed) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'policy_violation',
      detail: [toolDecision.code, toolDecision.message, ...toolDecision.offending],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `${toolDecision.code}: ${toolDecision.message}`,
    }
  }

  // Second, independent proof: ask the repository whether anything moved. The
  // tool allowlist is a record of tool *calls*; this is a record of *effects*, and
  // an effect that arrived by some route the harness does not name still shows up
  // here. The implementer has had this pair of snapshots since v0.3; the reviewer,
  // the one actually described as read-only, had neither half.
  const after = await ctx.deps.workspace.capture()
  const delta: TurnDelta = diffWorkspaceStates(before, after)
  const facts = factsFrom(delta, result.ok.telemetry)

  const readOnly = evaluateReviewerTurn(facts)
  if (!readOnly.allowed) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'policy_violation',
      detail: [
        readOnly.code,
        readOnly.message,
        ...readOnly.offending,
        `evidence: ${facts.sources.workspace}`,
      ],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `${readOnly.code}: ${readOnly.message}`,
    }
  }

  const drift = await ctx.deps.integrity.drift()
  if (drift.length > 0) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'policy_integrity_drift',
      detail: [...drift, `evidence: ${ctx.deps.integrity.name}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `control-plane files changed during the reviewer turn: ${drift.join(', ')}`,
    }
  }

  const parsed = reviewerTurnOutputSchema.safeParse(result.ok.output)
  if (!parsed.success) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'invalid_output',
      detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      nextState: ctx.run.state,
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'retry' }
  }

  const output: ReviewerTurnOutput = parsed.data
  ctx.run = { ...ctx.run, current_round: round }
  const nextState = applyTurnState(ctx, nextStateForVerdict(ctx.run.mode, output.verdict))

  // A WAITING_HUMAN or STOP_POLICY_VIOLATION verdict parks the run on a turn that
  // *completed*. Without a named wait here the block was invisible to
  // `currentOpenWait`, so no authorization could name it and the run could never
  // be released by anyone.
  const wait: WaitDescriptor | null =
    nextState === 'WAITING_HUMAN'
      ? { id: nextWaitId(ctx), blocking_reason: reviewerBlockingReason(output.verdict) }
      : null

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_completed',
    actor: 'gpt_reviewer',
    round,
    idempotency_key: request.idempotency_key,
    input_digest: request.input_digest,
    verdict: output.verdict,
    reserved_cost_usd: request.reserved_cost_usd,
    cost_usd: result.ok.usage.cost_usd,
    pricing_version: request.cost_estimate.pricing_version,
    output_digest: digest(output),
    authoritative: facts,
    self_report_mismatches: [],
    // What the implementer's next prompt is built from.
    handoff: fitHandoff(buildReviewerHandoff(output)),
    wait,
    next_state: nextState,
  })

  return { kind: 'advanced' }
}

export async function runImplementerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest,
  before: WorkspaceState
): Promise<TurnOutcome> {
  const result = await invokeProvider(
    (signal) => ctx.deps.implementer.implement({ ...request, signal }),
    request
  )
  if ('failed' in result) {
    return handleProviderFailure(ctx, 'claude_implementer', round, request, result.failed)
  }

  if (await turnClaimedElsewhere(ctx, request)) {
    return recordDuplicateSpend(ctx, 'claude_implementer', round, request, result.ok.usage.cost_usd)
  }

  const overrun = await checkCostReconciliation(
    ctx,
    'claude_implementer',
    round,
    request,
    result.ok.usage.cost_usd
  )
  if (overrun) return overrun

  const telemetryProblem = checkTelemetry(result.ok)
  if (telemetryProblem) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'missing_telemetry',
      detail: [telemetryProblem],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'halted', stop_reason: 'policy_violation', message: telemetryProblem }
  }

  // The second half of the snapshot pair. What this turn did is after − before;
  // what the branch holds in total is after.
  const after = await ctx.deps.workspace.capture()
  const delta: TurnDelta = diffWorkspaceStates(before, after)
  const facts: AuthoritativeTurnFacts = factsFrom(delta, result.ok.telemetry)

  const policy = evaluateImplementerTurn(ctx.input.authorization, facts)
  if (!policy.allowed) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'policy_violation',
      detail: [policy.code, policy.message, ...policy.offending, `evidence: ${facts.sources.workspace}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `${policy.code}: ${policy.message}`,
    }
  }

  const drift = await ctx.deps.integrity.drift()
  if (drift.length > 0) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'policy_integrity_drift',
      detail: [...drift, `evidence: ${ctx.deps.integrity.name}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `control-plane files changed during the turn: ${drift.join(', ')}`,
    }
  }

  const parsed = implementerTurnOutputSchema.safeParse(result.ok.output)
  if (!parsed.success) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'invalid_output',
      detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      nextState: ctx.run.state,
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'retry' }
  }

  const output: ImplementerTurnOutput = parsed.data
  const mismatches = compareSelfReport(output, facts)
  if (mismatches.length > 0) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'self_report_mismatch',
      detail: [...mismatches, `evidence: ${facts.sources.workspace} + ${facts.sources.telemetry}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `implementer self-report does not match the record: ${mismatches[0]}`,
    }
  }

  ctx.run = {
    ...ctx.run,
    current_round: round,
    target_branch: facts.commit?.branch ?? ctx.run.target_branch,
    pr_number: facts.pull_request?.number ?? ctx.run.pr_number,
  }

  const nextState = applyTurnState(ctx, 'GPT_TURN')

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_completed',
    actor: 'claude_implementer',
    round,
    idempotency_key: request.idempotency_key,
    input_digest: request.input_digest,
    verdict: null,
    reserved_cost_usd: request.reserved_cost_usd,
    cost_usd: result.ok.usage.cost_usd,
    pricing_version: request.cost_estimate.pricing_version,
    output_digest: digest(output),
    authoritative: facts,
    self_report_mismatches: [],
    // What the reviewer's next prompt is built from. `files_changed` and the
    // commit identity are taken from `facts`, not from `output`: the reviewer has
    // to reason about what the turn did, and the record is what it did.
    handoff: fitHandoff(buildImplementerHandoff(output, facts)),
    wait: null,
    next_state: nextState,
  })

  return { kind: 'advanced' }
}

/** Re-exported so the runner can type its own local variables. */
export type { LedgerEvent }
