import type {
  GrowthEvidence,
  GrowthFinding,
  GrowthMaybeUnknown,
  GrowthPrescription,
  GrowthVerificationDefinition,
} from '@/lib/growth'
import type {
  PageDiffResult,
  PageDraftResult,
  PageOptimizationIntent,
  PageOptimizationRequest,
  PageResolution,
  PageSnapshot,
  PageValidationResult,
  ProviderCheckInput,
  RedlineCheckInput,
  ResolvePageInput,
} from '@/lib/page-optimization'

/** Caller-supplied provenance. This pure layer never invents observation time. */
export interface ReferenceLoopProvenance {
  readonly clientIdSource: string
  readonly targetPageUrlSource: string
  readonly findingSource: string
  readonly prescriptionSource: string
  readonly intentsSource: string
  readonly snapshotSource: string
  readonly redlineSource: string
  readonly providerCheckSource: string
  readonly verificationSource: string
  readonly findingRefsSource: string
  readonly collectedAt: string
  readonly window: GrowthMaybeUnknown<{
    readonly startAt: string
    readonly endAt: string
  }>
}

export interface ReferenceLoopInput {
  readonly clientId: string
  readonly clientDomain: string | null
  readonly targetPageUrl: string
  readonly finding: GrowthFinding
  readonly prescription: GrowthPrescription
  readonly findingRefs: readonly string[]
  readonly intents: readonly PageOptimizationIntent[]
  readonly verification: GrowthVerificationDefinition
  readonly providers: ResolvePageInput['providers']
  readonly snapshot: PageSnapshot
  readonly redline: RedlineCheckInput
  readonly providerCheck: ProviderCheckInput
  readonly provenance: ReferenceLoopProvenance
}

export interface ReferenceLoopEvidenceRef {
  readonly source: GrowthEvidence['source']
  readonly observedAt: string
}

export type ReferenceLoopAuthorizationReadiness =
  | 'validation_passed'
  | 'validation_failed'

export interface ReferenceLoopPreparation {
  readonly clientId: string
  readonly targetPageUrl: string
  readonly finding: GrowthFinding
  readonly prescription: GrowthPrescription
  readonly findingRefs: readonly string[]
  readonly evidenceRefs: readonly ReferenceLoopEvidenceRef[]
  readonly requestedChange: readonly PageOptimizationIntent[]
  readonly request: PageOptimizationRequest
  readonly resolution: PageResolution
  readonly snapshot: PageSnapshot
  readonly draft: PageDraftResult
  readonly diff: PageDiffResult
  readonly validation: PageValidationResult
  readonly verification: GrowthVerificationDefinition
  readonly provenance: ReferenceLoopProvenance
  /** Readiness to ask Kernel for authorization; never authorization itself. */
  readonly authorizationReadiness: ReferenceLoopAuthorizationReadiness
}

export type ReferenceLoopFailureStage = 'input' | 'resolve' | 'draft' | 'diff'

export type ReferenceLoopFailureCode =
  | 'client_id_empty'
  | 'target_page_url_empty'
  | 'finding_invalid'
  | 'prescription_invalid'
  | 'verification_invalid'
  | 'provenance_invalid'
  | 'prescription_lineage_mismatch'
  | 'finding_refs_empty'
  | 'finding_refs_contains_invalid'
  | 'intents_empty'
  | 'intents_field_out_of_vocab'
  | 'intents_proposed_value_invalid'
  | 'intents_duplicate_field'
  | 'canonical_identity_unknown'
  | 'draft_failed'
  | 'diff_failed'

export type ReferenceLoopResult =
  | { readonly ok: true; readonly preparation: ReferenceLoopPreparation }
  | {
      readonly ok: false
      readonly stage: ReferenceLoopFailureStage
      readonly code: ReferenceLoopFailureCode
      readonly reason: string
    }
