/**
 * Issue one card per approved prescription that names a single ad set to pause.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import { guardPause, type LiveFacts } from './guard'
import { insertHold, retireStale, type PauseHold } from './ledger'
import { loadPrescriptionBundle, listApprovedIds } from './load'
import { orderKey, readPauseOrder, type PauseAdSetOrder } from './order'
import { pauseFacts } from './facts'
import { sourceBlock } from './source'
import { readPauseCardSwitch } from './switch'

export interface PauseIssueItem {
  readonly prescriptionId: string
  readonly status: 'issued' | 'blocked' | 'off'
  readonly reason?: string
  readonly runId?: string
  readonly fingerprint?: string
  readonly expectedDecisionId?: string
  readonly confirmEnabled?: boolean
}

export async function issuePauseCards(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  live: (order: PauseAdSetOrder) => Promise<LiveFacts>
  now?: Date
}): Promise<{ ok: true; items: PauseIssueItem[] } | { ok: false; reason: string }> {
  assertMayClick(args.clicker, args.clientId)
  const switched = await readPauseCardSwitch(args.kernel.supabase, args.clientId)
  if (switched !== 'on') {
    const reason = switched === 'off' ? '这个客户没开暂停广告组的确认卡。' : '暂停卡的开关读不到，没有出卡。'
    return { ok: true, items: [{ prescriptionId: '', status: 'off', reason }] }
  }
  const ids = await listApprovedIds(args.kernel.supabase, args.clientId)
  if (ids === 'unreadable') return { ok: false, reason: '已批准的处方读不到，没有出卡。' }
  const items: PauseIssueItem[] = []
  for (const id of ids) items.push(...await issueOne(args, id))
  return { ok: true, items }
}

async function issueOne(args: Parameters<typeof issuePauseCards>[0], prescriptionId: string): Promise<PauseIssueItem[]> {
  const bundle = await loadPrescriptionBundle(args.kernel.supabase, args.clientId, prescriptionId)
  if (bundle === 'unreadable' || !bundle) return [{ prescriptionId, status: 'blocked', reason: '这份处方读不到，没有出卡。' }]
  if (bundle.version === null) return [{ prescriptionId, status: 'blocked', reason: '处方版本不对，没有出卡。' }]
  const parsed = readPauseOrder(prescriptionId, bundle.version, bundle.content)
  if (!parsed.ok) return parsed.reason ? [{ prescriptionId, status: 'blocked', reason: parsed.reason }] : []
  return [await issueOrder(args, parsed.order, bundle)]
}

async function issueOrder(
  args: Parameters<typeof issuePauseCards>[0],
  order: PauseAdSetOrder,
  bundle: Exclude<Awaited<ReturnType<typeof loadPrescriptionBundle>>, 'unreadable' | null>,
): Promise<PauseIssueItem> {
  const sourceReason = sourceBlock(bundle, { prescriptionId: order.prescriptionId, version: order.version, goalId: bundle.goalId ?? '', planId: bundle.planId ?? '' })
  const guard = guardPause(order, await args.live(order), sourceReason)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: pauseFacts(order, guard.checks),
    now: args.now,
  })
  const key = orderKey(order)
  await retireStale(args.kernel.supabase, args.clientId, key, card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, holdOf(order, key, card.runId, card.fingerprint, bundle.goalId ?? '', bundle.planId ?? ''))
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

function holdOf(order: PauseAdSetOrder, key: string, cardRunId: string, fingerprint: string, goalId: string, planId: string): PauseHold {
  return {
    status: 'holding', cardRunId, fingerprint, orderKey: key, order, goalId, planId,
    before: null, after: null, wrote: false,
  }
}
