/**
 * Issue and click the go-live card.
 * The settle callback runs only after a confirmed click on this draft's card.
 * Chat words never reach this function: the caller only passes confirm or decline.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRun } from '@/lib/kernel/types'
import {
  ConfirmationCardError,
  decideConfirmationCard,
  issueConfirmationCard,
  type CardClicker,
  type CardFacts,
  type CardResolution,
  type ConfirmationCardView,
} from '@/lib/confirmation-card'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { readStoredCard } from '@/lib/confirmation-card/view'
import { cardFingerprint } from './facts'
import { goLiveSubjectKey } from './draft'
import type { SettleResult } from './settle'

export interface GoLiveBody {
  readonly card: ConfirmationCardView
  readonly outcome: 'waiting' | 'declined' | 'live' | 'held'
  readonly resultLine: string
}

export interface ExecutionOutcome {
  readonly settle: SettleResult
  readonly note: string | null
}

function untouchedLine(who: string, status: string): string {
  if (status === 'declined') return `${who}点了不做。系列保持暂停，没有花钱。`
  if (status === 'expired') return '过了 30 分钟没人点，这张卡作废了。没有开投。'
  if (status === 'voided') return '要做的事变了，这张旧卡作废了。没有开投。'
  return '还没有人点。点确认之前不会开投。'
}

function clickerEmail(clicker: CardClicker): string {
  if (clicker.kind === 'opc' || clicker.kind === 'fde') return clicker.email
  return ''
}

export function resultLineFor(who: string, execution: ExecutionOutcome | null, status: string): string {
  if (!execution) return untouchedLine(who, status)
  const note = execution.note ? execution.note : ''
  if (execution.settle.outcome === 'live') {
    const retry = execution.settle.attempts === 2 ? '第一次读回不是在投，重试了一次。' : ''
    return `${who}点了确认。${retry}读回：${execution.settle.readback}。开投观察从现在开始计时。${note}`
  }
  return `${who}点了确认。${execution.settle.reason}读回：${execution.settle.readback}。${note}`
}

function assertThisCard(run: ActionRun, clientId: string, draftId: string): void {
  const subject = goLiveSubjectKey(draftId)
  const stored = readStoredCard(run.input)
  const sameSubject = !!subject && stored?.subjectKey === subject
  const sameCard = run.client_id === clientId && run.action_key === CONFIRMATION_ACTION_KEY && sameSubject
  if (!sameCard) throw new ConfirmationCardError('not_found', '找不到这张开投卡。')
}

async function loadRun(deps: KernelDeps, runId: string): Promise<ActionRun> {
  try {
    return await deps.requireRun(runId)
  } catch (error) {
    if (error instanceof ConfirmationCardError) throw error
    throw new ConfirmationCardError('not_found', '找不到这张开投卡。')
  }
}

export async function issueGoLive(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  facts: CardFacts
  now?: Date
}): Promise<GoLiveBody> {
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: args.facts,
    now: args.now,
  })
  return {
    card,
    outcome: 'waiting',
    resultLine: '还没有人点。点确认之前不会开投。',
  }
}

async function refreshCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  facts: CardFacts
  now?: Date
}): Promise<GoLiveBody> {
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: args.facts,
    now: args.now,
  })
  return { card, outcome: 'waiting', resultLine: '要确认的内容变了，这是新的一张卡。还没有开投。' }
}

export async function decideGoLive(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  draftId: string
  facts: CardFacts
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  runId: string
  now?: Date
  settle: () => Promise<ExecutionOutcome>
}): Promise<GoLiveBody> {
  if (args.fingerprint !== cardFingerprint(args.facts)) return refreshCard(args)
  const run = await loadRun(args.kernel, args.runId)
  assertThisCard(run, args.clientId, args.draftId)
  const card = await decideConfirmationCard(args.kernel, {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
    now: args.now,
  })
  const who = clickerEmail(args.clicker)
  if (args.resolution !== 'confirm' || card.status !== 'confirmed') {
    const outcome = card.status === 'declined' ? 'declined' : 'waiting'
    return { card, outcome, resultLine: resultLineFor(who, null, card.status) }
  }
  const execution = await args.settle()
  const outcome = execution.settle.outcome === 'live' ? 'live' : 'held'
  return { card, outcome, resultLine: resultLineFor(who, execution, card.status) }
}
