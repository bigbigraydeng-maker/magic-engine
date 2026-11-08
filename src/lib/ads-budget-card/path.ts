/**
 * The card asks the existing budget action to run.
 * It does not write a budget itself.
 */

import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { computeIdempotencyKey } from '@/lib/kernel/idempotency'
import type { BudgetOrder } from './types'
import type { PrescriptionLock } from './prescription-lock'

export interface BudgetExecuteCall {
  readonly clientId: string
  readonly goalId: string
  readonly cycleDate: string
  readonly adAccountId: string
  readonly adsetId: string
  readonly beforeCents: number
  readonly afterCents: number
  readonly nonce: string
  readonly raising: boolean
  readonly idempotencyKey: string
}

export interface BudgetExecuteResult {
  readonly kind: 'executed' | 'mismatch' | 'awaiting' | 'refused' | 'in_progress'
  readonly wrote: boolean
  readonly readbackCents: number | null
  readonly actionRunId: string | null
  readonly reason: string
}

export interface BudgetPath {
  execute(call: BudgetExecuteCall): Promise<BudgetExecuteResult>
}

export interface BudgetOutcomeView {
  readonly kind: string
  readonly runId: string
  readonly humanReason: string | null
  readonly readbackCents: number | null
  readonly verificationPassed: boolean | null
}

const SCALE_KEY = 'ads.scale_unit_budget'
const CUT_KEY = 'ads.cut_unit_budget'

export function budgetNonce(lock: PrescriptionLock): string {
  return `${lock.prescriptionId}:v${lock.version}`
}

export function budgetStepIdempotencyKey(
  clientId: string,
  order: BudgetOrder,
  beforeCents: number,
  lock: PrescriptionLock,
): string | null {
  const raising = order.newDailyBudgetCents > beforeCents
  const definition = ACTION_REGISTRY.get(raising ? SCALE_KEY : CUT_KEY)
  if (!definition) return null
  try {
    return computeIdempotencyKey(
      definition,
      clientId,
      kernelInput({
        cycleDate: lock.approvedOn,
        adAccountId: order.adAccountId,
        adsetId: order.adsetId,
        beforeCents,
        afterCents: order.newDailyBudgetCents,
        raising,
      }),
      budgetNonce(lock),
    )
  } catch {
    return null
  }
}

export function executeCall(
  clientId: string,
  order: BudgetOrder,
  beforeCents: number,
  lock: PrescriptionLock,
  idempotencyKey: string,
): BudgetExecuteCall {
  return {
    clientId,
    goalId: lock.goalId,
    cycleDate: lock.approvedOn,
    adAccountId: order.adAccountId,
    adsetId: order.adsetId,
    beforeCents,
    afterCents: order.newDailyBudgetCents,
    nonce: budgetNonce(lock),
    raising: order.newDailyBudgetCents > beforeCents,
    idempotencyKey,
  }
}

export function kernelInput(call: {
  cycleDate: string
  adAccountId: string
  adsetId: string
  beforeCents: number
  afterCents: number
  raising: boolean
}): Record<string, unknown> {
  const shared = {
    cycle_date: call.cycleDate,
    ad_account_id: call.adAccountId,
    adset_id: call.adsetId,
    after_cents: call.afterCents,
  }
  return call.raising ? { ...shared, before_cents: call.beforeCents } : shared
}

export function readbackFromSteps(
  steps: readonly { step_key: string; output: Record<string, unknown>; verification: { passed: boolean } | null }[],
): { cents: number | null; passed: boolean | null } {
  const step = steps.find((item) => item.step_key === 'readback')
  if (!step) return { cents: null, passed: null }
  const raw = step.output.daily_budget_now
  const cents = typeof raw === 'number' && Number.isSafeInteger(raw) ? raw : null
  const passed = step.verification ? step.verification.passed === true : null
  return { cents, passed }
}

export function interpretBudgetOutcome(view: BudgetOutcomeView, afterCents: number): BudgetExecuteResult {
  if (view.kind === 'pending_approval' || view.kind === 'in_progress') return awaiting(view)
  if (view.kind === 'succeeded' || view.kind === 'idempotent_hit') return finished(view, afterCents)
  if (view.kind === 'dead_letter' && view.verificationPassed === false) return mismatch(view)
  return refused(view)
}

function awaiting(view: BudgetOutcomeView): BudgetExecuteResult {
  return {
    kind: 'awaiting',
    wrote: false,
    readbackCents: null,
    actionRunId: view.runId,
    reason: view.humanReason ?? '还在等已有的预算批准，没有从这张卡再写一次。',
  }
}

function finished(view: BudgetOutcomeView, afterCents: number): BudgetExecuteResult {
  const matched = view.verificationPassed === true && view.readbackCents === afterCents
  if (!matched) return mismatch(view)
  return {
    kind: 'executed',
    wrote: view.kind === 'succeeded',
    readbackCents: view.readbackCents,
    actionRunId: view.runId,
    reason: '已改好，回读的日预算和要改的一致。',
  }
}

function mismatch(view: BudgetOutcomeView): BudgetExecuteResult {
  const unread = view.readbackCents == null
  return {
    kind: 'mismatch',
    wrote: view.kind === 'succeeded' || view.readbackCents != null,
    readbackCents: view.readbackCents,
    actionRunId: view.runId,
    reason: unread
      ? '回读不到日预算，已标失败，没有再写一次。'
      : '回读的日预算和要改的不一样，已标失败，没有再写一次。',
  }
}

function refused(view: BudgetOutcomeView): BudgetExecuteResult {
  return {
    kind: 'refused',
    wrote: false,
    readbackCents: view.readbackCents,
    actionRunId: view.runId,
    reason: view.humanReason ?? '已有的预算路径没有改，没有再写一次。',
  }
}
