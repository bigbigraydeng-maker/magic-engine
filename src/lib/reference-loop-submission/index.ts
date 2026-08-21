import { canonicalDiffHash } from '@/lib/capabilities/page-apply-optimization/hash'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { isTenantBoundWordpressSource } from '@/lib/capabilities/page-apply-wordpress/source'
import { isValidatedReferenceLoopPreparation } from '@/lib/reference-loop'
import { isGscPageQueryEvidenceReceipt } from '@/lib/gsc/client'
import { judgeDomainOwnership } from '@/lib/clients/domain-match'
import type { GrowthJsonValue } from '@/lib/growth'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'
import { createHmac } from 'node:crypto'
import type {
  SubmitValidatedWordpressReferenceLoopInput,
  SubmitValidatedWordpressReferenceLoopResult,
  WordpressReferenceLoopSubmissionDeps,
} from './types'

export type {
  SubmitValidatedWordpressReferenceLoopInput,
  SubmitValidatedWordpressReferenceLoopResult,
  WordpressReferenceLoopSubmissionDeps,
} from './types'

function sameWordpressSnapshot(
  preparation: SubmitValidatedWordpressReferenceLoopInput['preparation'],
  target: SubmitValidatedWordpressReferenceLoopInput['target'],
): boolean {
  const snapshot = preparation.snapshot
  return snapshot.ok && snapshot.provider === 'wordpress' &&
    snapshot.fetchedAt === target.snapshot.fetchedAt &&
    snapshot.versionToken === target.snapshot.versionToken &&
    snapshot.rawFields.title === target.snapshot.rawFields.title &&
    snapshot.rawFields.content === target.snapshot.rawFields.content &&
    snapshot.rawFields.seoTitle === target.snapshot.rawFields.seoTitle &&
    snapshot.rawFields.seoDescription === target.snapshot.rawFields.seoDescription
}

function interpretOutcome(outcome: ActionRunOutcome): SubmitValidatedWordpressReferenceLoopResult {
  const runId = outcome.run.id
  if (outcome.kind === 'pending_approval') {
    const authorizationDecisionId = outcome.run.authorization_decision_id
    return authorizationDecisionId
      ? { ok: true, outcome: 'pending_approval', runId, authorizationDecisionId }
      : { ok: false, reason: 'kernel_inconsistent_pending_approval', runId }
  }
  if (outcome.kind === 'denied') {
    return { ok: false, reason: 'kernel_denied', runId, humanReason: outcome.humanReason }
  }
  if (outcome.kind === 'dead_letter') {
    return { ok: false, reason: 'kernel_dead_letter', runId, humanReason: outcome.humanReason }
  }
  return { ok: false, reason: 'kernel_unexpected_outcome', runId, outcomeKind: outcome.kind }
}

function notReady(
  detail: Extract<SubmitValidatedWordpressReferenceLoopResult, { reason: 'reference_loop_not_ready' }>['detail'],
): SubmitValidatedWordpressReferenceLoopResult {
  return { ok: false, reason: 'reference_loop_not_ready', detail }
}

function gscPropertyOwnsPage(property: string, pageUrl: string): boolean {
  if (property.startsWith('sc-domain:')) {
    return judgeDomainOwnership(`https://${property.slice('sc-domain:'.length)}`, pageUrl) === 'owned'
  }
  return judgeDomainOwnership(property, pageUrl) === 'owned'
}

/** The production signer is deliberately private to this specialized gate. */
function signAuthorizationContext(payload: GrowthJsonValue): string | null {
  const secret = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) return null
  return `hmac-sha256:${createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(canonicalHashOfInput(payload))
    .digest('hex')}`
}

/**
 * The only WordPress submission gate for a Reference Loop preparation.
 * Validation failure cannot be represented as a Kernel submission.
 */
export async function submitValidatedWordpressReferenceLoop(
  deps: WordpressReferenceLoopSubmissionDeps,
  input: SubmitValidatedWordpressReferenceLoopInput,
): Promise<SubmitValidatedWordpressReferenceLoopResult> {
  const { preparation, target, sourceReceipt, kernelMeta } = input
  if (!isValidatedReferenceLoopPreparation(preparation)) return notReady('preparation_untrusted')
  if (!isGscPageQueryEvidenceReceipt(sourceReceipt)) return notReady('source_receipt_untrusted')
  if (preparation.authorizationReadiness !== 'validation_passed' || !preparation.validation.ok) {
    return notReady('validation_not_passed')
  }
  if (!preparation.diff.ok) return notReady('diff_not_available')
  if (preparation.requestedChange.some(({ field }) => field === 'content_html')) {
    return notReady('wordpress_body_change_not_supported')
  }
  if (!preparation.diff.changes.some(({ changed }) => changed)) return notReady('diff_not_available')
  if (!preparation.snapshot.ok || preparation.snapshot.provider !== 'wordpress') {
    return notReady('wordpress_snapshot_required')
  }
  if (preparation.clientId !== kernelMeta.clientId) return notReady('client_id_mismatch')
  if (
    !isTenantBoundWordpressSource(target) ||
    target.clientId !== preparation.clientId ||
    target.targetPageUrl !== preparation.targetPageUrl ||
    !sameWordpressSnapshot(preparation, target)
  ) {
    return notReady('wordpress_source_mismatch')
  }
  if (Object.keys(sourceReceipt).length === 0) return notReady('source_receipt_empty')
  if (
    !sourceReceipt.evidence_source_id.trim() ||
    !preparation.evidenceRefs.some(({ source, observedAt }) =>
      source.sourceId === sourceReceipt.evidence_source_id &&
      observedAt === sourceReceipt.collected_at)
  ) return notReady('source_receipt_mismatch')
  if (
    judgeDomainOwnership(sourceReceipt.page, target.targetPageUrl) !== 'owned' ||
    !gscPropertyOwnsPage(sourceReceipt.property, target.targetPageUrl) ||
    !preparation.provenance.window.known ||
    preparation.provenance.window.value.startAt !== sourceReceipt.start_date ||
    preparation.provenance.window.value.endAt !== sourceReceipt.end_date
  ) {
    return notReady('source_receipt_mismatch')
  }

  const validatedDiffHash = canonicalDiffHash(preparation.diff.changes)
  const authorizedAction: { readonly [key: string]: GrowthJsonValue } = {
    page_url: preparation.request.page.url,
    page_version_token: preparation.snapshot.versionToken,
    validated_diff_hash: validatedDiffHash,
    intents: preparation.request.intents as unknown as GrowthJsonValue,
    do_not_touch: preparation.request.constraints.doNotTouch as unknown as GrowthJsonValue,
    wordpress_post_id: target.postId,
    wordpress_post_type: target.postType,
  }

  const unsignedAuthorizationContext: { readonly [key: string]: GrowthJsonValue } = {
    client_id: preparation.clientId,
    validation_passed: true,
    page_ledger_ref: target.pageLedgerRef,
    finding_refs: preparation.findingRefs,
    evidence_refs: preparation.evidenceRefs.map((reference) => ({
      source: {
        kind: reference.source.kind,
        sourceId: reference.source.sourceId,
      },
      observedAt: reference.observedAt,
    })),
    target_page_url: preparation.targetPageUrl,
    requested_change: preparation.requestedChange.map((intent): GrowthJsonValue => {
      const semanticIntent: GrowthJsonValue = intent.semanticIntent.known
        ? { known: true, value: intent.semanticIntent.value }
        : { known: false, reason: intent.semanticIntent.reason }
      return {
        field: intent.field,
        proposedValue: intent.proposedValue,
        semanticIntent,
      }
    }),
    verification: {
      metricRef: preparation.verification.metricRef,
      windowDays: preparation.verification.windowDays,
      baseline: preparation.verification.baseline,
      criteria: {
        success: preparation.verification.criteria.success,
        failure: preparation.verification.criteria.failure,
        indeterminate: preparation.verification.criteria.indeterminate,
      },
    },
    provenance: {
      clientIdSource: preparation.provenance.clientIdSource,
      targetPageUrlSource: preparation.provenance.targetPageUrlSource,
      findingSource: preparation.provenance.findingSource,
      prescriptionSource: preparation.provenance.prescriptionSource,
      intentsSource: preparation.provenance.intentsSource,
      snapshotSource: preparation.provenance.snapshotSource,
      redlineSource: preparation.provenance.redlineSource,
      providerCheckSource: preparation.provenance.providerCheckSource,
      verificationSource: preparation.provenance.verificationSource,
      findingRefsSource: preparation.provenance.findingRefsSource,
      collectedAt: preparation.provenance.collectedAt,
      window: { known: true, value: {
        startAt: preparation.provenance.window.value.startAt,
        endAt: preparation.provenance.window.value.endAt,
      } },
    },
    source_binding: {
      client_source: target.provenance.clientSource,
      page_ledger_source: target.provenance.pageLedgerSource,
      connection_source: target.provenance.connectionSource,
      post_source: target.provenance.postSource,
    },
    authorized_action: authorizedAction,
    action_digest: canonicalHashOfInput(authorizedAction),
    growth_lineage: {
      finding_hash: canonicalHashOfInput(preparation.finding),
      finding: preparation.finding as unknown as GrowthJsonValue,
      prescription: preparation.prescription as unknown as GrowthJsonValue,
    },
    source_receipt: sourceReceipt as unknown as GrowthJsonValue,
  }
  const authorizationProof = signAuthorizationContext(unsignedAuthorizationContext)
  if (!authorizationProof) return notReady('authorization_proof_unavailable')
  const authorizationContext: { readonly [key: string]: GrowthJsonValue } = {
    ...unsignedAuthorizationContext,
    authorization_proof: authorizationProof,
  }

  const mapping = deps.caller.mapCandidate({
    domain: 'seo',
    intent: 'apply_wordpress_page_metadata',
  })
  if (mapping.outcome === 'rejected') {
    return {
      ok: false,
      reason: 'bridge_rejected',
      bridgeCode: mapping.code,
      bridgeReason: mapping.reason,
    }
  }
  if (mapping.submissionBoundary !== 'wordpress_reference_loop') {
    return notReady('submission_boundary_mismatch')
  }
  if (!preparation.request.basedOnVersion.known) return notReady('wordpress_snapshot_required')

  const submitInput: SubmitActionInput = {
    clientId: kernelMeta.clientId,
    actionKey: mapping.actionKey,
    purpose: kernelMeta.purpose,
    goalId: kernelMeta.goalId ?? null,
    executionItemId: kernelMeta.executionItemId ?? null,
    triggeredBy: kernelMeta.triggeredBy,
    triggeredByRef: kernelMeta.triggeredByRef ?? null,
    rationale: kernelMeta.rationale ?? null,
    evidence: { authorization_context: authorizationContext },
    ...(kernelMeta.correlationId ? { correlationId: kernelMeta.correlationId } : {}),
    input: {
      page_url: preparation.request.page.url,
      page_version_token: preparation.request.basedOnVersion.value,
      validated_diff_hash: validatedDiffHash,
      intents: preparation.request.intents,
      do_not_touch: preparation.request.constraints.doNotTouch,
      wordpress_post_id: target.postId,
      wordpress_post_type: target.postType,
      authorization_context: authorizationContext,
    },
  }
  return interpretOutcome(await deps.caller.runAction(deps.caller.kernelDeps, submitInput))
}
