import type {
  GrowthFinding,
  GrowthPrescription,
  GrowthVerificationDefinition,
} from '@/lib/growth'
import type { GscPageQueryEvidenceReceipt } from '@/lib/gsc/client'
import type {
  PageDiffResult,
  PageOptimizationIntent,
  PageOptimizationRequest,
  PageValidationResult,
  RedlineCheckInput,
} from '@/lib/page-optimization'
import type { TenantBoundCtsGithubSource } from '@/lib/capabilities/page-apply-cts-github/source'

export interface CtsGithubReferenceLoopInput {
  readonly clientId: string
  readonly source: TenantBoundCtsGithubSource
  readonly sourceReceipt: GscPageQueryEvidenceReceipt
  readonly finding: GrowthFinding
  readonly prescription: GrowthPrescription
  readonly findingRefs: readonly string[]
  readonly intents: readonly PageOptimizationIntent[]
  readonly headline: {
    readonly proposedValue: string
    readonly semanticIntent: string
  }
  readonly verification: GrowthVerificationDefinition
  readonly redline: RedlineCheckInput
  readonly redlineSource: string
}

export interface CtsGithubReferenceLoopPreparation {
  readonly clientId: string
  readonly source: TenantBoundCtsGithubSource
  readonly sourceReceipt: GscPageQueryEvidenceReceipt
  readonly finding: GrowthFinding
  readonly prescription: GrowthPrescription
  readonly findingRefs: readonly string[]
  readonly request: PageOptimizationRequest
  readonly headline: CtsGithubReferenceLoopInput['headline']
  readonly intentChanges: readonly {
    readonly field: 'meta_title' | 'meta_description' | 'h1'
    readonly before: string
    readonly after: string
    readonly changed: boolean
  }[]
  readonly diff: PageDiffResult & { readonly ok: true }
  readonly validation: PageValidationResult & { readonly ok: true }
  readonly validatedDiffHash: string
  readonly patchedContent: string
  readonly verification: GrowthVerificationDefinition
  readonly redlineSource: string
  readonly authorizationReadiness: 'validation_passed'
}

export type PrepareCtsGithubReferenceLoopResult =
  | { readonly ok: true; readonly preparation: CtsGithubReferenceLoopPreparation }
  | {
      readonly ok: false
      readonly reason:
        | 'client_not_cts'
        | 'source_untrusted'
        | 'receipt_untrusted'
        | 'receipt_scope_mismatch'
        | 'growth_contract_invalid'
        | 'finding_lineage_mismatch'
        | 'finding_refs_invalid'
        | 'intents_invalid'
        | 'validation_failed'
        | 'no_change'
        | 'source_patch_failed'
        | 'redline_source_invalid'
      readonly detail?: string
    }
