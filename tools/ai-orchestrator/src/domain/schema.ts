/**
 * Strict typed contracts for the ME2 orchestrator.
 *
 * Nothing in this control plane advances on free text. Every value that crosses
 * a trust boundary — provider output, ledger event, authorization grant — is
 * parsed through one of these schemas first. A parse failure is a hard stop, not
 * a warning.
 */

import { z } from 'zod'

import { selectSelfModifyingPatterns } from '../policy/protected-paths'

/** Bumped whenever the ledger marker payload changes shape. */
export const LEDGER_SCHEMA_VERSION = 'v1'

/** Hidden HTML-comment namespace used to make Issue comments machine readable. */
export const ORCHESTRATOR_MARKER_NAMESPACE = 'me2-orchestrator'

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

export const runModeSchema = z.enum(['DESIGN', 'IMPLEMENT', 'REVIEW'])
export type RunMode = z.infer<typeof runModeSchema>

export const runStateSchema = z.enum([
  'READY',
  'GPT_TURN',
  'CLAUDE_TURN',
  'WAITING_HUMAN',
  'APPROVED_FOR_HUMAN_MERGE',
  'FAILED',
  'BUDGET_EXHAUSTED',
  'CANCELLED',
])
export type RunState = z.infer<typeof runStateSchema>

export const actorSchema = z.enum(['gpt_reviewer', 'claude_implementer'])
export type Actor = z.infer<typeof actorSchema>

export const verdictSchema = z.enum([
  'CONTINUE_DESIGN',
  'REQUEST_CHANGES',
  'APPROVED_FOR_NEXT_STAGE',
  'WAITING_HUMAN',
  'STOP_POLICY_VIOLATION',
  'FAILED',
])
export type Verdict = z.infer<typeof verdictSchema>

export const sideEffectClassSchema = z.enum(['none', 'repo_local', 'outward'])
export type SideEffectClass = z.infer<typeof sideEffectClassSchema>

export const stopReasonSchema = z.enum([
  'max_rounds_reached',
  'cost_cap_reached',
  'wall_clock_exceeded',
  'kill_switch',
  'policy_violation',
  'authorization_expired',
  'invalid_provider_output',
  'configuration_invalid',
  'provider_timeout',
  'cost_estimate_unavailable',
  'cost_overrun',
  'no_exclusive_ownership',
  'reviewer_approved',
  'reviewer_declared_failure',
  'human_input_required',
  'provider_error',
])
export type StopReason = z.infer<typeof stopReasonSchema>

const isoTimestamp = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'must be an ISO-8601 timestamp' })

// ─────────────────────────────────────────────────────────────────────────────
// WorkPackageAuthorization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operations that no work package may ever grant. These are checked as a set
 * membership test, not as a naming convention, so a typo in a config file
 * cannot silently widen the grant.
 */
export const ALWAYS_PROHIBITED_OPERATIONS = [
  'merge',
  'deploy',
  'apply_migration',
  'enable_schedule',
  'enable_issue_comment_trigger',
  'write_secrets',
  'call_customer_write_apis',
] as const

export type ProhibitedOperation = (typeof ALWAYS_PROHIBITED_OPERATIONS)[number]

export const workPackageScopeSchema = z.object({
  /** Glob patterns the implementer may touch. Empty is not allowed — say so explicitly. */
  allowed_paths: z.array(z.string().min(1)).min(1),
  denied_paths: z.array(z.string().min(1)).default([]),
  can_commit: z.boolean(),
  /**
   * Not a setting, like `can_merge`.
   *
   * A capability the runner cannot verify is not a capability, it is a label. In
   * the scaffold nothing establishes whether a push happened at the moment the
   * policy runs, so granting it would be a permission that exists only on paper.
   * Pushing belongs to the deterministic publisher in the Enable design (spec
   * §9b E1), which runs after policy has already passed.
   */
  can_push: z.literal(false),
  can_open_draft_pr: z.boolean(),
  /** Not a setting. Merging is a human act; the type system says so. */
  can_merge: z.literal(false),
  allowed_tools: z.array(z.string().min(1)),
  disallowed_tools: z.array(z.string().min(1)).default([]),
})
  .superRefine((value, ctx) => {
    // The orchestrator cannot be granted to itself. Upgrading this tool is a
    // separate, human-initiated change — see policy/protected-paths.ts.
    const selfModifying = selectSelfModifyingPatterns(value.allowed_paths)
    for (const pattern of selfModifying) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowed_paths'],
        message: `allowed path "${pattern}" overlaps the protected control plane`,
      })
    }
  })
export type WorkPackageScope = z.infer<typeof workPackageScopeSchema>

export const workPackageAuthorizationSchema = z
  .object({
    work_package_id: z.string().min(1),
    scope: workPackageScopeSchema,
    prohibited_operations: z.array(z.string().min(1)),
    side_effect_class: sideEffectClassSchema,
    expires_at: isoTimestamp,
    max_rounds: z.number().int().positive(),
    cost_cap_usd: z.number().nonnegative(),
    authorized_by: z.string().min(1),
    authorization_source: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    const declared = new Set(value.prohibited_operations)
    for (const op of ALWAYS_PROHIBITED_OPERATIONS) {
      if (!declared.has(op)) {
        ctx.addIssue({
          code: 'custom',
          path: ['prohibited_operations'],
          message: `authorization must explicitly prohibit "${op}"`,
        })
      }
    }
  })
export type WorkPackageAuthorization = z.infer<typeof workPackageAuthorizationSchema>

// ─────────────────────────────────────────────────────────────────────────────
// OrchestrationRun
// ─────────────────────────────────────────────────────────────────────────────

export const repositoryRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
})
export type RepositoryRef = z.infer<typeof repositoryRefSchema>

export const orchestrationRunSchema = z.object({
  run_id: z.string().min(1),
  repository: repositoryRefSchema,
  issue_number: z.number().int().positive(),
  mode: runModeSchema,
  state: runStateSchema,
  work_package_id: z.string().min(1),
  /** One round == one agent turn. Not a GPT+Claude pair — see README. */
  current_round: z.number().int().nonnegative(),
  max_rounds: z.number().int().positive(),
  cumulative_cost_usd: z.number().nonnegative(),
  cost_cap_usd: z.number().nonnegative(),
  invalid_output_count: z.number().int().nonnegative().default(0),
  last_processed_comment_id: z.number().int().nullable(),
  target_branch: z.string().min(1).nullable(),
  pr_number: z.number().int().positive().nullable(),
  deadline_at: isoTimestamp,
  stop_reason: stopReasonSchema.nullable(),
  created_at: isoTimestamp,
  updated_at: isoTimestamp,
})
export type OrchestrationRun = z.infer<typeof orchestrationRunSchema>

// ─────────────────────────────────────────────────────────────────────────────
// AgentTurn
// ─────────────────────────────────────────────────────────────────────────────

export const inputRefSchema = z.object({
  kind: z.enum(['issue', 'issue_comment', 'pull_request', 'file', 'prompt_version']),
  ref: z.string().min(1),
})

export const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
})
export type Usage = z.infer<typeof usageSchema>

export const agentTurnSchema = z.object({
  turn_id: z.string().min(1),
  run_id: z.string().min(1),
  round: z.number().int().positive(),
  actor: actorSchema,
  input_refs: z.array(inputRefSchema),
  structured_output: z.unknown(),
  provider: z.string().min(1),
  model: z.string().min(1),
  usage: usageSchema,
  started_at: isoTimestamp,
  completed_at: isoTimestamp,
  idempotency_key: z.string().min(1),
})
export type AgentTurn = z.infer<typeof agentTurnSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Provider output contracts
// ─────────────────────────────────────────────────────────────────────────────

export const findingSchema = z.object({
  severity: z.enum(['blocker', 'major', 'minor', 'nit']),
  evidence: z.string().min(1),
  source_ref: z.string().min(1),
  reasoning: z.string().min(1),
})

/** What the GPT reviewer must return. Anything else does not advance the run. */
export const reviewerTurnOutputSchema = z.object({
  verdict: verdictSchema,
  summary: z.string().min(1),
  findings: z.array(findingSchema),
  acceptance_criteria: z.array(z.string().min(1)),
  allowed_next_scope: z.object({
    allowed_paths: z.array(z.string().min(1)),
    notes: z.string().nullable().default(null),
  }),
  prohibited_next_actions: z.array(z.string().min(1)),
  /** Only populated when a decision genuinely belongs to the PM. */
  human_question: z.string().min(1).nullable(),
})
export type ReviewerTurnOutput = z.infer<typeof reviewerTurnOutputSchema>

export const testRunSchema = z.object({
  command: z.string().min(1),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  note: z.string().nullable().default(null),
})

/** What the Claude implementer must return. */
export const implementerTurnOutputSchema = z.object({
  conclusion: z.string().min(1),
  repo_evidence: z.array(z.string().min(1)),
  files_changed: z.array(z.string().min(1)),
  tests_run: z.array(testRunSchema),
  baseline_comparison: z.string().min(1),
  remaining_risks: z.array(z.string().min(1)),
  requested_next_scope: z.array(z.string().min(1)),
  policy_exceptions: z.array(z.string().min(1)),
  /** Tools the turn actually used, so the policy layer can audit them after the fact. */
  tools_used: z.array(z.string().min(1)),
  commit_evidence: z
    .object({
      branch: z.string().min(1),
      commit_sha: z.string().min(1),
      pr_number: z.number().int().positive().nullable(),
    })
    .nullable(),
})
export type ImplementerTurnOutput = z.infer<typeof implementerTurnOutputSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Turn handoff — what one agent's turn tells the next one
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The reason the loop is a loop.
 *
 * Without this the ledger kept only an `output_digest`, so every round rebuilt
 * its prompt from the original task brief alone: a reviewer's REQUEST_CHANGES
 * findings never reached the implementer, and the implementer's conclusions never
 * reached the reviewer. Two agents restating the same brief at each other is not
 * a review loop, however many rounds it runs.
 *
 * The handoff rides on `turn_completed` because rounds do not share a process —
 * each dispatch rebuilds its state by folding the ledger, so anything the next
 * round needs has to be *in* the ledger.
 *
 * Three properties are deliberate:
 *
 * - **Bounded.** Every field is length-capped and every list count-capped, and
 *   the builder truncates to those caps. One Issue comment holds 65536 characters;
 *   an unbounded model output would silently fail to post, and a ledger that
 *   cannot append is a ledger that has stopped.
 * - **Advisory, never a grant.** `requested_next_paths` is named for what it is.
 *   Scope comes from `WorkPackageAuthorization` and nothing a model writes here
 *   widens it — the policy layer never reads this.
 * - **Authoritative where it can be.** The implementer's `files_changed` and
 *   commit identity are copied from the workspace record, not from its self-report.
 */
export const HANDOFF_MAX_ITEMS = 8
export const HANDOFF_MAX_TEXT = 300
export const HANDOFF_MAX_SUMMARY = 800

const handoffText = z.string().min(1).max(HANDOFF_MAX_TEXT)
const handoffList = z.array(handoffText).max(HANDOFF_MAX_ITEMS)

export const reviewerHandoffSchema = z.object({
  kind: z.literal('reviewer'),
  verdict: verdictSchema,
  summary: z.string().min(1).max(HANDOFF_MAX_SUMMARY),
  findings: z
    .array(
      z.object({
        severity: z.enum(['blocker', 'major', 'minor', 'nit']),
        evidence: handoffText,
        source_ref: handoffText,
        reasoning: handoffText,
      })
    )
    .max(HANDOFF_MAX_ITEMS),
  acceptance_criteria: handoffList,
  /** What the reviewer *asks* for next. Not a grant — see the note above. */
  requested_next_paths: handoffList,
  prohibited_next_actions: handoffList,
  human_question: z.string().min(1).max(HANDOFF_MAX_SUMMARY).nullable(),
})
export type ReviewerHandoff = z.infer<typeof reviewerHandoffSchema>

export const implementerHandoffSchema = z.object({
  kind: z.literal('implementer'),
  conclusion: z.string().min(1).max(HANDOFF_MAX_SUMMARY),
  /** From the workspace record, not the model's `files_changed`. */
  files_changed: handoffList,
  tests_run: z
    .array(
      z.object({
        command: handoffText,
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        note: handoffText.nullable(),
      })
    )
    .max(HANDOFF_MAX_ITEMS),
  baseline_comparison: z.string().min(1).max(HANDOFF_MAX_SUMMARY),
  remaining_risks: handoffList,
  requested_next_scope: handoffList,
  policy_exceptions: handoffList,
  /** From the workspace record. */
  commit_sha: handoffText.nullable(),
  pr_number: z.number().int().positive().nullable(),
})
export type ImplementerHandoff = z.infer<typeof implementerHandoffSchema>

export const turnHandoffSchema = z.discriminatedUnion('kind', [
  reviewerHandoffSchema,
  implementerHandoffSchema,
])
export type TurnHandoff = z.infer<typeof turnHandoffSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Authoritative turn facts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a turn actually did, as observed by git, GitHub and the execution harness.
 *
 * This — never the model's own `files_changed` / `tools_used` / `commit_evidence`
 * — is what the policy layer is evaluated against. The model's version is kept
 * only so the two can be compared and a mismatch reported.
 */
export const authoritativeTurnFactsSchema = z.object({
  /** What THIS turn changed: the delta between the pre-call and post-call captures. */
  files_changed: z.array(z.string().min(1)),
  /** What the branch holds in total versus its base ref, after this turn. */
  cumulative_files_changed: z.array(z.string().min(1)),
  tools_used: z.array(z.string().min(1)),
  /** Non-null only when HEAD moved during this turn. */
  commit: z
    .object({ sha: z.string().min(1), branch: z.string().min(1) })
    .nullable(),
  pull_request: z
    .object({
      number: z.number().int().positive(),
      head_sha: z.string().min(1),
      head_ref: z.string().min(1),
      merged: z.boolean(),
    })
    .nullable(),
  /** True only when the pull request did not exist before this turn. */
  pull_request_opened_this_turn: z.boolean(),
  /** True when the tracked remote ref moved during this turn — i.e. a push. */
  pushed_this_turn: z.boolean(),
  /** Before/after of the tracked remote ref, for the audit trail. */
  remote_head_delta: z
    .object({
      ref: z.string().min(1),
      before_sha: z.string().min(1).nullable(),
      after_sha: z.string().min(1).nullable(),
    })
    .nullable(),
  /** False when the remote could not be read. Policy fails closed on false. */
  remote_facts_available: z.boolean(),
  /** Provenance for each fact, written to the ledger so a reviewer can audit it. */
  sources: z.object({
    workspace: z.string().min(1),
    telemetry: z.string().min(1),
  }),
})
export type AuthoritativeTurnFacts = z.infer<typeof authoritativeTurnFactsSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Ledger events (the append-only log stored as Issue comments)
// ─────────────────────────────────────────────────────────────────────────────

export const turnRejectionReasonSchema = z.enum([
  /** Provider output did not match its schema. The run does not advance. */
  'invalid_output',
  /** Turn breached the work package envelope. The run parks at WAITING_HUMAN. */
  'policy_violation',
  /** Control-plane files changed during the turn that governs them. */
  'policy_integrity_drift',
  /** Provider threw before producing output. */
  'provider_error',
  /** The call passed its hard timeout. Reserved budget is treated as spent. */
  'provider_timeout',
  /** The adapter could not produce a real execution record for tools_used. */
  'missing_telemetry',
  /** What the model said it did does not match what git and the harness observed. */
  'self_report_mismatch',
  /** No worst-case price could be computed, so no call was made. */
  'cost_estimate_unavailable',
  /** Actual usage exceeded the reservation: the price model is wrong. */
  'cost_overrun',
  /** No verified exclusive-run context, so the turn could have run twice. */
  'no_exclusive_ownership',
])
export type TurnRejectionReason = z.infer<typeof turnRejectionReasonSchema>

/**
 * One specific block, and what has to be approved to clear it.
 *
 * Nested rather than two loose fields so "an id with no reason" and "a reason
 * with no id" are unrepresentable — the pair is only meaningful together.
 */
export const waitDescriptorSchema = z.object({
  id: z.string().min(1),
  /**
   * What is being waited on, in machine-readable form (e.g. `policy_violation`).
   * A human authorization must list this in `grants`: approving "carry on" is not
   * approving "and that tool use was fine".
   */
  blocking_reason: z.string().min(1),
})
export type WaitDescriptor = z.infer<typeof waitDescriptorSchema>

const ledgerBase = {
  schema_version: z.literal(LEDGER_SCHEMA_VERSION),
  run_id: z.string().min(1),
  at: isoTimestamp,
}

export const ledgerEventSchema = z.discriminatedUnion('event', [
  z.object({
    ...ledgerBase,
    event: z.literal('run_started'),
    mode: runModeSchema,
    work_package_id: z.string().min(1),
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('lease_acquired'),
    lock_key: z.string().min(1),
    holder: z.string().min(1),
    /**
     * Fencing token. Unique per acquisition, so a release written by a holder
     * whose lease already lapsed cannot close the lease that replaced it.
     */
    lease_id: z.string().min(1),
    expires_at: isoTimestamp,
    took_over_from: z.string().min(1).nullable(),
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('lease_released'),
    lock_key: z.string().min(1),
    holder: z.string().min(1),
    /** Must match the live lease exactly, or the release is ignored. */
    lease_id: z.string().min(1),
  }),
  z.object({
    ...ledgerBase,
    /**
     * The runner finished but deliberately did NOT free the lease.
     *
     * Written when a provider that cannot prove it cancels was still in flight
     * when we stopped waiting. Releasing then would end the Actions concurrency
     * group while the old call may still be writing to the repository and
     * billing; a human could authorise a resume and start a second one beside it.
     * So the lease is held — and extended to cover the provider's server-side
     * maximum — until the window the old call could still be alive in has passed.
     */
    event: z.literal('lease_retained'),
    lock_key: z.string().min(1),
    holder: z.string().min(1),
    /** Fencing token of the lease being held. Same matching rule as a release. */
    lease_id: z.string().min(1),
    /** Extends the lease to here. Only ever forward, never shorter. */
    retained_until: isoTimestamp,
    reason: z.string().min(1),
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('turn_started'),
    actor: actorSchema,
    round: z.number().int().positive(),
    idempotency_key: z.string().min(1),
    input_digest: z.string().min(1),
    holder: z.string().min(1),
    /** Dollars committed before the call. Charged whether or not we hear back. */
    reserved_cost_usd: z.number().nonnegative(),
    /** The price table the reservation was computed from. */
    pricing_version: z.string().min(1),
    /**
     * When this claim lapses. Always inside the lease TTL. An expired claim with
     * no matching completion is treated as spent, because we cannot know whether
     * the provider billed us.
     */
    claim_expires_at: isoTimestamp,
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('turn_completed'),
    actor: actorSchema,
    round: z.number().int().positive(),
    idempotency_key: z.string().min(1),
    /** Digest of the exact prompt this turn ran on — the content-addressed half
     *  of duplicate detection, which survives a crash between two ledger writes. */
    input_digest: z.string().min(1),
    verdict: verdictSchema.nullable(),
    reserved_cost_usd: z.number().nonnegative(),
    /** Reconciled actual spend. Exceeding the reservation halts the run. */
    cost_usd: z.number().nonnegative(),
    /** Which price table the reservation was computed from. */
    pricing_version: z.string().min(1),
    output_digest: z.string().min(1),
    authoritative: authoritativeTurnFactsSchema.nullable(),
    /** Discrepancies between the model's self-report and the authoritative facts. */
    self_report_mismatches: z.array(z.string()).default([]),
    /**
     * What this turn tells the next one. The next round's prompt is built from
     * this, so a reviewer's findings actually reach the implementer and the
     * implementer's result actually reaches the reviewer.
     */
    handoff: turnHandoffSchema.nullable().default(null),
    /**
     * Present exactly when `next_state` is WAITING_HUMAN.
     *
     * A reviewer verdict of WAITING_HUMAN / STOP_POLICY_VIOLATION parks the run
     * on a *completed* turn, not a rejected one. Without a wait here the block
     * was invisible to `currentOpenWait`, so no authorization could name it and
     * the run could never be released. See turn_rejected.wait.
     */
    wait: waitDescriptorSchema.nullable().default(null),
    /** The state this turn moved the run to. Carried on the same event as the
     *  turn itself so a crash cannot land between "the turn happened" and "the
     *  run moved on" — the window that would otherwise make us pay twice. */
    next_state: runStateSchema,
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('turn_rejected'),
    actor: actorSchema,
    round: z.number().int().positive(),
    idempotency_key: z.string().min(1),
    input_digest: z.string().min(1),
    reason: turnRejectionReasonSchema,
    detail: z.array(z.string()).default([]),
    /**
     * Identifies this specific block. Present exactly when `next_state` is
     * WAITING_HUMAN. A human authorization must name it, so approving one gate
     * cannot silently release the next one.
     */
    wait: waitDescriptorSchema.nullable().default(null),
    /** Reserved dollars that this rejection settles. Timeouts settle at full reservation. */
    reserved_cost_usd: z.number().nonnegative(),
    cost_usd: z.number().nonnegative(),
    next_state: runStateSchema,
  }),
  z.object({
    ...ledgerBase,
    /**
     * Our call was billed but another runner had already recorded this turn, so
     * our result is discarded. Carries no state: it exists so money we could not
     * avoid spending is on the record instead of vanishing.
     */
    event: z.literal('duplicate_spend_recorded'),
    actor: actorSchema,
    round: z.number().int().positive(),
    idempotency_key: z.string().min(1),
    holder: z.string().min(1),
    cost_usd: z.number().nonnegative(),
    note: z.string().min(1),
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('state_changed'),
    from: runStateSchema,
    to: runStateSchema,
    reason: z.string().min(1),
    /** Present exactly when `to` is WAITING_HUMAN. See turn_rejected.wait. */
    wait: waitDescriptorSchema.nullable().default(null),
    /** Present when leaving WAITING_HUMAN: the wait this transition consumed. */
    consumed_wait_id: z.string().min(1).nullable().default(null),
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('human_authorization'),
    authorized_by: z.string().min(1),
    /**
     * The specific block being released. An authorization written before its
     * wait, or naming a different wait, is not an authorization for this one.
     */
    wait_id: z.string().min(1),
    /**
     * Must contain the blocking reason recorded on the wait event. Approving
     * "the run may continue" is not approving "and it may also use that tool".
     */
    grants: z.array(z.string().min(1)).min(1),
    resume_state: z.enum(['GPT_TURN', 'CLAUDE_TURN', 'CANCELLED']),
    expires_at: isoTimestamp,
  }),
  z.object({
    ...ledgerBase,
    event: z.literal('run_finished'),
    final_state: runStateSchema,
    stop_reason: stopReasonSchema.nullable(),
  }),
])
export type LedgerEvent = z.infer<typeof ledgerEventSchema>
export type LedgerEventName = LedgerEvent['event']
