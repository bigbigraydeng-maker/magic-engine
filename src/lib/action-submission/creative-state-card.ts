/**
 * Creative-state cards. This file does not call Meta.
 * Confirm writes only through injected ports, after an unexpired human confirm.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { issueConfirmationCard, decideConfirmationCard, type CardClicker } from '@/lib/confirmation-card'
import type { CardLifetime, ConfirmationCardView } from '@/lib/confirmation-card/view'
import { isExpired } from '@/lib/confirmation-card/view'
import { NZ_DAY_EXPIRED } from '@/lib/ads-strategy/daily-card-guard'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import { ADS_ACTION_TYPE, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import {
  CREATIVE_MOVE_WHAT,
  CREATIVE_PAUSE_WHAT,
  CREATIVE_PLAN_WHAT,
} from '@/lib/creative-state/copy'
import { nzProposalDay, type CreativeDecision, type CreativeProposal } from '@/lib/creative-state/rules'

const ACTION = ADS_ACTION_TYPE.CREATIVE_STATE_PROPOSAL
const ACCOUNT = '这位客户的广告账户'

export type CreativeKind = CreativeProposal['kind']
export type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'

export interface CreativeHold {
  readonly kind: CreativeKind
  readonly status: HoldStatus
  readonly cardRunId: string
  readonly subjectKey: string
  readonly fingerprint: string
  readonly proposedOn: string
  readonly adId: string
  readonly name: string
  readonly adsetId: string
  readonly scaleAdsetId: string | null
  readonly postId: string | null
  readonly pageId: string | null
  readonly adAccountId: string
  readonly writeAttempted: boolean
  readonly wroteMeta: boolean
  readonly readback: string | null
  readonly confirmedBy: string | null
  readonly resultLine?: string
  readonly lifetime?: CardLifetime
  readonly issuedAt?: string
}

export interface CreativeActor {
  readonly triggeredBy: string
  readonly triggeredByRef: string
}

export interface ConfirmCreativeInput {
  readonly clientId: string
  readonly runId: string
  readonly decisionId: string
  readonly fingerprint: string
  readonly choice: 'confirm' | 'decline'
  readonly clicker: CardClicker
  readonly actor: CreativeActor
}

export interface CreativeResult {
  readonly card: ConfirmationCardView | null
  readonly resultLine: string
  readonly wroteMeta: boolean
}

export interface PausedCreate {
  readonly adAccountId: string
  readonly adsetId: string
  readonly pageId: string
  readonly postId: string
  readonly name: string
  readonly status: 'PAUSED'
  readonly accessToken: string
}

export interface CreativePorts {
  decide(input: ConfirmCreativeInput): Promise<ConfirmationCardView>
  recheck(clientId: string): Promise<CreativeDecision>
  token(clientId: string): Promise<string | null>
  createPaused(input: PausedCreate): Promise<{ adId: string }>
  readPlacement(adId: string, token: string): Promise<{ status: string | null; adsetId: string | null } | null>
  pause(input: { clientId: string; adId: string; adAccountId: string; adsetId: string }): Promise<{ ok: boolean; wroteMeta: boolean; readback: string | null; reason: string }>
}

interface HoldRow {
  readonly id: string
  readonly payload: CreativeHold
}

export async function proposeCreativeStateCards(
  kernel: KernelDeps,
  args: { clientId: string; clicker: CardClicker; decision: CreativeDecision; now?: Date; lifetime?: CardLifetime },
): Promise<{ issued: Array<{ kind: CreativeKind; runId: string }>; skipped: string[] }> {
  const now = args.now ?? kernel.now()
  const day = nzProposalDay(now)
  const existing = await loadHolds(kernel.supabase, args.clientId)
  if (existing === 'unread') return { issued: [], skipped: [...args.decision.skipped, 'ledger_unread'] }
  const issued: Array<{ kind: CreativeKind; runId: string }> = []
  const skipped = [...args.decision.skipped]
  let promoted = existing.filter((row) => isPromotion(row.payload) && row.payload.proposedOn === day).length
  for (const proposal of args.decision.proposals) {
    const one = await issueOne(kernel, args, proposal, existing, day, promoted, skipped)
    if (!one) continue
    if (isPromotionKind(one.kind)) promoted += 1
    issued.push(one)
  }
  return { issued, skipped }
}

export async function confirmCreativeStateCard(
  kernel: KernelDeps,
  input: ConfirmCreativeInput,
  ports: CreativePorts,
): Promise<CreativeResult> {
  const row = await holdForCard(kernel.supabase, input.clientId, input.runId)
  if (!row) throw new ConfirmationCardError('not_found', '找不到这张建议卡。')
  if (row.payload.fingerprint !== input.fingerprint) {
    throw new ConfirmationCardError('stale', '你看到的内容已经不是这一张卡了。请刷新后再点。')
  }
  if (row.payload.status !== 'holding') return quiet(row.payload)
  if (input.choice === 'decline') return decline(kernel, input, row, ports)
  const expired = expiredLine(row.payload, kernel.now())
  if (expired) return { card: null, resultLine: expired, wroteMeta: false }
  const blocked = await blockReason(input.clientId, row.payload, ports)
  if (blocked) throw new ConfirmationCardError('stale', blocked)
  const card = await ports.decide(input)
  if (card.status !== 'confirmed') return refuseClosed(kernel, input, row, card)
  const claimed = await claimHold(kernel.supabase, input.clientId, row, who(input.actor))
  if (!claimed) return { card, resultLine: '没有改广告。', wroteMeta: false }
  const next = await writeOnce(input, claimedPayload(row, input.actor), ports)
  await saveHold(kernel.supabase, input.clientId, row, next)
  return { card, resultLine: next.resultLine ?? '做完了。', wroteMeta: next.wroteMeta }
}

async function issueOne(
  kernel: KernelDeps,
  args: { clientId: string; clicker: CardClicker; now?: Date; lifetime?: CardLifetime },
  proposal: CreativeProposal,
  existing: HoldRow[],
  day: string,
  promoted: number,
  skipped: string[],
): Promise<{ kind: CreativeKind; runId: string } | null> {
  if (isPromotionKind(proposal.kind) && promoted >= 1) {
    skipped.push('promotion_cap')
    return null
  }
  const subjectKey = subjectFor(proposal)
  if (existing.some((row) => row.payload.subjectKey === subjectKey && busy(row.payload.status))) {
    skipped.push('already_open')
    return null
  }
  const facts = factsFor(subjectKey, proposal.kind)
  const lifetime = args.lifetime ?? 'urgent_30m'
  const card = await issueConfirmationCard(kernel, {
    clientId: args.clientId, clicker: args.clicker, facts, now: args.now, lifetime,
  })
  const issuedAt = (args.now ?? kernel.now()).toISOString()
  await insertHold(kernel.supabase, args.clientId, holdFrom(proposal, card, day, subjectKey, lifetime, issuedAt))
  return { kind: proposal.kind, runId: card.runId }
}

function expiredLine(hold: CreativeHold, now: Date): string | null {
  if (!hold.issuedAt) return null
  const lifetime = hold.lifetime ?? 'urgent_30m'
  if (!isExpired(hold.issuedAt, now, lifetime)) return null
  return lifetime === 'nz_day' ? NZ_DAY_EXPIRED : '过了 30 分钟没人点，这张卡作废了。'
}

async function blockReason(clientId: string, hold: CreativeHold, ports: CreativePorts): Promise<string | null> {
  const decision = await ports.recheck(clientId).catch(() => null)
  if (!decision) return '广告数据读不出来，没有改广告。'
  if (decision.skipped.includes('stale_snapshot') || decision.skipped.includes('ledger_unread')) {
    return '广告快照不是最近一次抓全的，或者抓的时候出错了，没有改广告。'
  }
  if (decision.skipped.includes('plan_guard')) {
    return '已批准的计划对不上单独一份，或者每天上限读不到，没有改广告。'
  }
  const same = decision.proposals.some((item) => item.kind === hold.kind && item.ad.adId === hold.adId)
  return same ? null : '按最新数字，这条建议已经不成立，没有改广告。'
}

async function writeOnce(input: ConfirmCreativeInput, hold: CreativeHold, ports: CreativePorts): Promise<CreativeHold> {
  if (hold.kind === 'new_plan') return recorded(hold, '已记下新计划提案，没有改正在跑的预算。')
  if (hold.kind === 'pause') return writePause(input, hold, ports)
  return writeMove(input, hold, ports)
}

async function writeMove(input: ConfirmCreativeInput, hold: CreativeHold, ports: CreativePorts): Promise<CreativeHold> {
  const token = await ports.token(input.clientId)
  if (!token || !hold.postId || !hold.pageId || !hold.scaleAdsetId) return failed(hold, '放量组或帖子读不到，没有建。', false, null)
  const adId = await created(ports, hold, token)
  if (!adId) return failed(hold, '没建成。没有再试一次。', false, null)
  const placement = await ports.readPlacement(adId, token).catch(() => null)
  if (placement?.status !== 'PAUSED' || placement.adsetId !== hold.scaleAdsetId) {
    return failed(hold, '读回来和要建的暂停广告不一致，没有再改一次。', true, placement?.status ?? null)
  }
  return { ...hold, status: 'executed', wroteMeta: true, readback: 'PAUSED', resultLine: '已在放量组建成暂停广告。要开投再另点确认。' }
}

async function writePause(input: ConfirmCreativeInput, hold: CreativeHold, ports: CreativePorts): Promise<CreativeHold> {
  const result = await ports.pause({
    clientId: input.clientId, adId: hold.adId, adAccountId: hold.adAccountId, adsetId: hold.adsetId,
  }).catch(() => ({ ok: false, wroteMeta: false, readback: null, reason: '暂停没有写成，没有再写一次。' }))
  if (!result.ok) return failed(hold, result.reason, result.wroteMeta, result.readback)
  return { ...hold, status: 'executed', wroteMeta: result.wroteMeta, readback: result.readback, resultLine: result.reason }
}

async function created(ports: CreativePorts, hold: CreativeHold, token: string): Promise<string | null> {
  try {
    const createdAd = await ports.createPaused({
      adAccountId: hold.adAccountId,
      adsetId: hold.scaleAdsetId ?? '',
      pageId: hold.pageId ?? '',
      postId: barePost(hold.postId ?? ''),
      name: safeName(hold.name),
      status: 'PAUSED',
      accessToken: token,
    })
    return createdAd.adId
  } catch {
    return null
  }
}

function factsFor(subjectKey: string, kind: CreativeKind): CardFacts {
  if (kind === 'move_to_scale') {
    return facts(subjectKey, CREATIVE_MOVE_WHAT, '不改预算', '确认之后才建，先观察', '不关正在测的那条，也不加预算', '只建暂停')
  }
  if (kind === 'new_plan') {
    return facts(subjectKey, CREATIVE_PLAN_WHAT, '不高于已批准的每天上限', '确认之后才记下', '不改正在跑的那份预算', '只记新计划')
  }
  return facts(subjectKey, CREATIVE_PAUSE_WHAT, '不改预算', '确认之后才暂停', '只暂停这一条', '出卡这一步不暂停')
}

function facts(subjectKey: string, what: string, amount: string, date: string, scope: string, label: string): CardFacts {
  const hardChecks: HardCheck[] = [{ label, state: 'green', reason: '没有在出卡这一步改广告' }]
  return { subjectKey, what, account: ACCOUNT, amount, date, scope, hardChecks }
}

function holdFrom(
  proposal: CreativeProposal,
  card: ConfirmationCardView,
  day: string,
  subjectKey: string,
  lifetime: CardLifetime,
  issuedAt: string,
): CreativeHold {
  const scaleAdsetId = proposal.kind === 'pause' ? null : proposal.scaleAdsetId
  return {
    kind: proposal.kind, status: 'holding', cardRunId: card.runId, subjectKey, fingerprint: card.fingerprint,
    proposedOn: day, adId: proposal.ad.adId, name: proposal.ad.name, adsetId: proposal.ad.adsetId,
    scaleAdsetId, postId: proposal.ad.postId, pageId: proposal.ad.pageId, adAccountId: proposal.ad.adAccountId,
    writeAttempted: false, wroteMeta: false, readback: null, confirmedBy: null,
    lifetime, issuedAt,
  }
}

function subjectFor(proposal: CreativeProposal): string {
  const prefix = proposal.kind === 'move_to_scale' ? 'cscale' : proposal.kind === 'new_plan' ? 'cplan' : 'cpause'
  const body = proposal.kind === 'pause'
    ? { adId: proposal.ad.adId, adsetId: proposal.ad.adsetId }
    : { adId: proposal.ad.adId, scaleAdsetId: proposal.scaleAdsetId }
  return `${prefix}:${canonicalHashOfInput(body).slice(0, 12)}`
}

function recorded(hold: CreativeHold, resultLine: string): CreativeHold {
  return { ...hold, status: 'executed', wroteMeta: false, readback: 'recorded', resultLine }
}

function failed(hold: CreativeHold, resultLine: string, wroteMeta: boolean, readback: string | null): CreativeHold {
  return { ...hold, status: 'failed', wroteMeta, readback, resultLine }
}

function quiet(hold: CreativeHold): CreativeResult {
  if (hold.status === 'writing') return { card: null, resultLine: '上次写到一半，没有再自动写一次。', wroteMeta: false }
  if (hold.status === 'declined') return { card: null, resultLine: '这张卡已经不做了。', wroteMeta: false }
  if (hold.status === 'failed') return { card: null, resultLine: hold.resultLine ?? '上次没做成，没有自动再试。', wroteMeta: false }
  return { card: null, resultLine: hold.resultLine ?? '这张卡已经做完了。', wroteMeta: false }
}

async function decline(
  kernel: KernelDeps,
  input: ConfirmCreativeInput,
  row: HoldRow,
  ports: CreativePorts,
): Promise<CreativeResult> {
  const card = await ports.decide(input)
  if (card.status === 'expired' || card.status === 'voided') return refuseClosed(kernel, input, row, card)
  const next: CreativeHold = { ...row.payload, status: 'declined', confirmedBy: who(input.actor), resultLine: '不做了。' }
  await saveHold(kernel.supabase, input.clientId, row, next)
  return { card, resultLine: '不做了。', wroteMeta: false }
}

async function refuseClosed(
  kernel: KernelDeps,
  input: ConfirmCreativeInput,
  row: HoldRow,
  card: ConfirmationCardView,
): Promise<CreativeResult> {
  const next: CreativeHold = { ...row.payload, status: 'failed', resultLine: '这张卡已经过期或作废，没有改广告。' }
  await saveHold(kernel.supabase, input.clientId, row, next)
  return { card, resultLine: next.resultLine ?? '没有改广告。', wroteMeta: false }
}

function claimedPayload(row: HoldRow, actor: CreativeActor): CreativeHold {
  return { ...row.payload, status: 'writing', confirmedBy: who(actor), writeAttempted: true }
}

function who(actor: CreativeActor): string {
  if (!actor.triggeredBy || !actor.triggeredByRef) {
    throw new ConfirmationCardError('forbidden', '认不出是谁点的，没有改。')
  }
  return actor.triggeredByRef
}

function isPromotion(hold: CreativeHold): boolean {
  return isPromotionKind(hold.kind)
}

function isPromotionKind(kind: CreativeKind): boolean {
  return kind === 'move_to_scale' || kind === 'new_plan'
}

function busy(status: HoldStatus): boolean {
  return status === 'holding' || status === 'writing' || status === 'executed'
}

function safeName(name: string): string {
  const clean = name.replace(/[{}[\]`]/g, '').replace(/\s+/g, ' ').trim()
  return (clean || '放量暂停稿').slice(0, 90)
}

function barePost(postId: string): string {
  const idx = postId.lastIndexOf('_')
  const bare = idx >= 0 ? postId.slice(idx + 1) : postId
  return bare || postId
}

async function loadHolds(sb: KernelDeps['supabase'], clientId: string): Promise<HoldRow[] | 'unread'> {
  const { data, error } = await sb.from('flywheel_actions').select('id, payload').eq('client_id', clientId).eq('action_type', ACTION)
  if (error) return 'unread'
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

async function holdForCard(sb: KernelDeps['supabase'], clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await loadHolds(sb, clientId)
  if (rows === 'unread') throw new ConfirmationCardError('invalid', '建议卡的台账读不出来，没有改广告。')
  const found = rows.filter((row) => row.payload.cardRunId === runId)
  return found.length === 1 ? found[0] ?? null : null
}

async function insertHold(sb: KernelDeps['supabase'], clientId: string, payload: CreativeHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: ADS_METRIC_KEY.COST_PER_LEAD,
    expected_delta: payload.kind === 'pause' ? -1 : 1,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有改广告。')
}

async function claimHold(sb: KernelDeps['supabase'], clientId: string, row: HoldRow, confirmedBy: string): Promise<boolean> {
  const next: CreativeHold = { ...row.payload, status: 'writing', confirmedBy, writeAttempted: true }
  const { data, error } = await sb.from('flywheel_actions')
    .update({ payload: next, expected_metric: ADS_METRIC_KEY.COST_PER_LEAD, expected_delta: next.kind === 'pause' ? -1 : 1 })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

async function saveHold(sb: KernelDeps['supabase'], clientId: string, row: HoldRow, payload: CreativeHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').update({ payload }).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再改一次广告。')
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as CreativeHold
  if (!payload.cardRunId || !payload.subjectKey || !payload.kind) return []
  return [{ id: row.id, payload }]
}
