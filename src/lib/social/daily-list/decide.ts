/**
 * Approve / exclude from the daily list (design §9.1–9.4). The list is rebuilt on the server; an item the admin
 * submits must be on it with the same fingerprint and day, or it is refused. Unticked items are left alone
 * (not excluded). One receipt row per decision; nothing is published here.
 */
import { authorizeFromList } from '@/lib/factory/publish/promote/scheduled-authorize-list'
import { buildDailyList, listIdOf, type DailyListItem, type DailyListPorts } from './list'

export const DAILY_LIST_DECISION_ACTION = 'social_daily_list_decision'

export interface ApproveRequest { work_order_id: string; fingerprint: string; publish_on: string }
export interface ExcludeRequest { work_order_id: string; reason: string }

export type ItemOutcome = 'armed' | 'already_armed' | 'excluded' | 'refused' | 'would_arm' | 'would_exclude'

export interface ItemResult {
  work_order_id: string
  action: 'approve' | 'exclude'
  outcome: ItemOutcome
  reason: string | null
  fingerprint: string | null
  publish_on: string | null
}

export interface DecisionReceipt {
  request_id: string
  client_id: string
  list_id: string | null
  actor: string
  items: ItemResult[]
  dry_run: boolean
  no_publish: true
  created_at: string
}

export interface DecidePorts extends DailyListPorts {
  /** Removes publish_on and stamps brief.weekly_pack.excluded_by_card, guarded by the order's updated_at. */
  excludeOrder(clientId: string, orderId: string, mark: { at: string; by: string; reason: string }): Promise<'excluded' | 'conflict' | 'failed'>
  writeReceipt(receipt: DecisionReceipt): Promise<void>
}

const refused = (id: string, action: 'approve' | 'exclude', reason: string): ItemResult =>
  ({ work_order_id: id, action, outcome: 'refused', reason, fingerprint: null, publish_on: null })

async function approveOne(ports: DecidePorts, onList: Map<string, DailyListItem>, req: ApproveRequest, ctx: { adminEmail: string; listId: string; dryRun: boolean }): Promise<ItemResult> {
  const item = onList.get(req.work_order_id)
  if (!item) return refused(req.work_order_id, 'approve', 'not_on_list')
  if (!item.selectable || item.fingerprint === null) return refused(req.work_order_id, 'approve', 'not_selectable')
  if (item.fingerprint !== req.fingerprint || item.publish_on !== req.publish_on) return refused(req.work_order_id, 'approve', 'content_changed')
  const res = await authorizeFromList(ports.promote, {
    orderId: req.work_order_id, adminEmail: ctx.adminEmail, fingerprint: req.fingerprint, publishOn: req.publish_on, listId: ctx.listId, dryRun: ctx.dryRun,
  })
  if (!res.ok) return refused(req.work_order_id, 'approve', res.reason)
  const outcome: ItemOutcome = ctx.dryRun && res.outcome === 'armed' ? 'would_arm' : res.outcome
  return { work_order_id: req.work_order_id, action: 'approve', outcome, reason: null, fingerprint: res.fingerprint, publish_on: res.publishOn }
}

async function excludeOne(ports: DecidePorts, clientId: string, onList: Map<string, DailyListItem>, req: ExcludeRequest, ctx: { adminEmail: string; dryRun: boolean; at: string }): Promise<ItemResult> {
  const item = onList.get(req.work_order_id)
  if (!item) return refused(req.work_order_id, 'exclude', 'not_on_list')
  const reason = req.reason.trim().slice(0, 200)
  if (!reason) return refused(req.work_order_id, 'exclude', 'reason_required')
  const base = { work_order_id: req.work_order_id, action: 'exclude' as const, fingerprint: item.fingerprint, publish_on: item.publish_on }
  if (ctx.dryRun) return { ...base, outcome: 'would_exclude', reason }
  const out = await ports.excludeOrder(clientId, req.work_order_id, { at: ctx.at, by: ctx.adminEmail, reason })
  return out === 'excluded' ? { ...base, outcome: 'excluded', reason } : { ...base, outcome: 'refused', reason: `exclude_${out}` }
}

export async function decideDailyList(
  ports: DecidePorts,
  input: { clientId: string; adminEmail: string; switchOn: boolean; agentOn: boolean; approve: ApproveRequest[]; exclude: ExcludeRequest[]; dryRun: boolean; now: Date; requestId: string },
): Promise<DecisionReceipt & { receipt_saved: boolean }> {
  // A practice run checks every publishing gate even while the switches are off; it still writes nothing.
  const gates = input.dryRun ? { switchOn: true, agentOn: true } : { switchOn: input.switchOn, agentOn: input.agentOn }
  const list = await buildDailyList(ports, { clientId: input.clientId, now: input.now, ...gates })
  const onList = new Map(list.items.map((i) => [i.work_order_id, i]))
  const excludeIds = new Set(input.exclude.map((e) => e.work_order_id))
  // The list id covers only submitted items that match the rebuilt list (same content and day, tickable).
  const approvable = input.approve.filter((a) => {
    const it = onList.get(a.work_order_id)
    return !excludeIds.has(a.work_order_id) && it !== undefined && it.selectable && it.fingerprint === a.fingerprint && it.publish_on === a.publish_on
  })
  const listId = listIdOf(approvable)
  const at = input.now.toISOString()
  const items: ItemResult[] = []
  // Exclusions first: an item both excluded and approved in one request is excluded, never approved.
  for (const req of input.exclude) items.push(await excludeOne(ports, input.clientId, onList, req, { adminEmail: input.adminEmail, dryRun: input.dryRun, at }))
  for (const a of input.approve) {
    if (excludeIds.has(a.work_order_id)) continue
    items.push(await approveOne(ports, onList, a, { adminEmail: input.adminEmail, listId, dryRun: input.dryRun }))
  }
  const receipt: DecisionReceipt = {
    request_id: input.requestId, client_id: input.clientId, list_id: approvable.length > 0 ? listId : null, actor: input.adminEmail,
    items, dry_run: input.dryRun, no_publish: true, created_at: at,
  }
  if (input.dryRun) return { ...receipt, receipt_saved: false }
  try {
    await ports.writeReceipt(receipt)
    return { ...receipt, receipt_saved: true }
  } catch {
    // The grants are already armed; say so instead of failing the whole request.
    return { ...receipt, receipt_saved: false }
  }
}
