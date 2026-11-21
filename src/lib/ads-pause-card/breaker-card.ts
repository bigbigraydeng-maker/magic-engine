/**
 * Daily breaker asks for the existing pause-ad-set confirm card.
 * Nothing here calls the ad platform. A confirm re-reads the three-day
 * rule and refuses when it no longer holds. The route supplies the
 * existing pause execution, and only after that re-read passes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { issueConfirmationCard, type CardClicker } from '@/lib/confirmation-card'
import type { CardFacts } from '@/lib/confirmation-card/facts'
import { nzToday } from '@/lib/ads-strategy/promo-window'
import { NZ_DAY_EXPIRED, recheckBreakerPause } from '@/lib/ads-strategy/daily-card-guard'
import { PAUSE_AD_SET_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import { isExpired } from '@/lib/confirmation-card/view'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { MONEY_ACTION } from '@/lib/action-submission/money-card'
import type { PauseExecuteResult } from '@/lib/action-submission/pause-ad-set'

const CLICKER: CardClicker = { kind: 'agent', email: null }
const ACTION = ADS_ACTION_TYPE.PAUSE_AD_SET

export interface BreakerPauseIssue {
  readonly adsetId: string
  readonly campaignId: string
  readonly accountId: string
  readonly name: string
}

export interface BreakerExecuteInput {
  readonly adsetId: string
  readonly accountId: string
  readonly basis: string
  readonly nonce: string
}

export interface BreakerConfirmResult {
  readonly handled: boolean
  readonly wrote: boolean
  readonly reason: string
  readonly status: number
}

interface HoldRow {
  readonly id: string
  readonly payload: BreakerHold
}

interface BreakerHold {
  readonly breaker: true
  readonly status: 'holding' | 'writing' | 'executed' | 'failed' | 'declined'
  readonly cardRunId: string
  readonly fingerprint: string
  readonly adsetId: string
  readonly campaignId: string
  readonly adAccountId: string
  readonly issuedAt: string
  readonly wrote: boolean
  readonly resultLine?: string
}

export async function issueBreakerPauseCard(
  sb: SupabaseClient,
  clientId: string,
  args: BreakerPauseIssue,
  now = new Date(),
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  if (await pendingPause(sb, clientId, args.adsetId)) return { ok: false, reason: 'pending' }
  try {
    return await openCard(sb, clientId, args, now)
  } catch {
    return { ok: false, reason: 'card_failed' }
  }
}

export async function confirmBreakerPauseCard(args: {
  sb: SupabaseClient
  clientId: string
  runId: string
  fingerprint: string
  resolution: 'confirm' | 'decline'
  now?: Date
  recheck?: typeof recheckBreakerPause
  decide?: () => Promise<'confirmed' | 'declined' | 'stopped'>
  execute?: (input: BreakerExecuteInput) => Promise<PauseExecuteResult>
}): Promise<BreakerConfirmResult> {
  const row = await loadHold(args.sb, args.clientId, args.runId)
  if (!row) return { handled: false, wrote: false, reason: '', status: 0 }
  const now = args.now ?? new Date()
  const blocked = blockReason(row.payload, args.fingerprint)
  if (blocked) return refuse(blocked)
  if (args.resolution === 'decline') return declineHold(args, row)
  if (isExpired(row.payload.issuedAt, now, 'nz_day')) return refuse(NZ_DAY_EXPIRED)
  const fresh = await (args.recheck ?? recheckBreakerPause)(
    args.sb, args.clientId, row.payload.campaignId, row.payload.adAccountId, now, {}, row.payload.adsetId,
  )
  if (fresh) return refuse(fresh)
  return finish(args, row)
}

async function openCard(
  sb: SupabaseClient,
  clientId: string,
  args: BreakerPauseIssue,
  now: Date,
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const { createKernel } = await import('@/lib/kernel')
  const card = await issueConfirmationCard(createKernel(sb, { now: () => now }), {
    clientId, clicker: CLICKER, facts: cardFacts(args, now), now, lifetime: 'nz_day',
  })
  const saved = await insertHold(sb, clientId, args, card.runId, card.fingerprint, now)
  return saved ? { ok: true, runId: card.runId } : { ok: false, reason: 'card_failed' }
}

function cardFacts(args: BreakerPauseIssue, now: Date): CardFacts {
  const subjectKey = `pause-set:${canonicalHashOfInput({ adsetId: args.adsetId, day: nzToday(now.getTime()) }).slice(0, 12)}`
  return {
    subjectKey,
    what: PAUSE_AD_SET_WHAT,
    account: '已登记的广告账户',
    amount: '不改预算',
    date: '确认之后才暂停',
    scope: '只暂停这一个广告组，不开启，不改预算',
    hardChecks: [
      { label: '只暂停', state: 'green', reason: '不会开启，也不会改预算' },
      { label: '确认后才改', state: 'green', reason: '这一步只出卡，不会改广告' },
    ],
  }
}

async function pendingPause(sb: SupabaseClient, clientId: string, adsetId: string): Promise<boolean> {
  if (await holding(sb, clientId, ACTION, 'adsetId', adsetId, false)) return true
  if (await holding(sb, clientId, MONEY_ACTION, 'entityId', adsetId, true)) return true
  return holding(sb, clientId, ACTION, 'order->>adsetId', adsetId, false)
}

async function holding(
  sb: SupabaseClient,
  clientId: string,
  action: string,
  field: string,
  id: string,
  moneyPause: boolean,
): Promise<boolean> {
  const column = field.includes('->>') ? `payload->${field}` : `payload->>${field}`
  const { data, error } = await sb.from('flywheel_actions').select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', action)
    .eq('payload->>status', 'holding')
    .eq(column, id)
    .limit(5)
  if (error) return true
  const rows = (data ?? []) as Array<{ payload?: { lane?: string; breaker?: boolean } }>
  if (!moneyPause) return rows.length > 0
  return rows.some((row) => row.payload?.lane === 'pause_adset')
}

async function insertHold(
  sb: SupabaseClient,
  clientId: string,
  args: BreakerPauseIssue,
  runId: string,
  fingerprint: string,
  now: Date,
): Promise<boolean> {
  const payload: BreakerHold = {
    breaker: true,
    status: 'holding',
    cardRunId: runId,
    fingerprint,
    adsetId: args.adsetId,
    campaignId: args.campaignId,
    adAccountId: args.accountId,
    issuedAt: now.toISOString(),
    wrote: false,
  }
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: null,
  })
  return !error
}

async function loadHold(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const { data, error } = await sb.from('flywheel_actions').select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', ACTION)
    .eq('payload->>cardRunId', runId)
    .limit(5)
  if (error) return null
  const rows = ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asBreaker)
  return rows.length === 1 ? rows[0] ?? null : null
}

function asBreaker(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as Partial<BreakerHold>
  if (payload.breaker !== true || !payload.cardRunId || !payload.adsetId || !payload.fingerprint) return []
  return [{ id: row.id, payload: payload as BreakerHold }]
}

function blockReason(hold: BreakerHold, fingerprint: string): string | null {
  if (hold.fingerprint !== fingerprint) return '你看到的内容已经不是这一张卡了。请刷新后再点。'
  if (hold.status === 'writing') return '上次暂停还没记完，不会自动再写一次。'
  if (hold.status !== 'holding') return hold.resultLine ?? '这张卡已经有结果了，没有再去暂停。'
  return null
}

async function declineHold(
  args: Parameters<typeof confirmBreakerPauseCard>[0],
  row: HoldRow,
): Promise<BreakerConfirmResult> {
  if (args.decide) {
    const decided = await args.decide().catch(() => 'stopped' as const)
    if (decided === 'stopped') return refuse('这张卡没有记下你的选择，没有去暂停。')
  }
  return decline(args.sb, args.clientId, row)
}

async function decline(sb: SupabaseClient, clientId: string, row: HoldRow): Promise<BreakerConfirmResult> {
  await save(sb, clientId, row, { ...row.payload, status: 'declined', wrote: false, resultLine: '没有暂停。' })
  return { handled: true, wrote: false, reason: '没有暂停。', status: 200 }
}

async function finish(
  args: Parameters<typeof confirmBreakerPauseCard>[0],
  row: HoldRow,
): Promise<BreakerConfirmResult> {
  if (args.decide) {
    const decided = await args.decide().catch(() => 'stopped' as const)
    if (decided !== 'confirmed') return refuse('这张卡没有确认成功，没有去暂停。')
  }
  if (!args.execute) return refuse('这张卡还不能暂停，没有改广告。')
  const claimed = await save(args.sb, args.clientId, row, { ...row.payload, status: 'writing', wrote: false })
  if (!claimed) return refuse('上次暂停还没记完，不会自动再写一次。')
  const result = await args.execute({
    adsetId: row.payload.adsetId,
    accountId: row.payload.adAccountId,
    basis: '最近三个完整日的单次成本已经高于约定目标的倍数。确认之后才暂停这个广告组。',
    nonce: row.payload.cardRunId,
  }).catch(() => refusedExecute())
  const wrote = result.kind === 'paused'
  await save(args.sb, args.clientId, row, {
    ...row.payload,
    status: wrote ? 'executed' : 'failed',
    wrote,
    resultLine: result.reason,
  })
  return { handled: true, wrote, reason: result.reason, status: wrote ? 200 : 409 }
}

async function save(sb: SupabaseClient, clientId: string, row: HoldRow, payload: BreakerHold): Promise<boolean> {
  const { error } = await sb.from('flywheel_actions').update({ payload }).eq('id', row.id).eq('client_id', clientId)
  return !error
}

function refuse(reason: string): BreakerConfirmResult {
  return { handled: true, wrote: false, reason, status: 409 }
}

function refusedExecute(): PauseExecuteResult {
  return { kind: 'refused', before: null, after: null, runId: null, reason: '没有暂停。' }
}
