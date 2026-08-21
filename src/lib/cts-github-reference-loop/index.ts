import { judgeDomainOwnership } from '@/lib/clients/domain-match'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import {
  isTenantBoundCtsGithubSource,
} from '@/lib/capabilities/page-apply-cts-github/source'
import {
  validateGrowthFinding,
  validateGrowthPrescription,
  validateGrowthVerificationDefinition,
} from '@/lib/growth'
import { isGscPageQueryEvidenceReceipt } from '@/lib/gsc/client'
import {
  PAGE_OPTIMIZATION_FIELDS,
  validatePageChange,
  type PageFieldDiff,
  type PageOptimizationField,
  type PageOptimizationRequest,
} from '@/lib/page-optimization'
import {
  CTS_CLIENT_ID,
  inspectCtsIntentForSlug,
  replaceIntentForSlug,
} from '@/lib/seo-meta/cts-meta-source'
import type {
  CtsGithubReferenceLoopInput,
  CtsGithubReferenceLoopPreparation,
  PrepareCtsGithubReferenceLoopResult,
} from './types'

export type {
  CtsGithubReferenceLoopInput,
  CtsGithubReferenceLoopPreparation,
  PrepareCtsGithubReferenceLoopResult,
} from './types'

const trustedPreparations = new WeakSet<object>()

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

export function isCtsGithubReferenceLoopPreparation(
  value: unknown,
): value is CtsGithubReferenceLoopPreparation {
  return value !== null && typeof value === 'object' && trustedPreparations.has(value)
}

function sameFinding(
  left: CtsGithubReferenceLoopInput['finding'],
  right: CtsGithubReferenceLoopInput['finding'],
): boolean {
  return left.pillar === right.pillar &&
    left.severity === right.severity && left.statement === right.statement
}

function propertyOwnsPage(property: string, pageUrl: string): boolean {
  const origin = property.startsWith('sc-domain:')
    ? `https://${property.slice('sc-domain:'.length)}`
    : property
  return judgeDomainOwnership(origin, pageUrl) === 'owned'
}

function fail(
  reason: Extract<PrepareCtsGithubReferenceLoopResult, { ok: false }>['reason'],
  detail?: string,
): PrepareCtsGithubReferenceLoopResult {
  return { ok: false, reason, ...(detail ? { detail } : {}) }
}

export function prepareCtsGithubReferenceLoop(
  input: CtsGithubReferenceLoopInput,
): PrepareCtsGithubReferenceLoopResult {
  if (input.clientId !== CTS_CLIENT_ID) return fail('client_not_cts')
  if (
    !isTenantBoundCtsGithubSource(input.source) ||
    input.source.clientId !== CTS_CLIENT_ID
  ) return fail('source_untrusted')
  if (!isGscPageQueryEvidenceReceipt(input.sourceReceipt)) return fail('receipt_untrusted')
  if (
    input.sourceReceipt.country !== 'nzl' ||
    !propertyOwnsPage(input.sourceReceipt.property, input.sourceReceipt.page) ||
    !propertyOwnsPage(input.sourceReceipt.property, input.source.targetPageUrl)
  ) return fail('receipt_scope_mismatch')

  const finding = validateGrowthFinding(input.finding)
  const prescription = validateGrowthPrescription(input.prescription)
  const verification = validateGrowthVerificationDefinition(input.verification)
  if (!finding.ok || !prescription.ok || !verification.ok) {
    return fail('growth_contract_invalid')
  }
  if (!input.prescription.covers.some((candidate) => sameFinding(candidate, input.finding))) {
    return fail('finding_lineage_mismatch')
  }
  const receiptEvidence = input.finding.evidence.filter(({ source, observedAt }) =>
    source.kind === 'gsc' &&
    source.sourceId === input.sourceReceipt.evidence_source_id &&
    observedAt === input.sourceReceipt.collected_at)
  if (receiptEvidence.length !== 1) return fail('finding_lineage_mismatch')
  if (
    input.findingRefs.length === 0 ||
    input.findingRefs.some((reference) => typeof reference !== 'string' || !reference.trim())
  ) return fail('finding_refs_invalid')
  if (!input.redlineSource.trim()) return fail('redline_source_invalid')
  if (!input.headline.proposedValue.trim() || !input.headline.semanticIntent.trim()) {
    return fail('intents_invalid')
  }
  if (
    input.redline.available && input.redline.phrases.some((phrase) =>
      phrase.trim() && input.headline.proposedValue.toLowerCase().includes(phrase.toLowerCase()))
  ) return fail('validation_failed', 'redline_phrase_in_h1')

  const allowed = new Set<PageOptimizationField>(['meta_title', 'meta_description'])
  if (
    input.intents.length !== 2 ||
    new Set(input.intents.map(({ field }) => field)).size !== 2 ||
    input.intents.some(({ field, proposedValue }) =>
      !allowed.has(field) || !proposedValue.trim())
  ) return fail('intents_invalid')

  const before = new Map<PageOptimizationField, string>([
    ['meta_title', input.source.current.title],
    ['meta_description', input.source.current.description],
  ])
  const changes: Array<PageFieldDiff & { readonly field: 'meta_title' | 'meta_description' }> = input.intents.map((intent) => ({
    field: intent.field as 'meta_title' | 'meta_description',
    before: before.get(intent.field) ?? '',
    after: intent.proposedValue,
    changed: before.get(intent.field) !== intent.proposedValue,
  }))
  const intentChanges = [
    ...changes,
    {
      field: 'h1' as const,
      before: input.source.current.h1,
      after: input.headline.proposedValue,
      changed: input.source.current.h1 !== input.headline.proposedValue,
    },
  ]
  if (!intentChanges.some(({ changed }) => changed)) return fail('no_change')

  const doNotTouch = PAGE_OPTIMIZATION_FIELDS.filter(
    (field) => !input.intents.some((intent) => intent.field === field),
  )
  const request: PageOptimizationRequest = {
    clientId: CTS_CLIENT_ID,
    page: { url: input.source.targetPageUrl },
    intents: input.intents,
    lineage: { findingRefs: input.findingRefs },
    verification: input.verification,
    constraints: { doNotTouch },
    basedOnVersion: { known: true, value: input.source.versionToken },
  }
  const diff = { ok: true as const, changes }
  const validation = validatePageChange(
    request,
    diff,
    input.redline,
    { evaluated: true, passed: true },
  )
  if (!validation.ok) return fail('validation_failed', validation.reason)

  const proposed = new Map(input.intents.map(({ field, proposedValue }) => [field, proposedValue]))
  const replacement = replaceIntentForSlug(
    input.source.rawContent,
    input.source.entrySlug,
    proposed.get('meta_title') ?? '',
    proposed.get('meta_description') ?? '',
    input.headline.proposedValue,
  )
  if (!replacement) return fail('source_patch_failed')
  const after = inspectCtsIntentForSlug(replacement.updated, input.source.entrySlug)
  if (
    !after || after.title !== proposed.get('meta_title') ||
    after.description !== proposed.get('meta_description') ||
    after.h1 !== input.headline.proposedValue
  ) return fail('source_patch_failed')

  const preparation = deepFreeze<CtsGithubReferenceLoopPreparation>({
    clientId: CTS_CLIENT_ID,
    source: input.source,
    sourceReceipt: input.sourceReceipt,
    finding: input.finding,
    prescription: input.prescription,
    findingRefs: input.findingRefs,
    request,
    headline: input.headline,
    intentChanges,
    diff,
    validation,
    validatedDiffHash: canonicalHashOfInput(intentChanges),
    patchedContent: replacement.updated,
    verification: input.verification,
    redlineSource: input.redlineSource,
    authorizationReadiness: 'validation_passed',
  })
  trustedPreparations.add(preparation)
  return { ok: true, preparation }
}
