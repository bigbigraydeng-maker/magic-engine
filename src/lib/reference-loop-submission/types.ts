import type { PageOptimizationRequestCallerDeps, SubmitPageOptimizationRequestResult } from '@/lib/action-submission'
import type { ReferenceLoopPreparation } from '@/lib/reference-loop'
import type { TenantBoundWordpressSource } from '@/lib/capabilities/page-apply-wordpress/source'
import type { GscPageQueryEvidenceReceipt } from '@/lib/gsc/client'
import type { ActionPurpose, TriggeredBy } from '@/lib/kernel/types'

export interface SubmitValidatedWordpressReferenceLoopInput {
  readonly preparation: ReferenceLoopPreparation
  readonly target: TenantBoundWordpressSource
  /** The exact redacted evidence receipt shown to the approver and pinned in run.input. */
  readonly sourceReceipt: GscPageQueryEvidenceReceipt
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

export type SubmitValidatedWordpressReferenceLoopResult =
  | SubmitPageOptimizationRequestResult
  | {
      readonly ok: false
      readonly reason: 'reference_loop_not_ready'
      readonly detail:
        | 'validation_not_passed'
        | 'diff_not_available'
        | 'wordpress_snapshot_required'
        | 'client_id_mismatch'
        | 'wordpress_source_mismatch'
        | 'source_receipt_empty'
        | 'source_receipt_mismatch'
        | 'wordpress_body_change_not_supported'
        | 'submission_boundary_mismatch'
        | 'preparation_untrusted'
        | 'source_receipt_untrusted'
        | 'authorization_proof_unavailable'
    }

export interface WordpressReferenceLoopSubmissionDeps {
  readonly caller: PageOptimizationRequestCallerDeps
}
