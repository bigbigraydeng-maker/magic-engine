import type {
  PageOptimizationRequestCallerDeps,
  SubmitPageOptimizationRequestResult,
} from '@/lib/action-submission'
import type { TriggeredBy } from '@/lib/kernel/types'

export interface CtsGithubReferenceLoopTriggerInput {
  readonly pageId: string
  readonly gsc: {
    readonly accessToken: string
    readonly startDate: string
    readonly endDate: string
    readonly evidencePageUrl: string
    readonly query: string
  }
  readonly proposal: {
    readonly title: string
    readonly description: string
    readonly h1: string
    readonly titleRationale: string
    readonly descriptionRationale: string
    readonly h1Rationale: string
  }
  readonly growth: {
    readonly goalId?: string | null
    readonly orderingRationale: string
    readonly verification: {
      readonly windowDays: number
      readonly baseline: string
      readonly success: string
      readonly failure: string
      readonly indeterminate: string
    }
  }
  readonly kernel: {
    readonly triggeredBy: TriggeredBy
    readonly triggeredByRef?: string | null
    readonly rationale?: string | null
    readonly correlationId?: string
  }
}

export interface CtsGithubReferenceLoopTriggerDeps {
  readonly caller: PageOptimizationRequestCallerDeps
}

export type SubmitCtsGithubReferenceLoopResult =
  | SubmitPageOptimizationRequestResult
  | {
      readonly ok: false
      readonly reason: 'cts_reference_loop_not_ready'
      readonly detail:
        | 'client_id_mismatch'
        | 'submission_boundary_mismatch'
        | 'authorization_proof_unavailable'
        | 'rollout_disabled'
    }

export type CtsGithubReferenceLoopTriggerResult =
  | SubmitCtsGithubReferenceLoopResult
  | {
      readonly ok: false
      readonly reason: 'cts_trigger_not_ready'
      readonly detail:
        | 'rollout_disabled'
        | 'gsc_scope_invalid'
        | 'gsc_row_not_found'
        | 'gsc_row_ambiguous'
        | 'redline_not_ready'
        | 'source_not_ready'
        | 'evidence_target_same'
        | 'preparation_not_ready'
      readonly upstreamReason?: string
    }
