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

/** Grant states that mean a person already decided (or it may be public): not on the list, not counted as waiting. */
export const HANDLED_GRANT = new Set(['armed', 'claimed', 'consumed', 'consumed_manual', 'unknown'])

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
  /** Suggest leaving it unticked (fact check raised a question, or a person revoked this reel before). */
  default_checked: boolean
  /** Shown next to a tickable item that needs a second look (e.g. revoked before). */
  note: string | null
  /** Storage path of the finished video (the page turns it into a playable link). */
  video_path: string | null
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

/** Whether the order belongs on the list, and the fingerprint of a version a person revoked (that exact content stays blocked). */
interface Revoked { fingerprint: string; at: string | null }

async function approvalState(ports: DailyListPorts, order: PromoteOrder): Promise<{ show: boolean; revoked: Revoked | null }> {
  if (isExcludedByCard(order.brief)) return { show: false, revoked: null }
  const rows = await ports.promote.store.loadTrafficRows(order.id, order.client_id)
  if (rows.length !== 1) return { show: true, revoked: null } // buildContext will say why it cannot be ticked
  const grant = readGrant(rows[0].payload)
  if (grant && HANDLED_GRANT.has(grant.status)) return { show: false, revoked: null }
  // The grant keeps the fingerprint it was approved with, not what the person saw when revoking: never pre-tick.
  return { show: true, revoked: grant?.status === 'revoked' ? { fingerprint: grant.fingerprint, at: grant.updated_at ?? null } : null }
}

/** Why nothing on the list can be ticked right now; null = it can. */
export function listBlock(input: { switchOn: boolean; agentOn: boolean }): string | null {
  if (!input.agentOn) return '这位客户没开社媒 Agent：Reel 走周卡批'
  if (!input.switchOn) return '按日公开没打开，现在批了到日也不会发'
  return null
}

async function toItem(ports: DailyListPorts, order: PromoteOrder, angle: unknown, block: string | null, revoked: Revoked | null): Promise<DailyListItem> {
  const publishOn = String(readPublishOn(order.brief))
  const videoPath = typeof order.output.video_path === 'string' ? order.output.video_path : null
  const base = { work_order_id: order.id, title: reelTitle(angle), publish_on: publishOn, video_path: videoPath }
  const ctx = await buildContext(ports.promote, order)
  if ('ok' in ctx) {
    return { ...base, caption: '', first_comment: '', fact_summary: null, fingerprint: null, selectable: false, blocked_reason: ctx.error, default_checked: false, note: null }
  }
  const fc = ctx.factCheck
  const summary = fc.verdict === 'pass' || fc.verdict === 'not_applicable' ? null : fc.problems.join('；') || '事实要人核对'
  const fingerprint = grantFingerprint(ctx)
  const reason = block ?? (revoked?.fingerprint === fingerprint ? '你撤回过这一版，改片后才能再放行' : null)
  const note = revoked && reason === null ? `你${revoked.at ? `在 ${revoked.at.slice(0, 10)} ` : ''}撤回过这条，确认改好了再勾` : null
  return {
    ...base,
    caption: ctx.view.description,
    first_comment: ctx.firstComment,
    fact_summary: summary,
    fingerprint,
    selectable: reason === null,
    blocked_reason: reason,
    default_checked: reason === null && summary === null && revoked === null,
    note,
  }
}

/** Builds the list. Items whose gates fail are shown, never ticked, never auto-excluded. */
export async function buildDailyList(
  ports: DailyListPorts,
  input: { clientId: string; now: Date; switchOn: boolean; agentOn: boolean; window?: { from: string; to: string } },
): Promise<{ from: string; to: string; items: DailyListItem[] }> {
  // Default: today..day after tomorrow (daily list). The week card passes its own week.
  const { from, to } = input.window ?? listWindow(input.now)
  const orders = await ports.listDatedOrders(input.clientId, from, to)
  const items: DailyListItem[] = []
  for (const { order, angle } of orders) {
    if (order.client_id !== input.clientId) continue
    const state = await approvalState(ports, order)
    if (!state.show) continue
    items.push(await toItem(ports, order, angle, listBlock(input), state.revoked))
  }
  items.sort((a, b) => (a.publish_on + a.work_order_id).localeCompare(b.publish_on + b.work_order_id))
  return { from, to, items }
}
