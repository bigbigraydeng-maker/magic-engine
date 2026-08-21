import type { PageOptimizationRequestCallerDeps, SubmitPageOptimizationRequestResult } from '@/lib/action-submission'
import type { CtsGithubReferenceLoopPreparation } from '@/lib/cts-github-reference-loop'
import type { ActionPurpose, TriggeredBy } from '@/lib/kernel/types'

export interface SubmitCtsGithubReferenceLoopInput {
  readonly preparation: CtsGithubReferenceLoopPreparation
  readonly kernelMeta: {
    readonly clientId: string
    readonly purpose: ActionPurpose
    readonly goalId?: string | null
    readonly executionItemId?: string | null
    readonly triggeredBy: TriggeredBy
    readonly triggeredByRef?: string | null
    readonly rationale?: string | null
    readonly correlationId?: string
  }
}

export interface CtsGithubReferenceLoopSubmissionDeps {
  readonly caller: PageOptimizationRequestCallerDeps
}

export type SubmitCtsGithubReferenceLoopResult =
  | SubmitPageOptimizationRequestResult
  | {
      readonly ok: false
      readonly reason: 'cts_reference_loop_not_ready'
      readonly detail:
        | 'preparation_untrusted'
        | 'client_id_mismatch'
        | 'submission_boundary_mismatch'
        | 'authorization_proof_unavailable'
        | 'rollout_disabled'
    }
