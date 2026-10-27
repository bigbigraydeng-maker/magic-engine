import {
  PLAN_DRAFT_OVERLAP_NOTE,
  planDraftAlreadyLine,
  planDraftEventNotSentLine,
  planDraftNetworkLine,
  withOverlap,
} from './plan-draft-card'
import { buildPlanDraft } from './plan-draft-build'
import { isRetryablePlanDraftError, planDraftFailureDisposition } from './plan-draft-retry'
import type {
  BuiltDraft,
  DraftPrescriptionRow,
  PlanDraftDeps,
  PlanDraftOutcome,
  PlanDraftReceipt,
  PlanDraftRequest,
} from './plan-draft-types'
import { isUsableDraft } from './plan-draft-types'

const NO_WRITE: PlanDraftOutcome = { wrote: false, receipt: null, retryable: false }

function makeReceipt(
  req: PlanDraftRequest,
  built: BuiltDraft,
  text: string,
  overlap: boolean,
  at: string,
): PlanDraftReceipt {
  return {
    request_id: req.requestId,
    attempt: req.attempt,
    status: built.status,
    reason_code: built.reasonCode,
    reason_text: text,
    ...(built.planId ? { plan_id: built.planId } : {}),
    graph_reads: 0,
    no_publish: true,
    authorization: 'none',
    triggered_by: 'agent',
    ...(overlap ? { overlap_note: PLAN_DRAFT_OVERLAP_NOTE } : {}),
    ...(built.escalated ? { escalated: true } : {}),
    at,
  }
}

async function scheduleOrNote(
  req: PlanDraftRequest,
  deps: PlanDraftDeps,
  receipt: PlanDraftReceipt,
): Promise<void> {
  try {
    await deps.scheduleRetry({
      request_id: req.requestId,
      attempt: req.attempt + 1,
      client_id: req.clientId,
      prescription_id: req.prescriptionId,
      version: req.version,
    })
  } catch {
    await deps.writeReceipt(req.clientId, req.prescriptionId, {
      ...receipt,
      status: 'failed',
      reason_code: 'event_not_sent',
      reason_text: planDraftEventNotSentLine(),
      escalated: false,
    }).catch(() => undefined)
  }
}

async function persist(
  req: PlanDraftRequest,
  row: DraftPrescriptionRow,
  built: BuiltDraft,
  deps: PlanDraftDeps,
): Promise<PlanDraftOutcome> {
  let next = built
  if (built.insert && !req.dryRun) {
    const inserted = await deps.insertPlan(built.insert)
    if (inserted === 'already_exists') {
      next = {
        ...built,
        status: 'already_exists',
        reasonCode: 'already_exists',
        reasonText: planDraftAlreadyLine(req.version),
        planId: built.insert.id,
        insert: undefined,
      }
    }
  }
  const linked = next.status === 'created' || next.status === 'already_exists'
  const overlap = linked
    ? await deps.hasApprovedPlan(req.clientId, row.goal_id ?? '').catch(() => false)
    : false
  const receipt = makeReceipt(req, next, withOverlap(next.reasonText, overlap), overlap, deps.now().toISOString())
  if (req.dryRun) return { wrote: false, receipt: { ...receipt, status: 'dry_run' }, retryable: false }
  await deps.writeReceipt(req.clientId, req.prescriptionId, receipt).catch(() => undefined)
  await deps.recordRun({
    clientId: req.clientId,
    goalId: row.goal_id,
    attempt: req.attempt,
    requestId: req.requestId,
    prescriptionId: req.prescriptionId,
    version: req.version,
    status: receipt.status === 'failed' ? 'failed' : 'succeeded',
    reasonCode: receipt.reason_code,
    reasonText: receipt.reason_text,
    needsHuman: receipt.escalated === true,
  }).catch(() => undefined)
  if (next.retryable) await scheduleOrNote(req, deps, receipt)
  return { wrote: true, receipt, retryable: next.retryable }
}

async function failClosed(
  req: PlanDraftRequest,
  row: DraftPrescriptionRow,
  err: unknown,
  deps: PlanDraftDeps,
): Promise<PlanDraftOutcome> {
  const disposition = planDraftFailureDisposition(req.attempt, err)
  const retryable = disposition.retryable
  const escalated = disposition.escalated
  const network = isRetryablePlanDraftError(err)
  const built: BuiltDraft = {
    status: 'failed',
    reasonCode: escalated ? 'network_exhausted' : network ? 'network' : 'failed',
    reasonText: network || escalated
      ? planDraftNetworkLine(escalated)
      : '计划草稿没生成。这不影响后来批准这份处方。',
    retryable,
    escalated,
  }
  return persist(req, row, built, deps)
}

/**
 * One attempt. Attempt 1 runs inline. Later attempts are woken by Inngest
 * after the backoff. A failure here never changes the prescription status.
 */
export async function attemptPlanDraft(
  req: PlanDraftRequest,
  deps: PlanDraftDeps,
  loaded: DraftPrescriptionRow | null = null,
): Promise<PlanDraftOutcome> {
  let row = loaded
  try {
    const fresh = await deps.loadPrescription(req.clientId, req.prescriptionId)
    row = fresh
    if (!isUsableDraft(fresh) || fresh.version !== req.version) return NO_WRITE
    return await persist(req, fresh, await buildPlanDraft(req, fresh, deps), deps)
  } catch (err) {
    if (!isUsableDraft(row) || row.version !== req.version) return NO_WRITE
    return failClosed(req, row, err, deps).catch(() => NO_WRITE)
  }
}
