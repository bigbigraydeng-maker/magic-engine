/**
 * Request a card, then on confirm re-check and create one image ad.
 * Upload, creative, and ad run in that order. A partial write is not retried.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { decideConfirmationCard, issueConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import { creativeFacts, creativeSubject } from './facts'
import { guardCreative, type Inspect } from './guard'
import { claimWriting, holdForCard, insertHold, retireStale, saveHold, type CreativeHold, type HoldRow } from './ledger'
import { imageFilename, orderKey, sameStory, storyFor, type CopiedStory, type CreativeOrder } from './order'
import { switchReason } from './switch'

export type StepResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: string }

export interface CreativeMeta {
  uploadImage(input: { accountId: string; storageUrl: string; filename: string }): Promise<StepResult>
  createCreative(input: { accountId: string; name: string; story: Record<string, unknown> }): Promise<StepResult>
  createAd(input: {
    accountId: string
    adSetId: string
    name: string
    creativeId: string
    status: CreativeOrder['status']
  }): Promise<StepResult>
}

export interface CreativeDeps {
  switchState(): Promise<'on' | 'off' | 'unreadable'>
  inspect(order: CreativeOrder): Promise<Inspect>
  meta(): Promise<CreativeMeta | null>
}

export interface CreativeIssue {
  readonly status: 'issued' | 'blocked'
  readonly reason: string | null
  readonly card: ConfirmationCardView | null
}

export interface CreativeSubmit {
  readonly status: 'executed' | 'failed' | 'blocked' | 'declined'
  readonly reason: string
  readonly wrote: boolean
  readonly card: ConfirmationCardView | null
}

export async function issueCreativeCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  order: CreativeOrder
  deps: CreativeDeps
  now?: Date
}): Promise<CreativeIssue> {
  assertMayClick(args.clicker, args.clientId)
  const switched = await args.deps.switchState()
  if (switched !== 'on') return blocked(switchReason(switched))
  const seen = await args.deps.inspect(args.order)
  const guard = guardCreative(seen)
  if (guard.block || !guard.copy || !seen.plan.ok) return blocked(guard.block ?? '还不能出卡。')
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: creativeFacts(args.order, guard.checks),
    now: args.now ?? args.kernel.now(),
  })
  await retireStale(args.kernel.supabase, args.clientId, creativeSubject(args.order), card.fingerprint)
  await insertHold(args.kernel.supabase, args.clientId, holdFrom(args.order, guard.copy, seen.plan.planId, card))
  return { status: 'issued', reason: null, card }
}

export async function confirmCreativeCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  deps: CreativeDeps
  now?: Date
}): Promise<CreativeSubmit> {
  assertMayClick(args.clicker, args.clientId)
  const row = await holdForCard(args.kernel.supabase, args.clientId, args.runId)
  if (!row) return stopped('找不到这张加图卡，没有去建。')
  if (row.payload.status === 'writing') return stopped('上次加图还没记完，不会自动再写一次。')
  if (row.payload.status !== 'holding') return already(row)
  if (args.fingerprint !== row.payload.fingerprint) return stopped('你看到的内容已经不是这一张卡了。请刷新后再点。')
  if (args.resolution === 'decline') return decline(args, row)
  return confirmHolding(args, row)
}

async function confirmHolding(args: Parameters<typeof confirmCreativeCard>[0], row: HoldRow): Promise<CreativeSubmit> {
  const checked = await recheck(args.deps, row.payload)
  if (!checked.ok) return stopped(checked.reason)
  const view = await decide(args)
  if (!view) return stopped('这张卡没有确认成功，没有去建。')
  if (view.status !== 'confirmed') return closeUnconfirmed(args, row, view)
  const client = await args.deps.meta()
  if (!client) return closeUnconfirmed(args, row, withLine(view, '拿不到广告授权，没有去建。'))
  if (!await claimWriting(args.kernel.supabase, args.clientId, row)) return stopped('上次加图还没记完，不会自动再写一次。')
  const wrote = await runWrite(client, row.payload, checked.imageUrl).catch(() => emptyWrite('加图没有做成，没有再写一次。'))
  return finish(args, row, wrote, view)
}

async function recheck(deps: CreativeDeps, hold: CreativeHold): Promise<{ ok: true; imageUrl: string } | { ok: false; reason: string }> {
  const switched = await deps.switchState()
  if (switched !== 'on') return { ok: false, reason: switchReason(switched) }
  const seen = await deps.inspect(hold.order)
  const guard = guardCreative(seen)
  if (guard.block || !seen.imageUrl) return { ok: false, reason: guard.block ?? '内容工厂里找不到这张图，没有去建。' }
  if (!sameStory(hold.copy, guard.copy)) return { ok: false, reason: '组里用来复制落地页的广告变了，没有去建。' }
  return { ok: true, imageUrl: seen.imageUrl }
}

async function runWrite(meta: CreativeMeta, hold: CreativeHold, imageUrl: string): Promise<WriteOutcome> {
  const image = await meta.uploadImage({
    accountId: hold.order.adAccountId,
    storageUrl: imageUrl,
    filename: imageFilename(hold.order.imagePath),
  })
  if (!image.ok) return { ...blank(), error: `图没传上去：${image.error}。没有去建广告。` }
  const creative = await meta.createCreative({
    accountId: hold.order.adAccountId,
    name: hold.order.adName,
    story: storyFor(hold.order, hold.copy, image.id),
  })
  if (!creative.ok) {
    return { imageHash: image.id, creativeId: null, adId: null, error: `图已经传上去了，创意没建成：${creative.error}。没有自动再试。` }
  }
  const ad = await meta.createAd({
    accountId: hold.order.adAccountId,
    adSetId: hold.order.adSetId,
    name: hold.order.adName,
    creativeId: creative.id,
    status: hold.order.status,
  })
  if (!ad.ok) {
    return { imageHash: image.id, creativeId: creative.id, adId: null, error: `创意已经建成，广告没建成：${ad.error}。没有自动再试。` }
  }
  const state = hold.order.status === 'ACTIVE' ? '直接在投' : '暂停'
  return { imageHash: image.id, creativeId: creative.id, adId: ad.id, error: null, line: `新广告已建成，状态是${state}。没有改这一组的预算。` }
}

async function finish(
  args: Parameters<typeof confirmCreativeCard>[0],
  row: HoldRow,
  wrote: WriteOutcome,
  view: ConfirmationCardView,
): Promise<CreativeSubmit> {
  const ok = wrote.adId !== null && !wrote.error
  const reason = wrote.error ?? wrote.line ?? '没有建成。'
  const payload: CreativeHold = {
    ...row.payload,
    status: ok ? 'executed' : 'failed',
    imageHash: wrote.imageHash,
    creativeId: wrote.creativeId,
    adId: wrote.adId,
    wrote: wrote.imageHash !== null,
    resultLine: reason,
  }
  await saveHold(args.kernel.supabase, args.clientId, row, payload)
  return { status: ok ? 'executed' : 'failed', reason, wrote: payload.wrote, card: withLine(view, reason) }
}

async function decline(args: Parameters<typeof confirmCreativeCard>[0], row: HoldRow): Promise<CreativeSubmit> {
  const view = await decide(args)
  if (!view || view.status !== 'declined') return closeUnconfirmed(args, row, view)
  const payload: CreativeHold = { ...row.payload, status: 'declined', wrote: false, resultLine: '没有加这条广告。' }
  await saveHold(args.kernel.supabase, args.clientId, row, payload)
  return { status: 'declined', reason: '没有加这条广告。', wrote: false, card: withLine(view, '没有加这条广告。') }
}

async function closeUnconfirmed(
  args: Parameters<typeof confirmCreativeCard>[0],
  row: HoldRow,
  view: ConfirmationCardView | null,
): Promise<CreativeSubmit> {
  const reason = view?.statusLine ?? '这张卡没有确认成功，没有去建。'
  await saveHold(args.kernel.supabase, args.clientId, row, { ...row.payload, status: 'failed', wrote: false, resultLine: reason })
  const status = view?.status === 'confirmed' ? 'failed' : 'blocked'
  return { status, reason, wrote: false, card: view ? withLine(view, reason) : null }
}

async function decide(args: Parameters<typeof confirmCreativeCard>[0]): Promise<ConfirmationCardView | null> {
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

function holdFrom(order: CreativeOrder, copy: CopiedStory, planId: string, card: ConfirmationCardView): CreativeHold {
  return {
    kind: 'add_ad_creative',
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: creativeSubject(order),
    fingerprint: card.fingerprint,
    orderKey: orderKey(order, copy),
    order,
    copy,
    planId,
    imageHash: null,
    creativeId: null,
    adId: null,
    wrote: false,
  }
}

interface WriteOutcome {
  imageHash: string | null
  creativeId: string | null
  adId: string | null
  error: string | null
  line?: string
}

function blank(): WriteOutcome {
  return { imageHash: null, creativeId: null, adId: null, error: null }
}

function emptyWrite(error: string): WriteOutcome {
  return { ...blank(), error }
}

function blocked(reason: string): CreativeIssue {
  return { status: 'blocked', reason, card: null }
}

function stopped(reason: string): CreativeSubmit {
  return { status: 'blocked', reason, wrote: false, card: null }
}

function already(row: HoldRow): CreativeSubmit {
  const status = row.payload.status === 'executed' ? 'executed' : row.payload.status === 'declined' ? 'declined' : 'failed'
  return { status, reason: row.payload.resultLine ?? '这张卡已经有结果了，没有再去建。', wrote: row.payload.wrote, card: null }
}

function withLine(view: ConfirmationCardView, reason: string): ConfirmationCardView {
  return { ...view, statusLine: reason, confirmEnabled: false, declineEnabled: false }
}
