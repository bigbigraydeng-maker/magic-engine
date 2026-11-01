/**
 * Issue a pause card, then pause only after a person confirms.
 * Readback mismatch is a failure. The Meta write is not repeated.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { decideConfirmationCard, issueConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { emptyAckFacts, emptyAckSubject, pauseFacts, pauseSubject } from './facts'
import { guardPause, type LiveFacts } from './guard'
import { orderKey, type PauseOrder } from './order'
import { readPauseCardSwitch } from './switch'
import {
  ackIsConfirmed, claimPause, EMPTY_ACK_ACTION, holdForCard, insertHold, pauseActionType, retireStalePause, saveHold,
  type HoldRow, type HoldStep, type PauseHoldPayload,
} from './store'

export interface PauseRuntime {
  live(order: PauseOrder): Promise<LiveFacts>
  pause(order: PauseOrder): Promise<boolean>
  readback(order: PauseOrder): Promise<string | null>
}

export interface PauseIssueResult {
  readonly status: 'issued' | 'blocked' | 'off'
  readonly reason?: string
  readonly runId?: string
  readonly emptyAckRunId?: string
  readonly confirmEnabled?: boolean
  readonly fingerprint?: string
  readonly expectedDecisionId?: string
  readonly emptyAckFingerprint?: string
  readonly emptyAckDecisionId?: string
}

export interface PauseSubmitResult {
  readonly status: 'executed' | 'failed' | 'blocked' | 'declined' | 'done'
  readonly reason: string
  readonly wroteMeta: boolean
  readonly readback: string | null
}

export async function issuePauseOrder(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  order: PauseOrder
  runtime: PauseRuntime
  now?: Date
}): Promise<PauseIssueResult> {
  assertMayClick(args.clicker, args.clientId)
  const now = args.now ?? args.kernel.now()
  const switched = await readPauseCardSwitch(args.kernel.supabase, args.clientId, now)
  if (switched === 'unreadable') return { status: 'off', reason: '暂停卡的开关读不到，没有出卡。' }
  if (switched === 'off') return { status: 'off', reason: '这个客户没开暂停广告的确认卡。' }
  const live = await args.runtime.live(args.order)
  const key = orderKey(args.order)
  const acked = await ackIsConfirmed(args.kernel.supabase, args.clientId, key)
  const guard = guardPause(args.order, live, acked)
  const ack = guard.needsEmptyAck ? await issueAck(args, key, now) : null
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: pauseFacts(args.order, guard.checks),
    now,
  })
  const payload = pausePayload(args.order, key, card, guard.checks)
  await retireStalePause(args.kernel.supabase, args.clientId, key, card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, pauseActionType(args.order), payload)
  return {
    status: guard.block ? 'blocked' : 'issued',
    ...(guard.block ? { reason: guard.block } : {}),
    runId: card.runId,
    ...(ack ? { emptyAckRunId: ack.runId, emptyAckFingerprint: ack.fingerprint, emptyAckDecisionId: ack.expectedDecisionId } : {}),
    confirmEnabled: !guard.block,
    fingerprint: card.fingerprint,
    expectedDecisionId: card.expectedDecisionId,
  }
}

export async function submitPauseCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  runtime: PauseRuntime
  now?: Date
}): Promise<PauseSubmitResult> {
  assertMayClick(args.clicker, args.clientId)
  const row = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return { status: 'blocked', reason: '找不到这张暂停卡，没有去暂停。', wroteMeta: false, readback: null }
  if (row.payload.role === 'empty_ack') return submitAck(args, row)
  if (row.payload.status !== 'holding') return already(row.payload)
  if (args.resolution === 'decline') return decline(args, row)
  return confirmPause(args, row)
}

async function issueAck(
  args: Parameters<typeof issuePauseOrder>[0],
  key: string,
  now: Date,
): Promise<ConfirmationCardView> {
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: emptyAckFacts(args.order),
    now,
  })
  await insertHold(args.kernel.supabase, args.clientId, EMPTY_ACK_ACTION, {
    role: 'empty_ack',
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: emptyAckSubject(args.order),
    fingerprint: card.fingerprint,
    orderKey: key,
    order: args.order,
    steps: [{ key: 'ack', status: 'holding' }],
    pauseAttempted: false,
  })
  return card
}

async function confirmPause(args: Parameters<typeof submitPauseCard>[0], row: HoldRow): Promise<PauseSubmitResult> {
  const live = await args.runtime.live(row.payload.order)
  const acked = await ackIsConfirmed(args.kernel.supabase, args.clientId, row.payload.orderKey)
  const guard = guardPause(row.payload.order, live, acked)
  if (guard.block) return { status: 'blocked', reason: guard.block, wroteMeta: false, readback: null }
  const decided = await confirmDecision(args)
  if (!decided) return { status: 'done', reason: '这张卡没有确认成功，没有去暂停。', wroteMeta: false, readback: null }
  const claimed = await claimPause(args.kernel.supabase, args.clientId, row)
  if (!claimed) {
    const again = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
    return again ? already(again.payload) : { status: 'done', reason: '这张卡已经有人在处理。', wroteMeta: false, readback: null }
  }
  return writeOnce(args, row)
}

async function confirmDecision(args: Parameters<typeof submitPauseCard>[0]): Promise<boolean> {
  try {
    await decideConfirmationCard(args.kernel, decisionArgs(args))
    return true
  } catch (error) {
    if (!(error instanceof ConfirmationCardError) || error.code !== 'not_waiting') throw error
    const run = await args.kernel.requireRun(args.runId)
    return run.status === 'authorized' || run.status === 'succeeded'
  }
}

async function writeOnce(
  args: Parameters<typeof submitPauseCard>[0],
  row: NonNullable<Awaited<ReturnType<typeof holdForCard>>>,
): Promise<PauseSubmitResult> {
  const paused = await args.runtime.pause(row.payload.order).catch(() => false)
  const readback = paused ? await args.runtime.readback(row.payload.order).catch(() => null) : null
  const ok = paused && readback === 'PAUSED'
  const payload: PauseHoldPayload = {
    ...row.payload,
    status: ok ? 'executed' : 'failed',
    pauseAttempted: true,
    wroteMeta: paused,
    readback,
    steps: doneSteps(row.payload.order, ok),
    resultLine: ok ? '已暂停，回读是暂停。' : failLine(paused),
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload, ok ? row.payload.order.expectedMetric : null)
  return { status: ok ? 'executed' : 'failed', reason: payload.resultLine ?? '', wroteMeta: paused, readback }
}

async function submitAck(
  args: Parameters<typeof submitPauseCard>[0],
  row: NonNullable<Awaited<ReturnType<typeof holdForCard>>>,
): Promise<PauseSubmitResult> {
  if (row.payload.status !== 'holding') return already(row.payload)
  if (args.resolution === 'decline') return decline(args, row)
  await decideConfirmationCard(args.kernel, decisionArgs(args))
  const payload: PauseHoldPayload = {
    ...row.payload,
    status: 'confirmed',
    resultLine: '已单独确认系列会没有在投广告。没有改广告。',
    wroteMeta: false,
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload, null)
  return { status: 'done', reason: payload.resultLine ?? '', wroteMeta: false, readback: null }
}

async function decline(
  args: Parameters<typeof submitPauseCard>[0],
  row: NonNullable<Awaited<ReturnType<typeof holdForCard>>>,
): Promise<PauseSubmitResult> {
  await decideConfirmationCard(args.kernel, decisionArgs(args))
  const payload = { ...row.payload, status: 'declined' as const, wroteMeta: false, resultLine: '没有暂停。' }
  await saveHold(args.kernel.supabase, args.clientId, row, payload, null)
  return { status: 'declined', reason: '没有暂停。', wroteMeta: false, readback: null }
}

function already(payload: PauseHoldPayload): PauseSubmitResult {
  return {
    status: payload.status === 'executed' ? 'executed' : payload.status === 'failed' ? 'failed' : 'done',
    reason: payload.resultLine ?? '这张卡已经有结果了，没有再去暂停。',
    wroteMeta: payload.wroteMeta === true,
    readback: payload.readback ?? null,
  }
}

function pausePayload(order: PauseOrder, key: string, card: ConfirmationCardView, checks: readonly { label: string; state: string }[]): PauseHoldPayload {
  const successor = checks.find((check) => check.label === '新广告在投')
  const steps: HoldStep[] = [
    { key: 'successor_active', status: !order.successorAdId ? 'not_needed' : successor?.state === 'green' ? 'passed' : 'waiting' },
    { key: 'pause', status: 'holding' },
  ]
  return {
    role: 'pause', status: 'holding', cardRunId: card.runId, subjectKey: pauseSubject(order),
    fingerprint: card.fingerprint, orderKey: key, order, steps, pauseAttempted: false,
  }
}

function failLine(paused: boolean): string {
  return paused
    ? '回读和暂停不一致，已标失败，没有再写一次。'
    : '暂停没有写成，已标失败，没有再写一次。'
}

function doneSteps(order: PauseOrder, ok: boolean): HoldStep[] {
  return [
    { key: 'successor_active', status: order.successorAdId ? 'passed' : 'not_needed' },
    { key: 'pause', status: ok ? 'executed' : 'failed' },
  ]
}

function decisionArgs(args: Parameters<typeof submitPauseCard>[0]) {
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

export async function pauseSources(sb: SupabaseClient, clientId: string): Promise<
  { ok: true; plans: Array<{ id: string; status: unknown; plan_data: unknown }>; prescriptions: Array<{ id: string; status: unknown; content: unknown }> }
  | { ok: false }
> {
  const plans = await sb.from('marketing_plans').select('id, status, plan_data').eq('client_id', clientId).eq('status', 'approved')
  const prescriptions = await sb.from('prescriptions').select('id, status, content').eq('client_id', clientId).eq('status', 'approved')
  if (plans.error || prescriptions.error) return { ok: false }
  return {
    ok: true,
    plans: (plans.data ?? []) as Array<{ id: string; status: unknown; plan_data: unknown }>,
    prescriptions: (prescriptions.data ?? []) as Array<{ id: string; status: unknown; content: unknown }>,
  }
}
