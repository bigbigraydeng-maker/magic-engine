import { createHmac } from 'node:crypto'
import {
  createGscPageQueryEvidenceReceipt,
  fetchGscPageQueryReport,
} from '@/lib/gsc/client'
import { loadTenantBoundCtsGithubSource } from '@/lib/capabilities/page-apply-cts-github/source'
import {
  prepareCtsGithubReferenceLoop,
  type CtsGithubReferenceLoopPreparation,
} from '@/lib/cts-github-reference-loop'
import { CTS_CLIENT_ID } from '@/lib/seo-meta/cts-meta-source'
import { loadTrustedClientRedlines } from '@/lib/db/client-redlines'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import type { GrowthJsonValue } from '@/lib/growth'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'
import type {
  CtsGithubReferenceLoopTriggerDeps,
  CtsGithubReferenceLoopTriggerInput,
  CtsGithubReferenceLoopTriggerResult,
  SubmitCtsGithubReferenceLoopResult,
} from './types'

export type {
  CtsGithubReferenceLoopTriggerDeps,
  CtsGithubReferenceLoopTriggerInput,
  CtsGithubReferenceLoopTriggerResult,
  SubmitCtsGithubReferenceLoopResult,
} from './types'

const CTS_GSC_PROPERTY = 'sc-domain:ctstours.co.nz'
const CTS_GSC_COUNTRY = 'nzl'

function canonicalCtsPage(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (hostname !== 'ctstours.co.nz') return null
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    return `${hostname}${pathname}`
  } catch {
    return null
  }
}

function notReady(
  detail: Extract<CtsGithubReferenceLoopTriggerResult, {
    reason: 'cts_trigger_not_ready'
  }>['detail'],
  upstreamReason?: string,
): CtsGithubReferenceLoopTriggerResult {
  return {
    ok: false,
    reason: 'cts_trigger_not_ready',
    detail,
    ...(upstreamReason ? { upstreamReason } : {}),
  }
}

function submissionNotReady(
  detail: Extract<SubmitCtsGithubReferenceLoopResult, {
    reason: 'cts_reference_loop_not_ready'
  }>['detail'],
): SubmitCtsGithubReferenceLoopResult {
  return { ok: false, reason: 'cts_reference_loop_not_ready', detail }
}

function sign(payload: GrowthJsonValue): string | null {
  const secret = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) return null
  return `hmac-sha256:${createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(canonicalHashOfInput(payload))
    .digest('hex')}`
}

function interpret(outcome: ActionRunOutcome): SubmitCtsGithubReferenceLoopResult {
  const runId = outcome.run.id
  if (outcome.kind === 'pending_approval') {
    const decisionId = outcome.run.authorization_decision_id
    return decisionId
      ? { ok: true, outcome: 'pending_approval', runId, authorizationDecisionId: decisionId }
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

async function submitPreparedCtsAction(
  deps: CtsGithubReferenceLoopTriggerDeps,
  preparation: CtsGithubReferenceLoopPreparation,
  kernelMeta: CtsGithubReferenceLoopTriggerInput['kernel'] & { readonly goalId?: string | null },
): Promise<SubmitCtsGithubReferenceLoopResult> {
  if (preparation.clientId !== CTS_CLIENT_ID) return submissionNotReady('client_id_mismatch')
  if (process.env.CTS_GITHUB_METADATA_ACTION_ENABLED !== 'true') {
    return submissionNotReady('rollout_disabled')
  }
  const source = preparation.source
  const authorizedAction: { readonly [key: string]: GrowthJsonValue } = {
    page_url: preparation.request.page.url,
    page_version_token: source.versionToken,
    validated_diff_hash: preparation.validatedDiffHash,
    intents: preparation.request.intents as unknown as GrowthJsonValue,
    headline: preparation.headline as unknown as GrowthJsonValue,
    do_not_touch: preparation.request.constraints.doNotTouch as unknown as GrowthJsonValue,
    github_repo_owner: source.repoOwner,
    github_repo_name: source.repoName,
    github_default_branch: source.defaultBranch,
    github_content_path: source.contentPath,
    github_entry_slug: source.entrySlug,
  }
  const unsignedContext: { readonly [key: string]: GrowthJsonValue } = {
    client_id: preparation.clientId,
    validation_passed: true,
    target_page_url: source.targetPageUrl,
    page_ledger_ref: source.pageLedgerRef,
    source_receipt: preparation.sourceReceipt as unknown as GrowthJsonValue,
    source_binding: {
      client_source: source.provenance.clientSource,
      page_ledger_source: source.provenance.pageLedgerSource,
      connection_source: source.provenance.connectionSource,
      provider_source: source.provenance.providerSource,
      repo_owner: source.repoOwner,
      repo_name: source.repoName,
      default_branch: source.defaultBranch,
      content_path: source.contentPath,
      entry_slug: source.entrySlug,
      version_token: source.versionToken,
    },
    growth_lineage: {
      finding_hash: canonicalHashOfInput(preparation.finding),
      finding: preparation.finding as unknown as GrowthJsonValue,
      prescription: preparation.prescription as unknown as GrowthJsonValue,
      finding_refs: preparation.findingRefs,
      verification: preparation.verification as unknown as GrowthJsonValue,
    },
    redline_source: preparation.redlineSource,
    authorized_action: authorizedAction,
    action_digest: canonicalHashOfInput(authorizedAction),
  }
  const proof = sign(unsignedContext)
  if (!proof) return submissionNotReady('authorization_proof_unavailable')
  const authorizationContext: { readonly [key: string]: GrowthJsonValue } = {
    ...unsignedContext,
    authorization_proof: proof,
  }
  const mapping = deps.caller.mapCandidate({
    domain: 'seo',
    intent: 'clarify_page_query_url_ownership',
  })
  if (mapping.outcome === 'rejected') {
    return {
      ok: false,
      reason: 'bridge_rejected',
      bridgeCode: mapping.code,
      bridgeReason: mapping.reason,
    }
  }
  if (mapping.submissionBoundary !== 'cts_github_reference_loop') {
    return submissionNotReady('submission_boundary_mismatch')
  }
  const submitInput: SubmitActionInput = {
    clientId: CTS_CLIENT_ID,
    actionKey: mapping.actionKey,
    purpose: 'growth',
    goalId: kernelMeta.goalId ?? null,
    executionItemId: null,
    triggeredBy: kernelMeta.triggeredBy,
    triggeredByRef: kernelMeta.triggeredByRef ?? null,
    rationale: kernelMeta.rationale ?? null,
    evidence: { authorization_context: authorizationContext },
    ...(kernelMeta.correlationId ? { correlationId: kernelMeta.correlationId } : {}),
    input: { ...authorizedAction, authorization_context: authorizationContext },
  }
  return interpret(await deps.caller.runAction(deps.caller.kernelDeps, submitInput))
}

/**
 * One-process controlled trigger: live GSC read → trusted receipt/source →
 * validated CTS preparation → Kernel pending approval.
 *
 * It never generates copy, resolves credentials, commits, opens a PR or deploys.
 */
export async function triggerCtsGithubMetadataReferenceLoop(
  deps: CtsGithubReferenceLoopTriggerDeps,
  input: CtsGithubReferenceLoopTriggerInput,
): Promise<CtsGithubReferenceLoopTriggerResult> {
  if (process.env.CTS_GITHUB_METADATA_ACTION_ENABLED !== 'true') {
    return notReady('rollout_disabled')
  }

  const evidencePageIdentity = canonicalCtsPage(input.gsc.evidencePageUrl)
  if (!evidencePageIdentity) {
    return notReady('gsc_scope_invalid')
  }

  const redlines = await loadTrustedClientRedlines(CTS_CLIENT_ID)
  if (!redlines.redline.available) return notReady('redline_not_ready')

  const reportParams = {
    accessToken: input.gsc.accessToken,
    siteUrl: CTS_GSC_PROPERTY,
    startDate: input.gsc.startDate,
    endDate: input.gsc.endDate,
    country: CTS_GSC_COUNTRY,
    rowLimit: 250,
  }
  const rows = await fetchGscPageQueryReport(reportParams)
  const matches = rows.filter((row) =>
    row.page === input.gsc.evidencePageUrl && row.query === input.gsc.query)
  if (matches.length === 0) return notReady('gsc_row_not_found')
  if (matches.length !== 1) return notReady('gsc_row_ambiguous')

  const receipt = createGscPageQueryEvidenceReceipt({
    siteUrl: CTS_GSC_PROPERTY,
    startDate: input.gsc.startDate,
    endDate: input.gsc.endDate,
    country: CTS_GSC_COUNTRY,
  }, matches[0])
  const loaded = await loadTenantBoundCtsGithubSource({
    clientId: CTS_CLIENT_ID,
    pageId: input.pageId,
  })
  if (!loaded.ok) return notReady('source_not_ready', loaded.reason)
  const targetPageIdentity = canonicalCtsPage(loaded.source.targetPageUrl)
  if (!targetPageIdentity) return notReady('source_not_ready', 'target_scope_invalid')
  if (evidencePageIdentity === targetPageIdentity) return notReady('evidence_target_same')

  const finding = {
    pillar: 'seo' as const,
    severity: receipt.clicks === 0 && receipt.impressions >= 100
      ? 'high' as const
      : 'medium' as const,
    statement: `Google Search Console returned “${receipt.query}” for ${receipt.page} ` +
      `(${receipt.clicks} clicks, ${receipt.impressions} impressions, ` +
      `CTR ${receipt.ctr}, position ${receipt.position}); ` +
      `the proposed metadata target is ${loaded.source.targetPageUrl}.`,
    evidence: [{
      source: { kind: 'gsc', sourceId: receipt.evidence_source_id },
      observedAt: receipt.collected_at,
      rawLocator: {
        known: true as const,
        value: `${receipt.property}:${receipt.start_date}:${receipt.end_date}:${receipt.page}:${receipt.query}`,
      },
      interpretation: {
        known: true as const,
        value: { parserVersion: 'gsc-page-query-v1' },
      },
      confidence: { known: true as const, value: 1 },
    }],
  }
  const prepared = prepareCtsGithubReferenceLoop({
    clientId: CTS_CLIENT_ID,
    source: loaded.source,
    sourceReceipt: receipt,
    finding,
    prescription: {
      goalId: input.growth.goalId
        ? { known: true, value: input.growth.goalId }
        : { known: false, reason: 'not_recorded_by_source' },
      covers: [finding],
      notDoing: [{
        statement: 'Do not change page body content.',
        reason: 'CTS GitHub intent action v2 is limited to title, description and H1.',
      }],
      orderingRationale: input.growth.orderingRationale,
    },
    findingRefs: [`gsc:${receipt.evidence_source_id}`],
    intents: [
      {
        field: 'meta_title',
        proposedValue: input.proposal.title,
        semanticIntent: { known: true, value: input.proposal.titleRationale },
      },
      {
        field: 'meta_description',
        proposedValue: input.proposal.description,
        semanticIntent: { known: true, value: input.proposal.descriptionRationale },
      },
    ],
    headline: {
      proposedValue: input.proposal.h1,
      semanticIntent: input.proposal.h1Rationale,
    },
    verification: {
      metricRef: 'gsc.page_query.url_ownership',
      windowDays: input.growth.verification.windowDays,
      baseline: input.growth.verification.baseline,
      criteria: {
        success: input.growth.verification.success,
        failure: input.growth.verification.failure,
        indeterminate: input.growth.verification.indeterminate,
      },
    },
    redline: redlines.redline,
    redlineSource: redlines.source,
  })
  if (!prepared.ok) return notReady('preparation_not_ready', prepared.reason)

  return submitPreparedCtsAction(deps, prepared.preparation, {
    ...input.kernel,
    goalId: input.growth.goalId ?? null,
  })
}
