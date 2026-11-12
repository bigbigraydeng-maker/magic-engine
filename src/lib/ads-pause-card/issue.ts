/**
 * Issue one card per approved prescription that names a single ad set to pause.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import type { CardLifetime } from '@/lib/confirmation-card/view'
import { guardPause, type LiveFacts } from './guard'
import { insertHold, retireStale, type PauseHold } from './ledger'
import { loadPrescriptionBundle, listApprovedIds } from './load'
import { orderKey, readPauseOrder, type PauseAdSetOrder } from './order'
import { pauseFacts } from './facts'
import { readApprovalSource } from '@/lib/approval-source/read'
import { readPauseCardSwitch } from './switch'
import { markOrHold } from '@/lib/ads-strategy/independent-review-gate'

export interface PauseIssueItem {
  readonly prescriptionId: string
  readonly status: 'issued' | 'blocked' | 'off'
  readonly reason?: string
  readonly runId?: string
  readonly fingerprint?: string
  readonly expectedDecisionId?: string
  readonly confirmEnabled?: boolean
}

export interface PauseIssueArgs {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  live: (order: PauseAdSetOrder) => Promise<LiveFacts>
  now?: Date
  /** Omitted cards stay on the 30-minute clock. Daily auto cards pass nz_day. */
  lifetime?: CardLifetime
}

export async function issuePauseCards(args: PauseIssueArgs): Promise<{ ok: true; items: PauseIssueItem[] } | { ok: false; reason: string }> {
  assertMayClick(args.clicker, args.clientId)
  const switched = await readPauseCardSwitch(args.kernel.supabase, args.clientId)
  if (switched !== 'on') return { ok: true, items: [switchOff('', switched)] }
  const ids = await listApprovedIds(args.kernel.supabase, args.clientId)
  if (ids === 'unreadable') return { ok: false, reason: '已批准的处方读不到，没有出卡。' }
  const items: PauseIssueItem[] = []
  for (const id of ids) items.push(...await issueOne(args, id))
  return { ok: true, items }
}

/** One order from an approved prescription. Same switch, guards, and ledger as the batch issuer. */
export async function issueOnePauseCard(args: PauseIssueArgs & { order: PauseAdSetOrder }): Promise<PauseIssueItem> {
  assertMayClick(args.clicker, args.clientId)
  const switched = await readPauseCardSwitch(args.kernel.supabase, args.clientId)
  if (switched !== 'on') return switchOff(args.order.prescriptionId, switched)
  const bundle = await loadPrescriptionBundle(args.kernel.supabase, args.clientId, args.order.prescriptionId)
  if (bundle === 'unreadable' || !bundle) {
    return { prescriptionId: args.order.prescriptionId, status: 'blocked', reason: '这份处方读不到，没有出卡。' }
  }
  if (bundle.version === null) {
    return { prescriptionId: args.order.prescriptionId, status: 'blocked', reason: '处方版本不对，没有出卡。' }
  }
  return issueOrder(args, args.order, bundle)
}

function switchOff(prescriptionId: string, switched: 'off' | 'unreadable'): PauseIssueItem {
  const reason = switched === 'off' ? '这个客户没开暂停广告组的确认卡。' : '暂停卡的开关读不到，没有出卡。'
  return { prescriptionId, status: 'off', reason }
}

async function issueOne(args: PauseIssueArgs, prescriptionId: string): Promise<PauseIssueItem[]> {
  const bundle = await loadPrescriptionBundle(args.kernel.supabase, args.clientId, prescriptionId)
  if (bundle === 'unreadable' || !bundle) return [{ prescriptionId, status: 'blocked', reason: '这份处方读不到，没有出卡。' }]
  if (bundle.version === null) return [{ prescriptionId, status: 'blocked', reason: '处方版本不对，没有出卡。' }]
  const parsed = readPauseOrder(prescriptionId, bundle.version, bundle.content)
  if (!parsed.ok) return parsed.reason ? [{ prescriptionId, status: 'blocked', reason: parsed.reason }] : []
  return [await issueOrder(args, parsed.order, bundle)]
}

async function issueOrder(
  args: PauseIssueArgs,
  order: PauseAdSetOrder,
  bundle: Exclude<Awaited<ReturnType<typeof loadPrescriptionBundle>>, 'unreadable' | null>,
): Promise<PauseIssueItem> {
  const chain = await readApprovalSource(args.kernel.supabase, args.clientId, order.prescriptionId)
  const planId = chain.ok ? chain.source.planId : (bundle.planId ?? '')
  const goalId = chain.ok ? chain.source.goalId : (bundle.goalId ?? '')
  const sourceReason = chain.ok ? null : chain.reason
  const guard = guardPause(order, await args.live(order), sourceReason)
  const marked = await markOrHold(args.kernel.supabase, args.clientId, guard.checks, guard.block !== null, order.basis)
  if (marked.kind === 'return') {
    return { prescriptionId: order.prescriptionId, status: 'blocked', reason: `独立复核退回：${marked.reason}`, confirmEnabled: false }
  }
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: pauseFacts(order, marked.checks),
    now: args.now,
    lifetime: args.lifetime,
  })
  const key = orderKey(order)
  await retireStale(args.kernel.supabase, args.clientId, key, card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, holdOf(
    order, key, card.runId, card.fingerprint, goalId, planId, chain.ok ? chain.source : null,
  ))
  return {
    prescriptionId: order.prescriptionId,
    status: guard.block ? 'blocked' : 'issued',
    ...(guard.block ? { reason: guard.block } : {}),
    runId: card.runId,
    fingerprint: card.fingerprint,
    expectedDecisionId: card.expectedDecisionId,
    confirmEnabled: !guard.block,
  }
}

function holdOf(
  order: PauseAdSetOrder,
  key: string,
  cardRunId: string,
  fingerprint: string,
  goalId: string,
  planId: string,
  source: PauseHold['source'],
): PauseHold {
  return {
    status: 'holding', cardRunId, fingerprint, orderKey: key, order, goalId, planId, source,
    before: null, after: null, wrote: false,
  }
}
