/**
 * The old execution board may ask to pause or resume a campaign.
 * Meta changes only after a person confirms, then guards, one write, read-back, and the ledger.
 * A paid client may ask. Resume still requires the spend approver. Pause does not.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { createKernel } from '@/lib/kernel'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import {
  clickerFromSession,
  decideConfirmationCard,
  issueConfirmationCard,
  type CardClicker,
  type CardFacts,
} from '@/lib/confirmation-card'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import type { ClientAccessResult } from '@/lib/auth/client-access'
import { CAMPAIGN_PAUSE_WHAT, CAMPAIGN_RESUME_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import {
  MESSENGER_LOOKUP_FAILED_MESSAGE,
  MESSENGER_REACTIVATE_BLOCKED_MESSAGE,
  checkMessengerDraftCampaign,
} from '@/lib/ads-strategy/messenger-draft-campaign-guard'
import { buildSpendActivationReceipt, requireSpendActivationAuthority, type SpendActivationReceipt } from '@/lib/ads/spend-activation'
import { bindLaunchToApprovedPlan } from '@/lib/ads-launch/plan-gate'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { resolveAndLogAdsExpectedMetric } from '@/lib/flywheel/ads-expected-metric'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import { setCampaignStatus } from '@/lib/meta/client'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'

type Access = Extract<ClientAccessResult, { ok: true }>
type Sb = KernelDeps['supabase']
export type CampaignKind = 'pause' | 'resume'
type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'

export interface CampaignHold {
  status: HoldStatus
  kind: CampaignKind
  cardRunId: string
  fingerprint: string
  expectedDecisionId: string
  campaign_id: string
  ad_account_id: string
  objective: string | null
  before: { status: string; name: string; daily_budget: string | null }
  after: { status: string; name: string; daily_budget: string | null }
  wrote: boolean
  requestedBy: string
  executionItemId: string | null
  resultLine?: string
  authorization?: SpendActivationReceipt
}

interface HoldRow { readonly id: string; readonly payload: CampaignHold }

export interface LiveCampaign {
  readonly status: string
  readonly accountId: string
  readonly name: string
}

export interface CampaignDeps {
  issue(clientId: string, clicker: CardClicker, facts: CardFacts): Promise<ConfirmationCardView>
  decide(args: DecideArgs): Promise<ConfirmationCardView>
  live(clientId: string, campaignId: string): Promise<LiveCampaign | null>
  write(clientId: string, campaignId: string, status: 'PAUSED' | 'ACTIVE'): Promise<boolean>
  messenger(campaignId: string): Promise<'ok' | 'blocked' | 'unread'>
  resumeAuthority(): ReturnType<typeof requireSpendActivationAuthority>
}

interface DecideArgs {
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
}

export interface CampaignRequest {
  readonly clientId: string
  readonly access: Access
  readonly kind: CampaignKind
  readonly campaignId: string
  readonly adAccountId: string
  readonly name: string
  readonly liveStatus: string
  readonly dailyBudget: string | null
  readonly objective: string | null
  readonly executionItemId: string | null
}

export interface ConfirmResult {
  readonly statusCode: number
  readonly reason: string
  readonly card: ConfirmationCardView | null
  readonly wroteMeta: boolean
}

const PAUSE = ADS_ACTION_TYPE.PAUSE_CAMPAIGN
const RESUME = ADS_ACTION_TYPE.REACTIVATE_CAMPAIGN

export async function requestCampaignStatusCard(
  sb: Sb,
  args: CampaignRequest,
  deps: CampaignDeps = defaultDeps(sb),
): Promise<{ status: number; body: Record<string, unknown> }> {
  const wanted = args.kind === 'pause' ? 'ACTIVE' : 'PAUSED'
  if (args.liveStatus !== wanted) {
    const reason = args.kind === 'pause' ? '系列已经不是在投，没有出暂停卡。' : '系列已经不是暂停，没有出恢复卡。'
    return { status: 422, body: { error: reason, wroteMeta: false } }
  }
  const open = await openHold(sb, args.clientId, args.kind, args.campaignId)
  if (open) return { status: 202, body: waitingBody(open.payload) }
  const card = await deps.issue(args.clientId, asker(args.access, args.clientId), facts(args))
  const payload = holdFrom(args, card)
  await insertHold(sb, args.clientId, payload)
  return { status: 202, body: waitingBody(payload) }
}

export async function confirmCampaignStatusCard(
  sb: Sb,
  args: DecideArgs,
  deps: CampaignDeps = defaultDeps(sb),
): Promise<ConfirmResult> {
  const row = await loadHold(sb, args.clientId, args.runId)
  if (!row) return stopped(404, '找不到这张确认卡，没有改广告。')
  if (row.payload.fingerprint !== args.fingerprint) return stopped(409, '你看到的内容已经不是这一张卡了。请刷新后再点。')
  if (row.payload.status === 'writing') return stopped(409, '上次写到一半，没有再自动写一次。')
  if (row.payload.status !== 'holding') return stopped(409, row.payload.resultLine ?? '这张卡已经有结果了，没有再改。')
  if (args.resolution === 'decline') return decline(sb, args, row, deps)
  if (row.payload.requestedBy === 'intraday-cap@internal') {
    const { intradayConfirmRefusal } = await import('@/lib/ads-strategy/intraday-spend/cap-proposal-run')
    const block = await intradayConfirmRefusal(sb, args.clientId, new Date(), 'pause')
    if (block) return stopped(409, block)
  }
  const bound = await resumePlan(sb, args.clientId, row.payload)
  if (!bound.ok) return stopped(409, bound.reason)
  const block = await guard(args.clientId, row.payload, deps)
  if (block) return stopped(409, block)
  const receipt = await resumeReceipt(args.clientId, row.payload, deps, bound.planId)
  if (receipt === 'denied') return stopped(403, '重新开启广告只有 PM 能确认，这次没有改。')
  const card = await deps.decide(args)
  if (card.status === 'expired' || card.status === 'voided' || card.status !== 'confirmed') {
    return closeUnconfirmed(sb, args.clientId, row, card)
  }
  if (!await claim(sb, args.clientId, row)) return stopped(409, '上次写到一半，没有再自动写一次。')
  return writeOnce(sb, args.clientId, row, card, receipt, deps)
}

function asker(access: Access, clientId: string): CardClicker {
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: false,
  })
  if (clicker.kind === 'opc' || clicker.kind === 'fde') return clicker
  if (clicker.kind === 'client_staff') return { kind: 'agent', email: clicker.email }
  throw new ConfirmationCardError('forbidden', '请先登录后再申请。')
}

function facts(args: CampaignRequest): CardFacts {
  const pause = args.kind === 'pause'
  return {
    subjectKey: `camp-${args.kind}:${canonicalHashOfInput({ kind: args.kind, campaignId: args.campaignId }).slice(0, 12)}`,
    what: pause ? CAMPAIGN_PAUSE_WHAT : CAMPAIGN_RESUME_WHAT,
    account: '已登记的广告账户',
    amount: pause ? '不改预算' : '恢复后才花钱',
    date: '确认之后才改',
    scope: pause ? '只暂停这一个广告系列' : '只恢复这一个广告系列',
    hardChecks: [{ label: '确认后才改', state: 'green', reason: '这一步只出卡，不会改广告' }],
  }
}

async function resumePlan(
  sb: Sb,
  clientId: string,
  hold: CampaignHold,
): Promise<{ ok: true; planId: string | null } | { ok: false; reason: string }> {
  if (hold.kind !== 'resume') return { ok: true, planId: null }
  const bound = await bindLaunchToApprovedPlan(sb, clientId, { mode: 'resume', campaignId: hold.campaign_id })
  if (!bound.ok) return bound
  return { ok: true, planId: bound.planId }
}

async function resumeReceipt(
  clientId: string,
  hold: CampaignHold,
  deps: CampaignDeps,
  planId: string | null,
): Promise<SpendActivationReceipt | null | 'denied'> {
  if (hold.kind !== 'resume') return null
  const authority = await deps.resumeAuthority()
  if (!authority.ok) return 'denied'
  return buildSpendActivationReceipt({
    authority,
    entry: 'meta-ads/execute',
    clientId,
    campaignId: hold.campaign_id,
    ...(planId ? { planId } : {}),
  })
}

async function guard(clientId: string, hold: CampaignHold, deps: CampaignDeps): Promise<string | null> {
  const live = await deps.live(clientId, hold.campaign_id)
  const messenger = hold.kind === 'resume' ? await deps.messenger(hold.campaign_id) : 'ok'
  if (!live || !sameAccount(live.accountId, hold.ad_account_id)) return '这条广告系列现在对不上这个客户，没有改。'
  const wanted = hold.kind === 'pause' ? 'ACTIVE' : 'PAUSED'
  if (live.status !== wanted) return hold.kind === 'pause' ? '系列已经不是在投，没有暂停。' : '系列已经不是暂停，没有恢复。'
  if (messenger === 'blocked') return MESSENGER_REACTIVATE_BLOCKED_MESSAGE
  if (messenger === 'unread') return MESSENGER_LOOKUP_FAILED_MESSAGE
  return null
}

async function decline(sb: Sb, args: DecideArgs, row: HoldRow, deps: CampaignDeps): Promise<ConfirmResult> {
  const card = await deps.decide(args)
  if (card.status === 'expired' || card.status === 'voided') return closeUnconfirmed(sb, args.clientId, row, card)
  await save(sb, args.clientId, row, { ...row.payload, status: 'declined', wrote: false, resultLine: '没有改广告。' }, null)
  return { statusCode: 200, reason: '没有改广告。', card, wroteMeta: false }
}

async function closeUnconfirmed(sb: Sb, clientId: string, row: HoldRow, card: ConfirmationCardView): Promise<ConfirmResult> {
  const reason = card.status === 'expired' || card.status === 'voided' ? card.statusLine : '这张卡没有确认成功，没有改广告。'
  await save(sb, clientId, row, { ...row.payload, status: 'failed', wrote: false, resultLine: reason }, null)
  return { statusCode: 200, reason, card, wroteMeta: false }
}

async function writeOnce(
  sb: Sb,
  clientId: string,
  row: HoldRow,
  card: ConfirmationCardView,
  receipt: SpendActivationReceipt | null,
  deps: CampaignDeps,
): Promise<ConfirmResult> {
  const target = row.payload.kind === 'pause' ? 'PAUSED' : 'ACTIVE'
  const prepared: CampaignHold = { ...row.payload, status: 'writing', wrote: false, authorization: receipt ?? undefined }
  await save(sb, clientId, row, prepared, null)
  const sent = await deps.write(clientId, row.payload.campaign_id, target).catch(() => false)
  const after = sent ? await deps.live(clientId, row.payload.campaign_id).catch(() => null) : null
  const ok = sent && after?.status === target
  const reason = ok ? (target === 'PAUSED' ? '已暂停，回读是暂停。' : '已恢复，回读是在投。') : '回读和要改的状态不一致，没有再写一次。'
  const next: CampaignHold = {
    ...prepared,
    status: ok ? 'executed' : 'failed',
    wrote: sent,
    after: { ...row.payload.before, status: after?.status ?? row.payload.before.status },
    resultLine: reason,
  }
  const metric = ok ? resolveAndLogAdsExpectedMetric({ objective: row.payload.objective }, 'meta-ads/execute') : null
  await save(sb, clientId, row, next, metric)
  return { statusCode: ok ? 200 : 502, reason, card, wroteMeta: sent }
}

function holdFrom(args: CampaignRequest, card: ConfirmationCardView): CampaignHold {
  const before = { status: args.liveStatus, name: args.name, daily_budget: args.dailyBudget }
  return {
    status: 'holding',
    kind: args.kind,
    cardRunId: card.runId,
    fingerprint: card.fingerprint,
    expectedDecisionId: card.expectedDecisionId,
    campaign_id: args.campaignId,
    ad_account_id: args.adAccountId,
    objective: args.objective,
    before,
    after: before,
    wrote: false,
    requestedBy: args.access.user.email ?? args.access.user.id,
    executionItemId: args.executionItemId,
  }
}

function waitingBody(payload: CampaignHold): Record<string, unknown> {
  return {
    success: false,
    status: 'awaiting_confirmation',
    wroteMeta: false,
    campaignId: payload.campaign_id,
    runId: payload.cardRunId,
    before: payload.before,
    after: payload.before,
    card: {
      runId: payload.cardRunId,
      expectedDecisionId: payload.expectedDecisionId,
      fingerprint: payload.fingerprint,
      what: payload.kind === 'pause' ? CAMPAIGN_PAUSE_WHAT : CAMPAIGN_RESUME_WHAT,
      statusLine: '还没人点确认。广告还没改。',
    },
  }
}

function sameAccount(left: string, right: string): boolean {
  const a = left.replace(/^act_/, '')
  const b = right.replace(/^act_/, '')
  return a.length > 0 && a === b
}

function stopped(statusCode: number, reason: string): ConfirmResult {
  return { statusCode, reason, card: null, wroteMeta: false }
}

function defaultDeps(sb: Sb): CampaignDeps {
  const kernel = createKernel(sb)
  return {
    issue: (clientId, clicker, cardFacts) => issueConfirmationCard(kernel, { clientId, clicker, facts: cardFacts }),
    decide: (args) => decideConfirmationCard(kernel, args),
    live: (clientId, campaignId) => readLive(clientId, campaignId),
    write: (clientId, campaignId, status) => writeStatus(clientId, campaignId, status),
    messenger: (campaignId) => messengerOf(sb, campaignId),
    resumeAuthority: requireSpendActivationAuthority,
  }
}

async function readLive(clientId: string, campaignId: string): Promise<LiveCampaign | null> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return null
  const owned = await assertCampaignOwnedByClient(campaignId, clientId, token)
  if (!owned.ok || !owned.campaign.account_id) return null
  return { status: owned.campaign.status, accountId: owned.campaign.account_id, name: owned.campaign.name }
}

async function writeStatus(clientId: string, campaignId: string, status: 'PAUSED' | 'ACTIVE'): Promise<boolean> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) return false
  return setCampaignStatus(campaignId, token, status)
}

async function messengerOf(sb: Sb, campaignId: string): Promise<'ok' | 'blocked' | 'unread'> {
  const check = await checkMessengerDraftCampaign(sb, campaignId)
  if (check === 'not_messenger_draft') return 'ok'
  if (check === 'is_messenger_draft') return 'blocked'
  return 'unread'
}

async function openHold(sb: Sb, clientId: string, kind: CampaignKind, campaignId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, [
    ['action_type', kind === 'pause' ? PAUSE : RESUME],
    ['payload->>campaign_id', campaignId],
    ['payload->>status', 'holding'],
  ])
  return rows.length === 1 ? rows[0] ?? null : null
}

async function loadHold(sb: Sb, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, [['payload->>cardRunId', runId]])
  const matched = rows.filter((row) => row.payload.cardRunId === runId)
  return matched.length === 1 ? matched[0] ?? null : null
}

async function insertHold(sb: Sb, clientId: string, payload: CampaignHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    execution_item_id: payload.executionItemId,
    flywheel: 'ads',
    action_type: payload.kind === 'pause' ? PAUSE : RESUME,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: null,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有改广告。')
}

async function claim(sb: Sb, clientId: string, row: HoldRow): Promise<boolean> {
  const next = { ...row.payload, status: 'writing' as const, wrote: false }
  const { data, error } = await sb.from('flywheel_actions')
    .update({ payload: next })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

async function save(sb: Sb, clientId: string, row: HoldRow, payload: CampaignHold, metric: string | null): Promise<void> {
  const patch: Record<string, unknown> = { payload, expected_metric: metric }
  if (payload.status === 'executed') patch.executed_at = new Date().toISOString()
  const { error } = await sb.from('flywheel_actions').update(patch).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再改一次广告。')
}

async function rowsWhere(sb: Sb, clientId: string, filters: Array<[string, string]>): Promise<HoldRow[]> {
  let query = sb.from('flywheel_actions').select('id, payload, action_type').eq('client_id', clientId).eq('flywheel', 'ads')
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query
  if (error) throw new ConfirmationCardError('invalid', '确认卡的台账读不出来，没有改广告。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown; action_type?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown; action_type?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  if (row.action_type !== PAUSE && row.action_type !== RESUME) return []
  const payload = row.payload as CampaignHold
  if (!payload.cardRunId || !payload.campaign_id || !payload.kind) return []
  return [{ id: row.id, payload }]
}
