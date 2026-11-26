// Reel scheduled go-public — approval from the daily list (design docs/specs/2026-11-05-daily-list-card-design-v0.1.md §3 / §9).
// The list replaces the one-time preview token: the server rebuilt the list, the admin saw each item's content
// fingerprint on screen, and here the CURRENT fingerprint must equal the one they saw. Nothing is published here.

import { buildContext } from './context'
import { mutatePayload } from './payload-lock'
import { grantFingerprint } from './scheduled-action'
import { nzToday, readGrant, withGrant, type ScheduledGrant } from './scheduled-grant'
import { readPublishOn } from '@/lib/social/week-pack/manifest'
import type { PromoteDeps, PromoteOrder } from './types'

export type ListAuthorizeOutcome = 'armed' | 'already_armed'

export type ListAuthorizeResult =
  | { ok: true; outcome: ListAuthorizeOutcome; publishOn: string; fingerprint: string }
  | { ok: false; status: number; reason: string; error: string }

const no = (status: number, reason: string, error: string): ListAuthorizeResult => ({ ok: false, status, reason, error })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A person took this reel off the list; it must never be approved from the list again. */
export function isExcludedByCard(brief: unknown): boolean {
  const pack = isRecord(brief) ? brief.weekly_pack : null
  return isRecord(pack) && isRecord(pack.excluded_by_card)
}

/** Every check that does not need a write: order state, gates, day and the content the admin saw. */
async function precheck(
  deps: PromoteDeps,
  order: PromoteOrder,
  input: { fingerprint: string; publishOn: string },
) {
  if (isExcludedByCard(order.brief)) return no(409, 'excluded_by_card', '这条已经被剔除，不能再放行')
  const publishOn = readPublishOn(order.brief)
  if (typeof publishOn !== 'string' || publishOn === 'invalid') return no(422, 'not_dated', '这条没排日子')
  if (publishOn !== input.publishOn) return no(409, 'day_changed', '这条的发布日跟你看到的不一样了，请刷新清单')
  if (publishOn < nzToday(deps.now())) return no(422, 'day_passed', '这条的发布日已经过了')
  const ctx = await buildContext(deps, order)
  if ('ok' in ctx) return no(ctx.status, 'gate_failed', ctx.error)
  const fingerprint = grantFingerprint(ctx)
  if (fingerprint !== input.fingerprint) return no(409, 'content_changed', '这条的内容跟你看到的不一样了，请刷新清单')
  return { ctx, publishOn, fingerprint }
}

/** Arms a grant for one reel the admin approved on the daily list. */
export async function authorizeFromList(
  deps: PromoteDeps,
  input: { orderId: string; adminEmail: string; fingerprint: string; publishOn: string; listId: string; dryRun: boolean },
): Promise<ListAuthorizeResult> {
  const order = await deps.store.loadOrder(input.orderId)
  if (!order) return no(404, 'not_found', '找不到这个工单')
  const checked = await precheck(deps, order, input)
  if ('ok' in checked) return checked
  const { ctx, publishOn, fingerprint } = checked
  const prior = readGrant(ctx.row.payload)
  if (prior && (prior.status === 'claimed' || prior.status === 'consumed')) return no(409, 'in_flight', '这条正在发或已经发过')
  if (prior?.status === 'armed' && prior.fingerprint === fingerprint && prior.publish_on === publishOn) {
    return { ok: true, outcome: 'already_armed', publishOn, fingerprint }
  }
  if (input.dryRun) return { ok: true, outcome: 'armed', publishOn, fingerprint }
  const grant: ScheduledGrant = {
    status: 'armed', work_order_id: order.id, publish_on: publishOn, fingerprint,
    card_run_id: `daily-list:${input.listId}`, authorized_by: input.adminEmail, authorized_at: deps.now().toISOString(),
    catalog_version_at_approval: ctx.factCheck.catalog_version,
  }
  const res = await mutatePayload(deps, ctx.row, (cur) => {
    const latest = readGrant(cur)
    if (latest && (latest.status === 'claimed' || latest.status === 'consumed')) return '这条正在发或已经发过'
    return withGrant(cur, grant)
  }, 1)
  return res.ok ? { ok: true, outcome: 'armed', publishOn, fingerprint } : no(409, 'write_conflict', res.message)
}
