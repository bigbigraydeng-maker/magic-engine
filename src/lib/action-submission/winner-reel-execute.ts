/**
 * A confirmed winner-sync card writes once.
 * New ads are created paused. Opening them is a second card.
 * A pause uses the confirmed pause path: guards, one write, read-back, ledger.
 * The winner card is the only confirmation. There is no second click.
 * A row left in `writing` is not retried. A mismatched read-back is not written again.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { createKernel } from '@/lib/kernel'
import { decideConfirmationCard, type CardClicker } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import { createAdFromPost, readAdPlacement, activateAd, type AdPlacement } from '@/lib/meta/ads-manager'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { linkAdToCreative, type LinkAdToCreativeArgs } from '@/lib/ads/creative-link'
import { pauseConfirmedWinnerAd, type WinnerPauseInput, type WinnerPauseResult } from '@/lib/ads-pause-card/winner-pause'
import { collectWinnerSuggestions, type WinnerSuggestions } from '@/lib/winner-reel-sync/engine'
import { proposeActivateCard } from '@/lib/winner-reel-sync/propose'
import { claimHold, holdForCard, saveHold, type HoldRow } from '@/lib/winner-reel-sync/ledger'
import type { ProposalHold } from '@/lib/winner-reel-sync/intents'

export interface WinnerActor {
  triggeredBy: string
  triggeredByRef: string
}

export interface ConfirmWinnerInput {
  clientId: string
  runId: string
  decisionId: string
  fingerprint: string
  choice: 'confirm' | 'decline'
  clicker: CardClicker
  actor: WinnerActor
}

export interface WinnerResult {
  card: ConfirmationCardView | null
  resultLine: string
  wroteMeta: boolean
}

export interface WinnerPorts {
  decide(input: ConfirmWinnerInput): Promise<ConfirmationCardView>
  recheck(clientId: string, skipFatiguePause: boolean): Promise<WinnerSuggestions>
  token(clientId: string): Promise<string | null>
  createPaused(input: PausedCreate): Promise<{ adId: string }>
  readPlacement(adId: string, token: string): Promise<AdPlacement | null>
  activate(adId: string, token: string): Promise<boolean>
  link(args: LinkAdToCreativeArgs): Promise<{ creativeRef: string | null }>
  kernel(): KernelDeps
  runPause(input: WinnerPauseInput): Promise<WinnerPauseResult>
  proposeLive(args: Parameters<typeof proposeActivateCard>[0]): Promise<string | null>
}

interface PausedCreate {
  adAccountId: string
  adsetId: string
  pageId: string
  postId: string
  name: string
  status: 'PAUSED'
  accessToken: string
}

export async function confirmWinnerCard(
  sb: KernelDeps['supabase'],
  input: ConfirmWinnerInput,
  ports: WinnerPorts = defaultPorts(sb),
): Promise<WinnerResult> {
  const row = await holdForCard(sb, input.clientId, input.runId)
  if (!row) throw new ConfirmationCardError('not_found', '找不到这张建议卡。')
  if (row.payload.fingerprint !== input.fingerprint) {
    throw new ConfirmationCardError('stale', '你看到的内容已经不是这一张卡了。请刷新后再点。')
  }
  if (row.payload.status !== 'holding') return quiet(row.payload)
  if (input.choice === 'decline') return decline(sb, input, row, ports)
  if (!(await stillValid(input, row.payload, ports))) {
    throw new ConfirmationCardError('stale', '这条建议已经对不上现在的广告了，没有改。')
  }
  const card = await ports.decide(input)
  if (card.status === 'expired' || card.status === 'voided' || card.status !== 'confirmed') {
    return refuseClosed(sb, input, row, card)
  }
  const claimed = await claimHold(sb, input.clientId, row, who(input.actor))
  if (!claimed) return { card, resultLine: '没有改广告。', wroteMeta: false }
  const next = await writeOnce(input, claimedPayload(row, input.actor), ports)
  await saveHold(sb, input.clientId, row, next)
  return { card, resultLine: next.resultLine ?? '做完了。', wroteMeta: next.wroteMeta }
}

function defaultPorts(sb: KernelDeps['supabase']): WinnerPorts {
  return {
    decide: (input) => decideConfirmationCard(createKernel(sb), {
      clientId: input.clientId,
      runId: input.runId,
      clicker: input.clicker,
      resolution: input.choice,
      expectedDecisionId: input.decisionId,
      fingerprint: input.fingerprint,
    }),
    recheck: (clientId, skipFatiguePause) => collectWinnerSuggestions(clientId, { skipFatiguePause }),
    token: getMetaTokenForClient,
    createPaused: (input) => createAdFromPost({ ...input, status: 'PAUSED' }),
    readPlacement: readAdPlacement,
    activate: activateAd,
    link: linkAdToCreative,
    kernel: () => createKernel(sb),
    runPause: (input) => pauseConfirmedWinnerAd(input),
    proposeLive: proposeActivateCard,
  }
}

function who(actor: WinnerActor): string {
  if (actor.triggeredBy.length === 0 || !actor.triggeredByRef) {
    throw new ConfirmationCardError('forbidden', '认不出是谁点的，没有改。')
  }
  return actor.triggeredByRef
}

function quiet(hold: ProposalHold): WinnerResult {
  if (hold.status === 'writing') return { card: null, resultLine: '上次写到一半，没有再自动写一次。', wroteMeta: false }
  if (hold.status === 'declined') return { card: null, resultLine: '这张卡已经不做了。', wroteMeta: false }
  if (hold.status === 'failed') return { card: null, resultLine: hold.resultLine ?? '上次没做成，没有自动再试。', wroteMeta: false }
  return { card: null, resultLine: hold.resultLine ?? '这张卡已经做完了。', wroteMeta: false }
}

async function decline(sb: KernelDeps['supabase'], input: ConfirmWinnerInput, row: HoldRow, ports: WinnerPorts): Promise<WinnerResult> {
  const card = await ports.decide(input)
  if (card.status === 'expired' || card.status === 'voided') return refuseClosed(sb, input, row, card)
  const next: ProposalHold = { ...row.payload, status: 'declined', confirmedBy: who(input.actor), resultLine: '不做了。' }
  await saveHold(sb, input.clientId, row, next)
  return { card, resultLine: next.resultLine ?? '不做了。', wroteMeta: false }
}

async function stillValid(input: ConfirmWinnerInput, hold: ProposalHold, ports: WinnerPorts): Promise<boolean> {
  if (hold.kind === 'activate') return placementIs(input.clientId, hold, ports, 'PAUSED')
  const plan = await ports.recheck(input.clientId, hold.kind === 'add_paused')
  if (plan.status !== 'ok') return false
  if (hold.kind === 'add_paused') return plan.adds.some((item) => item.postId === hold.postId && item.adsetId === hold.adsetId)
  return plan.pauses.some((item) => item.adId === hold.adId && item.adsetId === hold.adsetId)
}

async function placementIs(clientId: string, hold: ProposalHold, ports: WinnerPorts, status: string): Promise<boolean> {
  if (!hold.adId) return false
  const token = await ports.token(clientId)
  if (!token) return false
  return matches(await ports.readPlacement(hold.adId, token), hold, status)
}

function claimedPayload(row: HoldRow, actor: WinnerActor): ProposalHold {
  return { ...row.payload, status: 'writing', confirmedBy: who(actor), writeAttempted: true }
}

async function writeOnce(input: ConfirmWinnerInput, hold: ProposalHold, ports: WinnerPorts): Promise<ProposalHold> {
  if (hold.kind === 'add_paused') return writeAdd(input, hold, ports)
  if (hold.kind === 'pause_ad') return writePause(input, hold, ports)
  return writeActivate(input.clientId, hold, ports)
}

async function writeAdd(input: ConfirmWinnerInput, hold: ProposalHold, ports: WinnerPorts): Promise<ProposalHold> {
  const token = await ports.token(input.clientId)
  if (!token || !hold.postId) return failed(hold, '读不到广告账户的钥匙，没有建。', false, null)
  const adId = await createdAd(ports, hold, token)
  if (!adId) return failed(hold, '没建成。没有再试一次。', false, null)
  const placement = await ports.readPlacement(adId, token)
  if (!matches(placement, hold, 'PAUSED')) {
    return failed({ ...hold, adId }, '读回来和要建的暂停广告不一致，没有再改一次。', true, placement?.status ?? null)
  }
  await remember(ports, input.clientId, hold, adId)
  await offerLive(input, hold, adId, ports)
  return { ...hold, status: 'executed', adId, wroteMeta: true, readback: 'PAUSED', resultLine: '已建成暂停广告。要开投再点下一张卡。' }
}

async function createdAd(ports: WinnerPorts, hold: ProposalHold, token: string): Promise<string | null> {
  try {
    const created = await ports.createPaused({
      adAccountId: hold.adAccountId,
      adsetId: hold.adsetId,
      pageId: hold.pageId,
      postId: hold.postId ?? '',
      name: hold.name,
      status: 'PAUSED',
      accessToken: token,
    })
    return created.adId
  } catch {
    return null
  }
}

async function remember(ports: WinnerPorts, clientId: string, hold: ProposalHold, adId: string): Promise<void> {
  try {
    await ports.link({ clientId, adId, postId: hold.postId ?? '', pageId: hold.pageId, createdBy: 'winner_reel_sync' })
  } catch {
    // 片子对应关系丢了也不能再去建一次广告。
  }
}

async function offerLive(input: ConfirmWinnerInput, hold: ProposalHold, adId: string, ports: WinnerPorts): Promise<void> {
  try {
    await ports.proposeLive({
      kernel: ports.kernel(),
      clientId: input.clientId,
      clicker: input.clicker,
      pageId: hold.pageId,
      adAccountId: hold.adAccountId,
      adsetId: hold.adsetId,
      adId,
      name: hold.name,
      configAskedActive: hold.configAskedActive,
    })
  } catch {
    // 开投卡没出也不再去改刚建成的暂停广告。
  }
}

async function refuseClosed(
  sb: KernelDeps['supabase'],
  input: ConfirmWinnerInput,
  row: HoldRow,
  card: ConfirmationCardView,
): Promise<WinnerResult> {
  const reason = card.status === 'expired' || card.status === 'voided'
    ? card.statusLine
    : '这张卡没有确认成功，没有改广告。'
  const next: ProposalHold = { ...row.payload, status: 'failed', wroteMeta: false, resultLine: reason }
  await saveHold(sb, input.clientId, row, next)
  return { card, resultLine: reason, wroteMeta: false }
}

async function writePause(input: ConfirmWinnerInput, hold: ProposalHold, ports: WinnerPorts): Promise<ProposalHold> {
  if (!hold.adId) return failed(hold, '没有要暂停的广告，没有改。', false, null)
  const result = await ports.runPause({
    clientId: input.clientId,
    adId: hold.adId,
    adAccountId: hold.adAccountId,
    adsetId: hold.adsetId,
  })
  return {
    ...hold,
    status: result.ok ? 'executed' : 'failed',
    wroteMeta: result.wroteMeta,
    readback: result.readback,
    resultLine: result.reason,
  }
}

async function writeActivate(clientId: string, hold: ProposalHold, ports: WinnerPorts): Promise<ProposalHold> {
  if (!hold.adId) return failed(hold, '没有要打开的广告，没有改。', false, null)
  const token = await ports.token(clientId)
  if (!token) return failed(hold, '读不到广告账户的钥匙，没有打开。', false, null)
  const before = await ports.readPlacement(hold.adId, token)
  if (!matches(before, hold, 'PAUSED')) return failed(hold, '这条广告已经不是暂停，没有打开。', false, before?.status ?? null)
  const sent = await ports.activate(hold.adId, token)
  const after = await ports.readPlacement(hold.adId, token)
  if (!sent || after?.status !== 'ACTIVE') {
    return failed(hold, '读回来不是已打开，没有再改一次。', sent, after?.status ?? null)
  }
  return { ...hold, status: 'executed', wroteMeta: true, readback: 'ACTIVE', resultLine: '这条广告已打开。' }
}

function matches(placement: AdPlacement | null, hold: ProposalHold, status: string): boolean {
  if (!placement || placement.status !== status) return false
  if (!sameAccount(placement.accountId, hold.adAccountId)) return false
  return placement.adsetId === hold.adsetId
}

function sameAccount(live: string | null, expected: string): boolean {
  if (!live) return false
  return live.replace(/^act_/, '') === expected.replace(/^act_/, '')
}

function failed(hold: ProposalHold, resultLine: string, wroteMeta: boolean, readback: string | null): ProposalHold {
  return { ...hold, status: 'failed', wroteMeta, readback, resultLine }
}
