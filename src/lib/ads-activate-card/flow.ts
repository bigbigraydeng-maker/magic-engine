/**
 * Request a card, then on confirm re-check and turn one paused ad on.
 * One write, then a read-back. A row left in `writing` is not retried.
 */

import type { LaunchBind } from '@/lib/ads-launch/plan-gate'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { decideConfirmationCard, issueConfirmationCard } from '@/lib/confirmation-card'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import { isExpired } from '@/lib/confirmation-card/view'
import type { KernelDeps } from '@/lib/kernel/deps'
import { activateFacts, activateSubject, plainName } from './facts'
import { liveReason, type ActivateLive } from './guard'
import {
  claimWriting,
  holdForCard,
  insertHold,
  retireStale,
  saveHold,
  type ActivateHold,
  type HoldRow,
} from './ledger'
import type { ActivateOrder } from './order'
import type { AdPicture } from './paused'
import { switchReason } from './switch'

export interface ActivateDeps {
  switchState(): Promise<'on' | 'off' | 'unreadable'>
  describe(adId: string): Promise<AdPicture | null | 'unreadable'>
  plan(): Promise<LaunchBind>
  live(adId: string): Promise<ActivateLive | null>
  activate(adId: string): Promise<boolean>
  readBack(adId: string): Promise<string | null>
}

export interface ActivateIssue {
  readonly status: 'issued' | 'blocked'
  readonly reason: string | null
  readonly card: ConfirmationCardView | null
  readonly previewUrl: string | null
}

export interface ActivateSubmit {
  readonly status: 'executed' | 'failed' | 'blocked' | 'declined'
  readonly reason: string
  readonly wrote: boolean
  readonly card: ConfirmationCardView | null
}

type Check = { ok: true; planId: string } | { ok: false; reason: string }

export async function issueActivateCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  order: ActivateOrder
  deps: ActivateDeps
  now?: Date
}): Promise<ActivateIssue> {
  assertMayClick(args.clicker, args.clientId)
  const switched = await args.deps.switchState()
  if (switched !== 'on') return blocked(switchReason(switched))
  const picture = await args.deps.describe(args.order.adId)
  if (picture === 'unreadable') return blocked('广告快照读不出来，没有出卡。')
  if (picture && picture.adStatus !== 'PAUSED') return blocked('这条广告在最近的快照里已经不是暂停，没有出卡。')
  const now = args.now ?? args.kernel.now()
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: activateFacts(args.order.adId, namesOf(picture)),
    now,
    lifetime: 'urgent_30m',
  })
  await retireStale(args.kernel.supabase, args.clientId, activateSubject(args.order.adId), card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, holdFrom(args.order, picture, card, now))
  return { status: 'issued', reason: null, card, previewUrl: picture?.previewUrl ?? null }
}

export async function confirmActivateCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  deps: ActivateDeps
  now?: Date
}): Promise<ActivateSubmit> {
  assertMayClick(args.clicker, args.clientId)
  const row = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return stopped('找不到这张开卡，没有去改。')
  if (row.payload.status === 'writing') return stopped('上次打开还没记完，不会自动再写一次。')
  if (row.payload.status !== 'holding') return already(row)
  if (args.fingerprint !== row.payload.fingerprint) return stopped('你看到的内容已经不是这一张卡了。请刷新后再点。')
  if (args.resolution === 'decline') return decline(args, row)
  const now = args.now ?? args.kernel.now()
  if (cardExpired(row.payload.issuedAt, now)) return settleExpired(args, row)
  const switched = await args.deps.switchState()
  if (switched !== 'on') return stopped(failLine(switchReason(switched)))
  const checked = await freshBlock(args.deps, row.payload)
  if (!checked.ok) return stopped(failLine(checked.reason))
  return confirmHolding(args, row, checked.planId)
}

async function freshBlock(deps: ActivateDeps, hold: ActivateHold): Promise<Check> {
  const block = liveReason(await deps.live(hold.adId), hold.adAccountId)
  if (block) return { ok: false, reason: block }
  const plan = await deps.plan()
  if (!plan.ok) return { ok: false, reason: plan.reason }
  return { ok: true, planId: plan.planId }
}

async function confirmHolding(
  args: Parameters<typeof confirmActivateCard>[0],
  row: HoldRow,
  planId: string,
): Promise<ActivateSubmit> {
  const view = await decide(args)
  if (!view) return stopped(failLine('这张卡没有确认成功，没有去改。'))
  if (view.status !== 'confirmed') return closeUnconfirmed(args, row, view)
  if (!await claimWriting(args.kernel.supabase, args.clientId, row)) {
    return stopped('上次打开还没记完，不会自动再写一次。')
  }
  const wrote = await runWrite(args.deps, row.payload.adId).catch(() => missed())
  return finish(args, row, wrote, view, planId)
}

async function runWrite(deps: ActivateDeps, adId: string): Promise<WriteOutcome> {
  const sent = await deps.activate(adId)
  if (!sent) return { ok: false, wrote: false, readback: null, line: '没有打开，没有再改一次。' }
  const readback = await deps.readBack(adId)
  if (readback !== 'ACTIVE') return { ok: false, wrote: true, readback, line: '读回来不是在投，没有再改一次。' }
  return { ok: true, wrote: true, readback, line: '这条广告已从暂停改成在投，没有加预算。' }
}

async function finish(
  args: Parameters<typeof confirmActivateCard>[0],
  row: HoldRow,
  wrote: WriteOutcome,
  view: ConfirmationCardView,
  planId: string,
): Promise<ActivateSubmit> {
  const reason = wrote.ok ? doneLine(wrote.line) : failLine(wrote.line)
  const payload: ActivateHold = {
    ...row.payload,
    status: wrote.ok ? 'executed' : 'failed',
    planId,
    wrote: wrote.wrote,
    readback: wrote.readback,
    resultLine: reason,
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload)
  return { status: wrote.ok ? 'executed' : 'failed', reason, wrote: wrote.wrote, card: withLine(view, reason) }
}

async function decline(args: Parameters<typeof confirmActivateCard>[0], row: HoldRow): Promise<ActivateSubmit> {
  const view = await decide(args)
  if (!view || view.status !== 'declined') return closeUnconfirmed(args, row, view)
  const reason = '没有打开这条广告。'
  await saveHold(args.kernel.supabase, args.clientId, row, { ...row.payload, status: 'declined', wrote: false, resultLine: reason })
  return { status: 'declined', reason, wrote: false, card: withLine(view, reason) }
}

async function settleExpired(args: Parameters<typeof confirmActivateCard>[0], row: HoldRow): Promise<ActivateSubmit> {
  const view = await decide(args)
  const reason = failLine(view?.statusLine ?? '过了 30 分钟没人点，这张卡作废了。')
  await saveHold(args.kernel.supabase, args.clientId, row, { ...row.payload, status: 'failed', wrote: false, resultLine: reason })
  return { status: 'blocked', reason, wrote: false, card: view ? withLine(view, reason) : null }
}

async function closeUnconfirmed(
  args: Parameters<typeof confirmActivateCard>[0],
  row: HoldRow,
  view: ConfirmationCardView | null,
): Promise<ActivateSubmit> {
  const reason = failLine(view?.statusLine ?? '这张卡没有确认成功，没有去改。')
  await saveHold(args.kernel.supabase, args.clientId, row, { ...row.payload, status: 'failed', wrote: false, resultLine: reason })
  const status = view?.status === 'confirmed' ? 'failed' : 'blocked'
  return { status, reason, wrote: false, card: view ? withLine(view, reason) : null }
}

async function decide(args: Parameters<typeof confirmActivateCard>[0]): Promise<ConfirmationCardView | null> {
  try {
    return await decideConfirmationCard(args.kernel, {
      clientId: args.clientId,
      runId: args.runId,
      clicker: args.clicker,
      resolution: args.resolution,
      expectedDecisionId: args.expectedDecisionId,
      fingerprint: args.fingerprint,
      now: args.now ?? args.kernel.now(),
    })
  } catch (error) {
    if (error instanceof ConfirmationCardError) return null
    throw error
  }
}

function holdFrom(order: ActivateOrder, picture: AdPicture | null, card: ConfirmationCardView, now: Date): ActivateHold {
  const names = namesOf(picture)
  return {
    kind: 'activate_ad',
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: activateSubject(order.adId),
    fingerprint: card.fingerprint,
    adId: order.adId,
    adName: names.adName,
    adsetName: names.adsetName,
    adsetId: picture?.adsetId ?? null,
    campaignId: picture?.campaignId ?? null,
    adAccountId: picture?.adAccountId ?? null,
    previewUrl: picture?.previewUrl ?? null,
    planId: null,
    wrote: false,
    issuedAt: now.toISOString(),
  }
}

function namesOf(picture: AdPicture | null): { adName: string; adsetName: string } {
  return {
    adName: plainName(picture?.adName, '这条广告'),
    adsetName: plainName(picture?.adsetName, '它所在的广告组'),
  }
}

function cardExpired(issuedAt: string, now: Date): boolean {
  if (!Number.isFinite(Date.parse(issuedAt))) return true
  return isExpired(issuedAt, now, 'urgent_30m')
}

interface WriteOutcome {
  ok: boolean
  wrote: boolean
  readback: string | null
  line: string
}

function missed(): WriteOutcome {
  return { ok: false, wrote: false, readback: null, line: '没有打开，没有再改一次。' }
}

function doneLine(line: string): string {
  return `已做完。${line}`
}

function failLine(line: string): string {
  return line.startsWith('没做成') ? line : `没做成。${line}`
}

function blocked(reason: string): ActivateIssue {
  return { status: 'blocked', reason, card: null, previewUrl: null }
}

function stopped(reason: string): ActivateSubmit {
  return { status: 'blocked', reason, wrote: false, card: null }
}

function already(row: HoldRow): ActivateSubmit {
  const status = row.payload.status === 'executed' ? 'executed' : row.payload.status === 'declined' ? 'declined' : 'failed'
  return { status, reason: row.payload.resultLine ?? '这张卡已经有结果了，没有再去改。', wrote: row.payload.wrote, card: null }
}

function withLine(view: ConfirmationCardView, reason: string): ConfirmationCardView {
  return { ...view, statusLine: reason, confirmEnabled: false, declineEnabled: false }
}
