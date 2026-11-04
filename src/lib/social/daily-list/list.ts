/**
 * Daily list (social agent knife 2): reels dated today..day after tomorrow that still need a person's approval.
 * Design: docs/specs/2026-11-05-daily-list-card-design-v0.1.md §9. The server builds it for GET and rebuilds it on
 * every approve, so only items that were really on the list can be approved. Reads only.
 */
import { createHash } from 'node:crypto'
import { buildContext } from '@/lib/factory/publish/promote/context'
import { grantFingerprint } from '@/lib/factory/publish/promote/scheduled-action'
import { isExcludedByCard } from '@/lib/factory/publish/promote/scheduled-authorize-list'
import { nzToday, readGrant } from '@/lib/factory/publish/promote/scheduled-grant'
import type { PromoteDeps, PromoteOrder } from '@/lib/factory/publish/promote/types'
import { readPublishOn, reelTitle } from '@/lib/social/week-pack/manifest'

export const DAILY_LIST_DAYS = 3 // today, tomorrow, the day after

export interface DailyListItem {
  work_order_id: string
  title: string
  publish_on: string
  /** Facebook draft text: what the fingerprint hashes. */
  caption: string
  first_comment: string
  fact_summary: string | null
  fingerprint: string | null
  selectable: boolean
  /** Why it cannot be ticked (gate failed, switch off). */
  blocked_reason: string | null
  /** Suggest leaving it unticked (fact check raised a question). */
  default_checked: boolean
}

export interface DailyListPorts {
  promote: PromoteDeps
  /** Work orders of this client whose brief.weekly_pack.publish_on is in [from, to], with their angle (for the title). */
  listDatedOrders(clientId: string, from: string, to: string): Promise<Array<{ order: PromoteOrder; angle: unknown }>>
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10)
}

export function listWindow(now: Date): { from: string; to: string } {
  const from = nzToday(now)
  return { from, to: addDays(from, DAILY_LIST_DAYS - 1) }
}

/** Server-side id of a set of approved items: sha256 over [id, fingerprint, day] sorted by day then id. */
export function listIdOf(items: ReadonlyArray<{ work_order_id: string; fingerprint: string; publish_on: string }>): string {
  const rows = [...items]
    .sort((a, b) => (a.publish_on + a.work_order_id).localeCompare(b.publish_on + b.work_order_id))
    .map((i) => [i.work_order_id, i.fingerprint, i.publish_on])
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
}

async function needsApproval(ports: DailyListPorts, order: PromoteOrder): Promise<boolean> {
  if (isExcludedByCard(order.brief)) return false
  const rows = await ports.promote.store.loadTrafficRows(order.id, order.client_id)
  if (rows.length !== 1) return true // shown, and buildContext will say why it cannot be ticked
  const grant = readGrant(rows[0].payload)
  return !(grant && (grant.status === 'armed' || grant.status === 'claimed' || grant.status === 'consumed'))
}

async function toItem(ports: DailyListPorts, order: PromoteOrder, angle: unknown, switchOn: boolean): Promise<DailyListItem> {
  const publishOn = String(readPublishOn(order.brief))
  const base = { work_order_id: order.id, title: reelTitle(angle), publish_on: publishOn }
  const ctx = await buildContext(ports.promote, order)
  if ('ok' in ctx) {
    return { ...base, caption: '', first_comment: '', fact_summary: null, fingerprint: null, selectable: false, blocked_reason: ctx.error, default_checked: false }
  }
  const fc = ctx.factCheck
  const summary = fc.verdict === 'pass' || fc.verdict === 'not_applicable' ? null : fc.problems.join('；') || '事实要人核对'
  return {
    ...base,
    caption: ctx.view.description,
    first_comment: ctx.firstComment,
    fact_summary: summary,
    fingerprint: grantFingerprint(ctx),
    selectable: switchOn,
    blocked_reason: switchOn ? null : '按日公开没打开，现在批了到日也不会发',
    default_checked: switchOn && summary === null,
  }
}

/** Builds the list. Items whose gates fail are shown, never ticked, never auto-excluded. */
export async function buildDailyList(
  ports: DailyListPorts,
  input: { clientId: string; now: Date; switchOn: boolean },
): Promise<{ from: string; to: string; items: DailyListItem[] }> {
  const { from, to } = listWindow(input.now)
  const orders = await ports.listDatedOrders(input.clientId, from, to)
  const items: DailyListItem[] = []
  for (const { order, angle } of orders) {
    if (order.client_id !== input.clientId) continue
    if (!(await needsApproval(ports, order))) continue
    items.push(await toItem(ports, order, angle, input.switchOn))
  }
  items.sort((a, b) => (a.publish_on + a.work_order_id).localeCompare(b.publish_on + b.work_order_id))
  return { from, to, items }
}
