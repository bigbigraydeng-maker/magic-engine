/**
 * Issue one ad set budget card, then change the budget only after a person confirms.
 * Readback mismatch is a failure. The Meta write is not repeated.
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
import { claimWrite, holdForCard, insertHold, retireStale, saveHold, type BudgetHold, type HoldRow } from './ledger'
import type { BudgetOrder, BudgetRuntime, BudgetSnapshot } from './types'

export interface BudgetIssueResult {
  readonly status: 'issued' | 'blocked'
  readonly reason: string | null
  readonly card: ConfirmationCardView | null
}

export interface BudgetSubmitResult {
  readonly status: 'executed' | 'failed' | 'blocked' | 'declined' | 'done'
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
  now?: Date
}): Promise<BudgetIssueResult> {
  assertMayClick(args.clicker, args.clientId)
  const live = await args.runtime.read(args.order)
  const early = earlyBlock(live)
  if (early) return { status: 'blocked', reason: early, card: null }
  const guard = guardBudget(args.order, live, null)
  const now = args.now ?? args.kernel.now()
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: budgetFacts(args.order, live, guard.checks),
    now,
  })
  const payload = holdFrom(args.order, live, card)
  await retireStale(args.kernel.supabase, args.clientId, payload.subjectKey, card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, payload)
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
  now?: Date
}): Promise<BudgetSubmitResult> {
  const grant = assertMayClick(args.clicker, args.clientId)
  const row = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return stopped('找不到这张改日预算的卡，没有改。')
  if (row.payload.status !== 'holding') return already(row.payload)
  if (args.resolution === 'decline') return decline(args, row)
  return confirm(args, row, grant.email)
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

async function confirm(
  args: Parameters<typeof submitBudgetCard>[0],
  row: HoldRow,
  email: string,
): Promise<BudgetSubmitResult> {
  const live = await args.runtime.read(row.payload.order)
  const guard = guardBudget(row.payload.order, live, row.payload.beforeCents)
  if (guard.block) return stopped(guard.block)
  const decided = await confirmDecision(args)
  if (!decided.ok) return stopped('这张卡没有确认成功，没有改日预算。')
  const claimed = await claimWrite(args.kernel.supabase, args.clientId, row, email)
  if (!claimed) return lostRace(args)
  return writeOnce(args, row, email, decided.card)
}

async function writeOnce(
  args: Parameters<typeof submitBudgetCard>[0],
  row: HoldRow,
  email: string,
  card: ConfirmationCardView | null,
): Promise<BudgetSubmitResult> {
  const wrote = await args.runtime.write(row.payload.order).catch(() => false)
  const readback = wrote ? await args.runtime.readback(row.payload.order).catch(() => null) : null
  const matched = wrote && readback === row.payload.afterCents
  const payload: BudgetHold = {
    ...row.payload,
    status: matched ? 'executed' : 'failed',
    confirmedBy: email,
    writeAttempted: true,
    wroteMeta: wrote,
    readbackCents: readback,
    readbackMatched: matched,
    resultLine: matched ? '已改好，回读的日预算和要改的一致。' : failLine(wrote, readback),
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload, null)
  return {
    status: matched ? 'executed' : 'failed',
    reason: payload.resultLine ?? '',
    wroteMeta: wrote,
    readbackCents: readback,
    card,
  }
}

async function decline(
  args: Parameters<typeof submitBudgetCard>[0],
  row: HoldRow,
): Promise<BudgetSubmitResult> {
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
  await saveHold(args.kernel.supabase, args.clientId, row, payload, null)
  return { status: 'declined', reason: '没有改日预算。', wroteMeta: false, readbackCents: null, card }
}

async function confirmDecision(
  args: Parameters<typeof submitBudgetCard>[0],
): Promise<{ ok: boolean; card: ConfirmationCardView | null }> {
  try {
    return { ok: true, card: await decideConfirmationCard(args.kernel, decisionArgs(args)) }
  } catch (error) {
    if (!(error instanceof ConfirmationCardError) || error.code !== 'not_waiting') throw error
    const run = await args.kernel.requireRun(args.runId)
    const ok = run.status === 'authorized' || run.status === 'succeeded'
    return { ok, card: null }
  }
}

async function lostRace(args: Parameters<typeof submitBudgetCard>[0]): Promise<BudgetSubmitResult> {
  const again = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  return again ? already(again.payload) : stopped('这张卡已经有人在处理。')
}

function holdFrom(order: BudgetOrder, live: BudgetSnapshot, card: ConfirmationCardView): BudgetHold {
  return {
    kind: 'adset_daily_budget',
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: budgetSubject(order),
    fingerprint: card.fingerprint,
    orderKey: budgetOrderKey(order),
    order,
    beforeCents: live.currentCents as number,
    afterCents: order.newDailyBudgetCents,
    confirmedBy: null,
    readbackCents: null,
    readbackMatched: null,
    writeAttempted: false,
    wroteMeta: false,
  }
}

function already(payload: BudgetHold): BudgetSubmitResult {
  const status = payload.status === 'executed' ? 'executed' : payload.status === 'failed' ? 'failed' : 'done'
  return {
    status,
    reason: payload.resultLine ?? '这张卡已经有结果了，没有再改日预算。',
    wroteMeta: payload.wroteMeta === true,
    readbackCents: payload.readbackCents,
    card: null,
  }
}

function stopped(reason: string): BudgetSubmitResult {
  return { status: 'blocked', reason, wroteMeta: false, readbackCents: null, card: null }
}

function failLine(wrote: boolean, readback: number | null): string {
  if (!wrote) return '日预算没有写成，已标失败，没有再写一次。'
  if (readback == null) return '回读不到日预算，已标失败，没有再写一次。'
  return '回读的日预算和要改的不一样，已标失败，没有再写一次。'
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
