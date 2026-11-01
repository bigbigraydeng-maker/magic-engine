/**
 * Walk approved plans and prescriptions. Only explicit pause orders become cards.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { extractPauseOrders, type PauseBlock } from './order'
import { issuePauseOrder, pauseSources, type PauseIssueResult, type PauseRuntime } from './flow'

export interface AssembledPause extends PauseIssueResult {
  readonly sourceId: string
  readonly stepId: string
}

export async function assemblePauseCards(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  runtime: PauseRuntime
  now?: Date
}): Promise<{ ok: true; items: AssembledPause[] } | { ok: false; reason: string }> {
  const loaded = await pauseSources(args.kernel.supabase, args.clientId)
  if (!loaded.ok) return { ok: false, reason: '已批准的计划或处方读不到，没有出卡。' }
  const items: AssembledPause[] = []
  for (const plan of loaded.plans) {
    items.push(...await issueExtracted(args, 'plan_step', plan.id, plan.status, plan.plan_data))
  }
  for (const prescription of loaded.prescriptions) {
    items.push(...await issueExtracted(args, 'prescription', prescription.id, prescription.status, prescription.content))
  }
  return { ok: true, items }
}

async function issueExtracted(
  args: Parameters<typeof assemblePauseCards>[0],
  sourceKind: 'plan_step' | 'prescription',
  sourceId: string,
  status: unknown,
  body: unknown,
): Promise<AssembledPause[]> {
  const extracted = extractPauseOrders(sourceKind, sourceId, status, body)
  const blocked = extracted.blocked.map((item) => blockedItem(sourceId, item))
  const issued: AssembledPause[] = []
  for (const order of extracted.orders) {
    const result = await issuePauseOrder({ ...args, order })
    issued.push({ ...result, sourceId, stepId: order.stepId })
  }
  return [...blocked, ...issued]
}

function blockedItem(sourceId: string, item: PauseBlock): AssembledPause {
  return { status: 'blocked', reason: item.reason, sourceId, stepId: item.stepId }
}
