/**
 * An approved prescription issues one budget-step card.
 * Confirm re-checks the prescription and the ad set budget, then asks the
 * existing budget path to run. A stuck `writing` row is not retried.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { decideConfirmationCard, issueConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { budgetFacts, budgetOrderKey, budgetSubject } from './facts'
import { guardBudget } from './guard'
import {
  claimWrite,
  holdForCard,
  insertHold,
  retireStale,
  saveHold,
  type BudgetHold,
  type HoldRow,
} from './ledger'
import { budgetStepIdempotencyKey, executeCall, type BudgetExecuteResult, type BudgetPath } from './path'
import { sameLock, type PrescriptionLock, type VersionLockSource } from './prescription-lock'
import type { BudgetOrder, BudgetRuntime, BudgetSnapshot } from './types'

export interface BudgetIssueResult {
  readonly status: 'issued' | 'blocked'
  readonly reason: string | null
  readonly card: ConfirmationCardView | null
}

export interface BudgetSubmitResult {
  readonly status: 'executed' | 'failed' | 'blocked' | 'declined' | 'done' | 'awaiting'
  readonly reason: string
  readonly wroteMeta: boolean
  readonly readbackCents: number | null
  readonly card: ConfirmationCardView | null
}

export async function issueBudgetCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  order: BudgetOrder
  runtime: BudgetRuntime
  locks: VersionLockSource
  now?: Date
}): Promise<BudgetIssueResult> {
  assertMayClick(args.clicker, args.clientId)
  const locked = await args.locks.read(args.clientId, args.order.prescriptionId)
  if (!locked.ok) return { status: 'blocked', reason: locked.reason, card: null }
  const live = await args.runtime.read(args.order)
  const early = earlyBlock(live)
  if (early) return { status: 'blocked', reason: early, card: null }
  const guard = guardBudget(args.order, live, null)
  const key = budgetStepIdempotencyKey(args.clientId, args.order, live.currentCents as number, locked.lock)
  if (!key) return { status: 'blocked', reason: '这张卡算不出幂等键，没有出卡。', card: null }
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: budgetFacts(args.order, live, guard.checks),
    now: args.now ?? args.kernel.now(),
  })
  await retireStale(args.kernel.supabase, args.clientId, budgetSubject(args.order), card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, holdFrom(args.order, live, locked.lock, key, card))
  return { status: guard.block ? 'blocked' : 'issued', reason: guard.block, card }
}

export async function submitBudgetCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  runtime: BudgetRuntime
  locks: VersionLockSource
  path: BudgetPath
  now?: Date
}): Promise<BudgetSubmitResult> {
  assertMayClick(args.clicker, args.clientId)
  const row = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return stopped('找不到这张改日预算的卡，没有改。')
  if (row.payload.status === 'writing') return needsHuman()
  if (row.payload.status !== 'holding' && row.payload.status !== 'awaiting') return already(row.payload)
  if (args.resolution === 'decline') return row.payload.status === 'holding' ? decline(args, row) : already(row.payload)
  return confirm(args, row)
}

function earlyBlock(live: BudgetSnapshot): string | null {
  if (live.stepRatio === 'unreadable') return '允许的调整幅度读不到，没有出卡。'
  if (live.stepRatio === 'off') return '这个客户关掉了调整日预算的确认卡。'
  if (live.stepRatio === 'invalid') return '这个客户允许的调整幅度设置无效，没有出卡。'
  if (!Number.isSafeInteger(live.currentCents) || (live.currentCents ?? 0) <= 0) {
    return '现日预算读不到，没有按 0 出卡。'
  }
  return null
}

async function confirm(args: Parameters<typeof submitBudgetCard>[0], row: HoldRow): Promise<BudgetSubmitResult> {
  if (row.payload.status === 'holding') {
    const block = await recheck(args, row)
    if (block) return stopped(block)
    const decided = await confirmDecision(args)
    if (!decided.ok) return stopped('这张卡没有确认成功，没有改日预算。')
    const email = args.clicker.kind === 'opc' || args.clicker.kind === 'fde' ? args.clicker.email : ''
    const claimed = await claimWrite(args.kernel.supabase, args.clientId, row, email)
    if (!claimed) return lostRace(args)
    return runPath(args, row, email, decided.card, true)
  }
  return runPath(args, row, row.payload.confirmedBy, null, false)
}

async function recheck(args: Parameters<typeof submitBudgetCard>[0], row: HoldRow): Promise<string | null> {
  const locked = await args.locks.read(args.clientId, row.payload.order.prescriptionId)
  if (!locked.ok) return locked.reason
  if (!sameLock(row.payload.lock, locked.lock)) {
    return '处方的版本、目标或计划变了，这张卡作废，没有改。'
  }
  const live = await args.runtime.read(row.payload.order)
  return guardBudget(row.payload.order, live, row.payload.beforeCents).block
}

async function runPath(
  args: Parameters<typeof submitBudgetCard>[0],
  row: HoldRow,
  email: string | null,
  card: ConfirmationCardView | null,
  claimed: boolean,
): Promise<BudgetSubmitResult> {
  const call = executeCall(args.clientId, row.payload.order, row.payload.beforeCents, row.payload.lock, row.payload.idempotencyKey)
  try {
    const result = await args.path.execute(call)
    return record(args, row, email, card, result)
  } catch {
    if (!claimed) await markWriting(args, row, email)
    return needsHuman()
  }
}

async function record(
  args: Parameters<typeof submitBudgetCard>[0],
  row: HoldRow,
  email: string | null,
  card: ConfirmationCardView | null,
  result: BudgetExecuteResult,
): Promise<BudgetSubmitResult> {
  const payload = payloadFrom(row.payload, email, result)
  await saveHold(args.kernel.supabase, args.clientId, row, payload)
  const status = payload.status === 'executed' || payload.status === 'awaiting' || payload.status === 'failed'
    ? payload.status
    : 'failed'
  return { status, reason: payload.resultLine ?? '', wroteMeta: payload.wroteMeta, readbackCents: payload.readbackCents, card }
}

function payloadFrom(prev: BudgetHold, email: string | null, result: BudgetExecuteResult): BudgetHold {
  const status = result.kind === 'executed' ? 'executed' : result.kind === 'awaiting' ? 'awaiting' : 'failed'
  return {
    ...prev,
    status,
    confirmedBy: email,
    actionRunId: result.actionRunId,
    writeAttempted: result.kind !== 'awaiting' && result.kind !== 'refused' ? true : prev.writeAttempted,
    wroteMeta: result.wrote,
    readbackCents: result.readbackCents,
    readbackMatched: result.kind === 'executed' ? true : result.kind === 'mismatch' ? false : null,
    resultLine: result.reason,
  }
}

async function markWriting(
  args: Parameters<typeof submitBudgetCard>[0],
  row: HoldRow,
  email: string | null,
): Promise<void> {
  await saveHold(args.kernel.supabase, args.clientId, row, {
    ...row.payload,
    status: 'writing',
    confirmedBy: email,
    writeAttempted: true,
    resultLine: '改日预算停在半路，没有再写一次。',
  }).catch(() => undefined)
}

async function decline(args: Parameters<typeof submitBudgetCard>[0], row: HoldRow): Promise<BudgetSubmitResult> {
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args))
  const email = args.clicker.kind === 'opc' || args.clicker.kind === 'fde' ? args.clicker.email : null
  const payload: BudgetHold = {
    ...row.payload,
    status: 'declined',
    confirmedBy: email,
    writeAttempted: false,
    wroteMeta: false,
    resultLine: '没有改日预算。',
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload)
  return { status: 'declined', reason: '没有改日预算。', wroteMeta: false, readbackCents: null, card }
}

async function confirmDecision(
  args: Parameters<typeof submitBudgetCard>[0],
): Promise<{ ok: boolean; card: ConfirmationCardView | null }> {
  try {
    const card = await decideConfirmationCard(args.kernel, decisionArgs(args))
    return { ok: card.status === 'confirmed', card }
  } catch (error) {
    if (!(error instanceof ConfirmationCardError) || error.code !== 'not_waiting') throw error
    const run = await args.kernel.requireRun(args.runId)
    return { ok: run.status === 'authorized' || run.status === 'succeeded', card: null }
  }
}

async function lostRace(args: Parameters<typeof submitBudgetCard>[0]): Promise<BudgetSubmitResult> {
  const again = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!again) return stopped('这张卡已经有人在处理。')
  if (again.payload.status === 'writing') return needsHuman()
  return already(again.payload)
}

function holdFrom(
  order: BudgetOrder,
  live: BudgetSnapshot,
  lock: PrescriptionLock,
  idempotencyKey: string,
  card: ConfirmationCardView,
): BudgetHold {
  return {
    kind: 'adset_daily_budget',
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: budgetSubject(order),
    fingerprint: card.fingerprint,
    orderKey: budgetOrderKey(order),
    order,
    lock,
    idempotencyKey,
    beforeCents: live.currentCents as number,
    afterCents: order.newDailyBudgetCents,
    direction: order.direction,
    observationWindowDays: order.observationWindowDays,
    confirmedBy: null,
    actionRunId: null,
    readbackCents: null,
    readbackMatched: null,
    writeAttempted: false,
    wroteMeta: false,
  }
}

function already(payload: BudgetHold): BudgetSubmitResult {
  const status = payload.status === 'executed' || payload.status === 'awaiting' || payload.status === 'failed'
    ? payload.status
    : 'done'
  return {
    status,
    reason: payload.resultLine ?? '这张卡已经有结果了，没有再改日预算。',
    wroteMeta: payload.wroteMeta === true,
    readbackCents: payload.readbackCents,
    card: null,
  }
}

function needsHuman(): BudgetSubmitResult {
  return {
    status: 'failed',
    reason: '这张卡停在正在写，没有自动再写一次。要人看台账。',
    wroteMeta: false,
    readbackCents: null,
    card: null,
  }
}

function stopped(reason: string): BudgetSubmitResult {
  return { status: 'blocked', reason, wroteMeta: false, readbackCents: null, card: null }
}

function decisionArgs(args: Parameters<typeof submitBudgetCard>[0]) {
  return {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
    now: args.now,
  }
}
