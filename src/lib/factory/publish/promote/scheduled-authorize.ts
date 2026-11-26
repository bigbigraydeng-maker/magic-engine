// Reel scheduled go-public — the approval side. Design: docs/specs/2026-11-04-reel-scheduled-go-public-design-v0.2.md §8.1.
// Called when a global admin confirms the week card: for each reel they previewed, the same one-time token check as a
// person-confirmed promote, then (in the same optimistic write) the token is spent and a grant to publish on the
// reel's own day is armed. Nothing is published here.

import { buildContext } from './context'
import { checkToken } from './action'
import { asRecord, emailSlot } from './guards'
import { mutatePayload } from './payload-lock'
import { grantFingerprint } from './scheduled-action'
import { nzToday, readGrant, withGrant, type ScheduledGrant } from './scheduled-grant'
import { readPublishOn } from '@/lib/social/week-pack/manifest'
import type { PreviewSlot, PromoteDeps } from './types'

export type AuthorizeScheduledResult =
  | { ok: true; publishOn: string }
  | { ok: false; status: number; error: string }

const no = (status: number, error: string): AuthorizeScheduledResult => ({ ok: false, status, error })

/** Arms a grant for one previewed reel. Refuses a reel with no valid day, a past day, or a grant already being executed. */
export async function authorizeScheduledReel(
  deps: PromoteDeps,
  input: { orderId: string; adminEmail: string; previewToken: string; source: string },
): Promise<AuthorizeScheduledResult> {
  const order = await deps.store.loadOrder(input.orderId)
  if (!order) return no(404, '找不到这个工单')
  const ctx = await buildContext(deps, order)
  if ('ok' in ctx) return no(ctx.status, ctx.error)
  const publishOn = readPublishOn(order.brief)
  if (typeof publishOn !== 'string') return no(422, '这条没排日子，不会按日发')
  if (publishOn < nzToday(deps.now())) return no(422, '这条的发布日已经过了，没有授权')
  const target = { orderId: order.id, row: ctx.row, fingerprint: ctx.fingerprint, videoId: ctx.videoId, pageId: ctx.pageId }
  const promoteInput = { orderId: order.id, adminEmail: input.adminEmail, confirm: true, previewToken: input.previewToken }
  const early = checkToken(deps, promoteInput, target, asRecord(ctx.row.payload))
  if (early) return no(early.status, early.error)
  const grant: ScheduledGrant = {
    status: 'armed', work_order_id: order.id, publish_on: publishOn, fingerprint: grantFingerprint(ctx),
    card_run_id: input.source, authorized_by: input.adminEmail, authorized_at: deps.now().toISOString(),
    catalog_version_at_approval: ctx.factCheck.catalog_version,
  }
  const res = await mutatePayload(deps, ctx.row, (cur) => {
    const tokenFail = checkToken(deps, promoteInput, target, cur)
    if (tokenFail) return tokenFail.error
    const prior = readGrant(cur)
    if (prior && (prior.status === 'claimed' || prior.status === 'consumed')) return '这条正在发或已经发过，不能再授权'
    const slots = asRecord(cur['promote_preview']) as Record<string, PreviewSlot>
    // Same slot checkToken just validated: the approver's own, for this order and this content.
    const key = emailSlot(input.adminEmail)
    return withGrant({ ...cur, promote_preview: { ...slots, [key]: { ...slots[key], used: true } } }, grant)
  }, 1)
  return res.ok ? { ok: true, publishOn } : no(409, res.message)
}
