/**
 * Confirm pauses once. A ledger row already in `writing` is not submitted again.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { decideConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import type { PauseExecuteArgs, PauseExecuteResult } from '@/lib/action-submission/pause-ad-set'
import { pauseFacts } from './facts'
import { guardPause, type LiveFacts } from './guard'
import { claimWriting, holdForCard, saveHold, type HoldRow, type PauseHold } from './ledger'
import { loadPrescriptionBundle } from './load'
import { orderKey, readPauseOrder } from './order'
import { readApprovalSource, sameApprovalSource } from '@/lib/approval-source/read'

export interface PauseCardReply {
  readonly runId: string
  readonly expectedDecisionId: string
  readonly fingerprint: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly expiresLabel: string
  readonly statusLine: string
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
  readonly blockedReason: string | null
}

export interface PauseSubmitResult {
  readonly status: 'executed' | 'failed' | 'blocked' | 'declined' | 'done'
  readonly reason: string
  readonly wrote: boolean
  readonly readback: string | null
  readonly card: PauseCardReply | null
}

export async function confirmPauseCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  live: (order: PauseHold['order']) => Promise<LiveFacts>
  execute: (args: PauseExecuteArgs) => Promise<PauseExecuteResult>
  now?: Date
}): Promise<PauseSubmitResult> {
  assertMayClick(args.clicker, args.clientId)
  const row = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return stopped('找不到这张暂停卡，没有去暂停。')
  if (row.payload.status === 'writing') return stopped('上次暂停还没记完，不会自动再写一次。')
  if (row.payload.status !== 'holding') return withCard(args, row, already(row.payload))
  if (args.fingerprint !== row.payload.fingerprint) return stopped('你看到的内容已经不是这一张卡了。请刷新后再点。')
  if (args.resolution === 'decline') return decline(args, row)
  return confirmHolding(args, row)
}

async function confirmHolding(args: Parameters<typeof confirmPauseCard>[0], row: HoldRow): Promise<PauseSubmitResult> {
  const block = await recheck(args, row)
  if (block) return stopped(block)
  const decided = await cardConfirmed(args)
  if (!decided) return stopped('这张卡没有确认成功，没有去暂停。')
  if (!await claimWriting(args.kernel.supabase, args.clientId, row)) return stopped('上次暂停还没记完，不会自动再写一次。')
  const result = await args.execute(executeArgs(args, row)).catch(() => refusedExecute())
  return finish(args, row, result, decided)
}

async function recheck(args: Parameters<typeof confirmPauseCard>[0], row: HoldRow): Promise<string | null> {
  const chainReason = await chainBlock(args, row)
  if (chainReason) return chainReason
  const bundle = await loadPrescriptionBundle(args.kernel.supabase, args.clientId, row.payload.order.prescriptionId)
  if (bundle === 'unreadable' || !bundle || bundle.version === null) return '处方读不到，没有去暂停。'
  const parsed = readPauseOrder(bundle.prescriptionId, bundle.version, bundle.content)
  if (!parsed.ok || orderKey(parsed.order) !== row.payload.orderKey) return '处方里的暂停内容变了，没有去暂停。'
  return guardPause(row.payload.order, await args.live(row.payload.order), null).block
}

async function chainBlock(args: Parameters<typeof confirmPauseCard>[0], row: HoldRow): Promise<string | null> {
  if (!row.payload.source) return '这张卡没有记下批准源，没有去暂停。'
  const live = await readApprovalSource(args.kernel.supabase, args.clientId, row.payload.source.prescriptionId)
  if (!live.ok) return live.reason
  if (!sameApprovalSource(row.payload.source, live.source)) return '处方的版本、目标或计划变了，没有去暂停。'
  return null
}

async function cardConfirmed(args: Parameters<typeof confirmPauseCard>[0]): Promise<ConfirmationCardView | 'again' | null> {
  try {
    const view = await decideConfirmationCard(args.kernel, decisionArgs(args))
    return view.status === 'confirmed' ? view : null
  } catch (error) {
    if (!(error instanceof ConfirmationCardError) || error.code !== 'not_waiting') throw error
    const run = await args.kernel.requireRun(args.runId)
    return run.status === 'authorized' || run.status === 'succeeded' ? 'again' : null
  }
}

async function finish(
  args: Parameters<typeof confirmPauseCard>[0],
  row: HoldRow,
  result: PauseExecuteResult,
  decided: ConfirmationCardView | 'again',
): Promise<PauseSubmitResult> {
  const ok = result.kind === 'paused'
  const payload: PauseHold = {
    ...row.payload,
    status: ok ? 'executed' : 'failed',
    before: result.before,
    after: result.after,
    wrote: ok,
    kernelRunId: result.runId,
    resultLine: result.reason,
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload, ok ? row.payload.order.metric : null)
  const base = { status: ok ? 'executed' as const : 'failed' as const, reason: result.reason, wrote: ok, readback: result.after }
  return decided === 'again' ? withCard(args, row, base) : { ...base, card: replyFrom(decided, result.reason) }
}

async function decline(args: Parameters<typeof confirmPauseCard>[0], row: HoldRow): Promise<PauseSubmitResult> {
  const view = await decideConfirmationCard(args.kernel, decisionArgs(args))
  const payload = { ...row.payload, status: 'declined' as const, wrote: false, resultLine: '没有暂停。' }
  await saveHold(args.kernel.supabase, args.clientId, row, payload, null)
  return { status: 'declined', reason: '没有暂停。', wrote: false, readback: null, card: replyFrom(view, '没有暂停。') }
}

function executeArgs(args: Parameters<typeof confirmPauseCard>[0], row: HoldRow): PauseExecuteArgs {
  const now = args.now ?? args.kernel.now()
  return {
    clientId: args.clientId,
    goalId: row.payload.goalId,
    adAccountId: row.payload.order.adAccountId,
    adsetId: row.payload.order.adsetId,
    cycleDate: now.toISOString().slice(0, 10),
    nonce: row.id,
    basis: row.payload.order.basis,
    source: row.payload.source,
  }
}

function decisionArgs(args: Parameters<typeof confirmPauseCard>[0]) {
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

function already(payload: PauseHold): Omit<PauseSubmitResult, 'card'> {
  const status = payload.status === 'executed' ? 'executed' : payload.status === 'declined' ? 'declined' : 'failed'
  return { status, reason: payload.resultLine ?? '这张卡已经有结果了，没有再去暂停。', wrote: payload.wrote, readback: payload.after }
}

function withCard(
  args: Parameters<typeof confirmPauseCard>[0],
  row: HoldRow,
  result: Omit<PauseSubmitResult, 'card'>,
): PauseSubmitResult {
  const facts = pauseFacts(row.payload.order, [{ label: '只暂停', state: 'green', reason: '不会开启，也不会改预算' }])
  return {
    ...result,
    card: {
      runId: args.runId,
      expectedDecisionId: args.expectedDecisionId,
      fingerprint: row.payload.fingerprint,
      what: facts.what,
      account: facts.account,
      amount: facts.amount,
      date: facts.date,
      scope: facts.scope,
      expiresLabel: '已经处理',
      statusLine: result.reason,
      confirmEnabled: false,
      declineEnabled: false,
      blockedReason: null,
    },
  }
}

function replyFrom(view: ConfirmationCardView, reason: string): PauseCardReply {
  return {
    runId: view.runId,
    expectedDecisionId: view.expectedDecisionId,
    fingerprint: view.fingerprint,
    what: view.what,
    account: view.account,
    amount: view.amount,
    date: view.date,
    scope: view.scope,
    expiresLabel: view.expiresLabel,
    statusLine: reason,
    confirmEnabled: false,
    declineEnabled: false,
    blockedReason: null,
  }
}

function stopped(reason: string): PauseSubmitResult {
  return { status: 'blocked', reason, wrote: false, readback: null, card: null }
}

function refusedExecute(): PauseExecuteResult {
  return { kind: 'refused', before: null, after: null, runId: null, reason: '暂停没有做成，没有再写一次。' }
}
