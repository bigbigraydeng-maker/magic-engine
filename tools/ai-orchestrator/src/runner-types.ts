/**
 * Shared runner types.
 *
 * Split out so `runner.ts`, `runner-context.ts` and `turn-executor.ts` can all
 * refer to them without importing each other in a cycle.
 */

import type { IssueCommentLedger, PlannedWrite, RejectedComment } from './adapters/github/ledger'
import type { GitHubClient } from './adapters/github/client'
import type {
  CostEstimate,
  CostEstimateFailure,
  ImplementerProvider,
  ProviderCancellation,
  ReviewerProvider,
} from './adapters/provider-types'
import type { WorkspaceInspector } from './adapters/workspace/inspector'
import type { BudgetLedger } from './domain/budget'
import type { LeaseAcquisition } from './domain/lease'
import type {
  Actor,
  LedgerEvent,
  OrchestrationRun,
  SideEffectClass,
  WorkPackageAuthorization,
} from './domain/schema'
import type {
  BudgetResult,
  EffectiveCaps,
  KillSwitchResult,
  OrchestratorLimits,
  PolicyDecision,
  TimingInvariantResult,
} from './policy/policy'
import type { ExclusivityResult } from './policy/exclusivity'
import type { ControlPlaneIntegrityChecker } from './policy/protected-paths'
import type { UntrustedBlock } from './policy/untrusted'

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

export interface RunnerDeps {
  github: GitHubClient
  reviewer: ReviewerProvider
  implementer: ImplementerProvider
  /** Reads what actually changed. Never the model. */
  workspace: WorkspaceInspector
  /** Reads whether the control plane moved. Never the model. */
  integrity: ControlPlaneIntegrityChecker
  clock?: Clock
  logger?: (line: string) => void
}

export interface RunnerInput {
  run: OrchestrationRun
  authorization: WorkPackageAuthorization
  limits: OrchestratorLimits
  /** True by default at every call site in v0.1. */
  dryRun: boolean
  workflowEnabledInput: boolean
  env: Readonly<Record<string, string | undefined>>
  /** Comment authors whose ledger markers are trusted. */
  trustedAuthors: readonly string[]
  /** Humans who may release a WAITING_HUMAN run. */
  allowedAuthorizers: readonly string[]
  /** Identifies this runner instance, e.g. `gha-run-1234567`. */
  holder: string
  leaseTtlMs: number
  /** Side-effect classes this deployment permits. */
  permittedSideEffectClasses: readonly SideEffectClass[]
  taskBrief: string
  untrusted: readonly UntrustedBlock[]
}

export interface PreflightReport {
  kill_switch: KillSwitchResult
  /** Proof that something is actually serialising this run. See policy/exclusivity.ts. */
  exclusivity: ExclusivityResult
  timing_invariant: TimingInvariantResult
  authorization: PolicyDecision
  side_effect_class: PolicyDecision
  lease: LeaseAcquisition | null
  budget: BudgetResult | null
  /**
   * The round and dollar ceilings actually in force, and which of run config,
   * deployment limits or the signed authorization is binding. Surfaced so a
   * dry run shows an authorization that is tighter than the run it was handed.
   */
  effective_caps: EffectiveCaps
  budget_ledger: BudgetLedger | null
  next_actor: Actor | null
  next_idempotency_key: string | null
  next_input_digest: string | null
  next_reserved_cost_usd: number | null
  /** The worst-case quote, or why one could not be produced. */
  cost_estimate: CostEstimate | { refused: CostEstimateFailure; message: string } | null
  /** Whether each provider can really be cancelled, and its server-side maximum. */
  cancellation: Readonly<Record<Actor, ProviderCancellation>>
  workspace_source: string
  integrity_source: string
  ledger_rejected: readonly RejectedComment[]
  /** How much of the Issue the ledger read covered. A short read is not a short ledger. */
  ledger_pages_read: number
  ledger_comment_count: number
}

export interface RunnerResult {
  run: OrchestrationRun
  /** Events this invocation appended (or would have appended in dry-run). */
  appended: readonly LedgerEvent[]
  plannedWrites: readonly PlannedWrite[]
  dryRun: boolean
  preflight: PreflightReport
  stopped_because: string
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RunnerContext {
  input: RunnerInput
  deps: RunnerDeps
  clock: Clock
  ledger: IssueCommentLedger
  /** Reassigned when a conflict re-read finds fresher events. */
  events: LedgerEvent[]
  appended: LedgerEvent[]
  run: OrchestrationRun
  budget: BudgetLedger
}
