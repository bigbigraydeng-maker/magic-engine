import {
  PAGE_OPTIMIZATION_FIELDS,
  diffPageChange,
  draftPageChange,
  resolvePage,
  validatePageChange,
  type PageOptimizationField,
  type PageOptimizationRequest,
} from '@/lib/page-optimization'
import {
  validateGrowthFinding,
  validateGrowthPrescription,
  validateGrowthVerificationDefinition,
  type GrowthFinding,
  type GrowthMaybeUnknown,
} from '@/lib/growth'
import type {
  ReferenceLoopAuthorizationReadiness,
  ReferenceLoopEvidenceRef,
  ReferenceLoopFailureCode,
  ReferenceLoopFailureStage,
  ReferenceLoopInput,
  ReferenceLoopPreparation,
  ReferenceLoopResult,
} from './types'

const FIELD_SET: ReadonlySet<string> = new Set(PAGE_OPTIMIZATION_FIELDS)
const validatedPreparations = new WeakSet<ReferenceLoopPreparation>()

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

export function isValidatedReferenceLoopPreparation(
  value: unknown,
): value is ReferenceLoopPreparation {
  return value !== null && typeof value === 'object' && validatedPreparations.has(
    value as ReferenceLoopPreparation,
  )
}

function fail(
  stage: ReferenceLoopFailureStage,
  code: ReferenceLoopFailureCode,
  reason: string,
): ReferenceLoopResult {
  return { ok: false, stage, code, reason }
}

function isSameFinding(a: GrowthFinding, b: GrowthFinding): boolean {
  return a.pillar === b.pillar && a.severity === b.severity && a.statement === b.statement
}

function evidenceRefs(finding: GrowthFinding): readonly ReferenceLoopEvidenceRef[] {
  return finding.evidence.map(({ source, observedAt }) => ({ source, observedAt }))
}

function basedOnVersion(input: ReferenceLoopInput): GrowthMaybeUnknown<string> {
  return input.snapshot.ok
    ? { known: true, value: input.snapshot.versionToken }
    : { known: false, reason: 'not_recorded_by_source' }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function provenanceIsValid(input: ReferenceLoopInput['provenance']): boolean {
  const sources = [
    input.clientIdSource,
    input.targetPageUrlSource,
    input.findingSource,
    input.prescriptionSource,
    input.intentsSource,
    input.snapshotSource,
    input.redlineSource,
    input.providerCheckSource,
    input.verificationSource,
    input.findingRefsSource,
  ]
  if (sources.some((source) => typeof source !== 'string' || !source.trim())) return false
  if (
    typeof input.collectedAt !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.collectedAt) ||
    Number.isNaN(Date.parse(input.collectedAt))
  ) return false
  if (!input.window.known) return true
  const { startAt, endAt } = input.window.value
  return isCalendarDate(startAt) && isCalendarDate(endAt) && startAt <= endAt
}

function buildRequest(input: ReferenceLoopInput): PageOptimizationRequest {
  const touched = new Set<PageOptimizationField>(input.intents.map(({ field }) => field))
  return {
    clientId: input.clientId,
    page: { url: input.targetPageUrl },
    intents: input.intents,
    lineage: { findingRefs: input.findingRefs },
    verification: input.verification,
    constraints: { doNotTouch: PAGE_OPTIMIZATION_FIELDS.filter((field) => !touched.has(field)) },
    basedOnVersion: basedOnVersion(input),
  }
}

/** Pure Growth evidence → validated Page Optimization preparation adapter. */
export function prepareReferenceLoopChange(input: ReferenceLoopInput): ReferenceLoopResult {
  if (typeof input.clientId !== 'string' || input.clientId.length === 0) {
    return fail('input', 'client_id_empty', 'clientId must be a non-empty string')
  }
  if (typeof input.targetPageUrl !== 'string' || input.targetPageUrl.length === 0) {
    return fail('input', 'target_page_url_empty', 'targetPageUrl must be a non-empty string')
  }

  const finding = validateGrowthFinding(input.finding)
  if (!finding.ok) return fail('input', 'finding_invalid', finding.reason)
  const prescription = validateGrowthPrescription(input.prescription)
  if (!prescription.ok) return fail('input', 'prescription_invalid', prescription.reason)
  const verification = validateGrowthVerificationDefinition(input.verification)
  if (!verification.ok) return fail('input', 'verification_invalid', verification.reason)
  if (!provenanceIsValid(input.provenance)) {
    return fail('input', 'provenance_invalid', 'provenance sources, timestamp, or window are invalid')
  }

  if (!input.prescription.covers.some((item) => isSameFinding(item, input.finding))) {
    return fail('input', 'prescription_lineage_mismatch', 'prescription does not cover finding')
  }
  if (input.findingRefs.length === 0) {
    return fail('input', 'finding_refs_empty', 'findingRefs must contain at least one item')
  }
  if (input.findingRefs.some((ref) => typeof ref !== 'string' || ref.length === 0)) {
    return fail('input', 'finding_refs_contains_invalid', 'findingRefs contains an invalid item')
  }
  if (input.intents.length === 0) {
    return fail('input', 'intents_empty', 'intents must contain at least one item')
  }

  const seen = new Set<string>()
  for (const intent of input.intents) {
    if (!FIELD_SET.has(intent.field)) {
      return fail('input', 'intents_field_out_of_vocab', `unsupported field: ${intent.field}`)
    }
    if (typeof intent.proposedValue !== 'string' || intent.proposedValue.length === 0) {
      return fail('input', 'intents_proposed_value_invalid', `invalid value for ${intent.field}`)
    }
    if (seen.has(intent.field)) {
      return fail('input', 'intents_duplicate_field', `duplicate field: ${intent.field}`)
    }
    seen.add(intent.field)
  }

  const resolution = resolvePage({
    pageUrl: input.targetPageUrl,
    clientDomain: input.clientDomain,
    providers: input.providers,
  })
  if (!resolution.canonicalIdentity.known) {
    return fail('resolve', 'canonical_identity_unknown', 'target page canonical identity is unknown')
  }

  const draft = draftPageChange(input.snapshot, input.intents)
  if (!draft.ok) return fail('draft', 'draft_failed', draft.reason)
  const diff = diffPageChange(input.snapshot, draft)
  if (!diff.ok) return fail('diff', 'diff_failed', diff.reason)

  const request = buildRequest(input)
  const validation = validatePageChange(request, diff, input.redline, input.providerCheck)
  const authorizationReadiness: ReferenceLoopAuthorizationReadiness = validation.ok
    ? 'validation_passed'
    : 'validation_failed'

  const preparation = deepFreeze<ReferenceLoopPreparation>({
    clientId: input.clientId,
    targetPageUrl: input.targetPageUrl,
    finding: input.finding,
    prescription: input.prescription,
    findingRefs: input.findingRefs,
    evidenceRefs: evidenceRefs(input.finding),
    requestedChange: input.intents,
    request,
    resolution,
    snapshot: input.snapshot,
    draft,
    diff,
    validation,
    verification: input.verification,
    provenance: input.provenance,
    authorizationReadiness,
  })
  validatedPreparations.add(preparation)
  return { ok: true, preparation }
}
