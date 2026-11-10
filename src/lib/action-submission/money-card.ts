/**
 * Money-moving ads requests issue an existing confirmation card.
 * Nothing in this file calls Meta. A caller may write only after
 * `confirmMoneyBudget` / `confirmMoneyPause` sees a confirmed, unexpired card.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import {
  assertMayClick,
  assertMayIssue,
  clickerFromSession,
  decideConfirmationCard,
  issueConfirmationCard,
  type CardClicker,
} from '@/lib/confirmation-card'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { confirmBlockReason, type HardCheck } from '@/lib/confirmation-card/facts'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import { isExpired, presentCard, readStoredCard } from '@/lib/confirmation-card/view'
import { budgetFacts, budgetSubject } from '@/lib/ads-budget-card/facts'
import { guardBudget } from '@/lib/ads-budget-card/guard'
import { raiseQuotaBlock } from '@/lib/ads-budget-card/raise-quota'
import type { BudgetOrder, BudgetSnapshot } from '@/lib/ads-budget-card/types'
import { guardPause, type LiveFacts } from '@/lib/ads-pause-card/guard'
import type { PauseAdSetOrder } from '@/lib/ads-pause-card/order'
import { PAUSE_AD_SET_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import { isSpendApproverEmail } from '@/lib/auth/whitelist'
import type { ClientAccessResult } from '@/lib/auth/client-access'

export const MONEY_ACTION = 'ads.money_card'

type Access = Extract<ClientAccessResult, { ok: true }>
type Db = KernelDeps['supabase']
type Lane = 'budget' | 'pause_adset'
type HoldStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'

export interface MoneyHold {
  kind: 'money_card'
  lane: Lane
  status: HoldStatus
  source: 'stop_loss' | 'scorecard_down' | 'scorecard_up' | 'opportunity' | 'auto_pause'
  cardRunId: string
  fingerprint: string
  expectedDecisionId: string
  subjectKey: string
  what: string
  level: 'adset' | 'campaign'
  entityId: string
  adAccountId: string
  campaignId: string | null
  scaleAdsetId: string | null
  name: string | null
  beforeCents: number
  afterCents: number
  snapshotAt: string | null
  raising: boolean
  goalId: string | null
  cycleDate: string | null
  requestId: string | null
  kernelRunId: string | null
  kernelDecisionId: string | null
  wroteMeta: boolean
  readbackCents: number | null
  resultLine?: string
}

export interface MoneyRow { readonly id: string; readonly payload: MoneyHold }

export interface MoneyWriteResult {
  readonly wroteMeta: boolean
  readonly queued?: boolean
  readonly readbackCents: number | null
  readonly reason: string
}

export interface MoneyIssueResult {
  readonly card: MoneyCardRef | null
  readonly reason: string | null
  readonly wroteMeta: false
}

export interface MoneyCardRef {
  readonly runId: string
  readonly expectedDecisionId: string
  readonly fingerprint: string
  readonly what: string
  readonly status: string
}

export interface MoneyConfirmResult {
  readonly handled: boolean
  readonly wroteMeta: boolean
  readonly reason: string
  readonly card: ConfirmationCardView | null
  readonly readbackCents: number | null
}

interface BudgetIssue {
  kernel: KernelDeps
  sb: Db
  clientId: string
  clicker: CardClicker
  source: MoneyHold['source']
  level: MoneyHold['level']
  entityId: string
  adAccountId: string
  campaignId: string | null
  scaleAdsetId: string | null
  name: string | null
  beforeCents: number
  afterCents: number
  snapshotAt: string | null
  goalId: string | null
  cycleDate: string | null
  requestId: string | null
  freshMs: number
  readLive: () => Promise<BudgetSnapshot>
  now?: Date
}

interface PauseIssue {
  kernel: KernelDeps
  sb: Db
  clientId: string
  clicker: CardClicker
  entityId: string
  adAccountId: string
  campaignId: string | null
  name: string | null
  kernelRunId: string
  kernelDecisionId: string
  readLive: () => Promise<LiveFacts>
  now?: Date
}

interface ConfirmArgs {
  kernel: KernelDeps
  sb: Db
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  now?: Date
  write: (hold: MoneyHold) => Promise<MoneyWriteResult>
}

export function clickerFromAccess(access: Access, clientId: string): CardClicker {
  return clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: false,
  })
}

export async function issueMoneyBudget(args: BudgetIssue): Promise<MoneyIssueResult> {
  assertMayIssue(args.clicker, args.clientId)
  const now = args.now ?? args.kernel.now()
  const live = await args.readLive().catch(() => null)
  if (!live) return quiet('预算事实读不到，没有出卡。')
  const early = earlyBudget(live)
  if (early) return quiet(early)
  const order = budgetOrder(args)
  const open = await openHold(args.sb, args.clientId, budgetSubject(order))
  if (open) return { card: refFrom(open.payload), reason: null, wroteMeta: false }
  const checks = await budgetChecks(args.sb, args.clientId, order, live, null, args.snapshotAt, now, null, args.freshMs)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: budgetFacts(order, live, checks),
    now,
  })
  await insertHold(args.sb, args.clientId, budgetHold(args, card, budgetSubject(order)))
  return { card: refFromCard(card), reason: confirmBlockReason(checks), wroteMeta: false }
}

export async function issueMoneyPause(args: PauseIssue): Promise<MoneyIssueResult> {
  assertMayIssue(args.clicker, args.clientId)
  const campaignId = args.campaignId
  if (!campaignId) return quiet('读不到这个组所属的系列，没有出卡。')
  const now = args.now ?? args.kernel.now()
  const subject = pauseSubject(args.entityId, args.adAccountId)
  const open = await openHold(args.sb, args.clientId, subject)
  if (open) return { card: refFrom(open.payload), reason: null, wroteMeta: false }
  const live = await args.readLive().catch(() => unreadablePause())
  const order = pauseOrder({ entityId: args.entityId, adAccountId: args.adAccountId, campaignId })
  const guard = guardPause(order, live, null)
  const checks = guard.checks.map(honestSource)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: pauseMoneyFacts(subject, checks),
    now,
  })
  await insertHold(args.sb, args.clientId, pauseHold(args, card, subject))
  return { card: refFromCard(card), reason: confirmBlockReason(checks), wroteMeta: false }
}

export async function confirmMoneyBudget(
  args: ConfirmArgs & { readLive: (hold: MoneyHold) => Promise<BudgetSnapshot>; freshMs: number },
): Promise<MoneyConfirmResult> {
  const row = await loadMoneyHold(args.sb, args.clientId, args.runId)
  if (!row || row.payload.lane !== 'budget') return { handled: false, wroteMeta: false, reason: '', card: null, readbackCents: null }
  return confirmHeld(args, row, async (hold) => {
    const live = await args.readLive(hold).catch(() => null)
    if (!live) return '预算事实读不到，没有改。'
    const now = args.now ?? args.kernel.now()
    return (await budgetChecks(
      args.sb, args.clientId, budgetOrder(hold), live, hold.beforeCents, hold.snapshotAt, now, hold.cardRunId, args.freshMs,
    ).then(confirmBlockReason))
  })
}

export async function confirmMoneyPause(
  args: ConfirmArgs & { readLive: (hold: MoneyHold) => Promise<LiveFacts> },
): Promise<MoneyConfirmResult> {
  const row = await loadMoneyHold(args.sb, args.clientId, args.runId)
  if (!row || row.payload.lane !== 'pause_adset') return { handled: false, wroteMeta: false, reason: '', card: null, readbackCents: null }
  return confirmHeld(args, row, async (hold) => {
    if (!hold.campaignId) return '读不到这个组所属的系列，没有暂停。'
    const live = await args.readLive(hold).catch(() => unreadablePause())
    const guard = guardPause(pauseOrder({ ...hold, campaignId: hold.campaignId }), live, null)
    return confirmBlockReason(guard.checks.map(honestSource))
  })
}

/** Execute only when the card is already confirmed and still inside its window. */
export async function executeConfirmedMoney(
  args: ConfirmArgs,
  row: MoneyRow,
): Promise<MoneyConfirmResult> {
  const now = args.now ?? args.kernel.now()
  const card = await confirmedView(args.kernel, args.clientId, row.payload.cardRunId, args.clicker, now)
  if (!card) return stopped(row, '这张卡还没确认，或已经过期，没有改。', null)
  if (raiseRefused(row.payload, args.clicker)) {
    return stopped(row, '加预算只有花钱批准人能确认，这次没有改。', null)
  }
  if (!await claimHold(args.sb, args.clientId, row)) return stopped(row, '上次写到一半，没有再写一次。', null)
  try {
    const result = await args.write(row.payload)
    await saveHold(args.sb, args.clientId, row, finishPayload(row.payload, result))
    return { handled: true, wroteMeta: result.wroteMeta, reason: result.reason, card, readbackCents: result.readbackCents }
  } catch {
    await saveHold(args.sb, args.clientId, row, {
      ...row.payload, status: 'failed', wroteMeta: false, resultLine: '写到一半停了，没有再写一次。',
    }).catch(() => undefined)
    return stopped(row, '写到一半停了，没有再写一次。', card)
  }
}

async function confirmHeld(
  args: ConfirmArgs,
  row: MoneyRow,
  recheck: (hold: MoneyHold) => Promise<string | null>,
): Promise<MoneyConfirmResult> {
  assertMayClick(args.clicker, args.clientId)
  if (row.payload.fingerprint !== args.fingerprint) return stopped(row, '你看到的内容已经不是这一张卡了。请刷新后再点。', null)
  if (row.payload.status === 'writing') return stopped(row, '上次写到一半，没有再写一次。', null)
  if (row.payload.status !== 'holding') return stopped(row, row.payload.resultLine ?? '这张卡已经有结果了，没有改。', null)
  if (args.resolution === 'decline') return decline(args, row)
  const block = await recheck(row.payload)
  if (block) return stopped(row, block, null)
  if (raiseRefused(row.payload, args.clicker)) {
    return stopped(row, '加预算只有花钱批准人能确认，这次没有改。', null)
  }
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args)).catch((error: unknown) => {
    if (error instanceof ConfirmationCardError) return error
    throw error
  })
  if (card instanceof ConfirmationCardError) return stopped(row, card.message, null)
  if (card.status !== 'confirmed') return stopped(row, card.statusLine, card)
  return executeConfirmedMoney(args, row)
}

async function decline(args: ConfirmArgs, row: MoneyRow): Promise<MoneyConfirmResult> {
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args)).catch(() => null)
  const payload: MoneyHold = { ...row.payload, status: 'declined', wroteMeta: false, resultLine: '没有改。' }
  await saveHold(args.sb, args.clientId, row, payload)
  return { handled: true, wroteMeta: false, reason: '没有改。', card, readbackCents: null }
}

async function confirmedView(
  kernel: KernelDeps,
  clientId: string,
  runId: string,
  clicker: CardClicker,
  now: Date,
): Promise<ConfirmationCardView | null> {
  const run = await kernel.requireRun(runId).catch(() => null)
  if (!run || run.client_id !== clientId) return null
  const stored = readStoredCard(run.input)
  if (!stored || !run.authorization_decision_id) return null
  if (run.status !== 'succeeded' && run.status !== 'authorized') return null
  if (isExpired(stored.issuedAt, now, stored.lifetime)) return null
  const view = presentCard({
    run,
    decisionId: run.authorization_decision_id,
    decisionReason: '',
    decidedBy: null,
    clicker,
    now,
  })
  return view.status === 'confirmed' ? view : null
}

function decisionArgs(args: ConfirmArgs) {
  return {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
    now: args.now,
  }
}

async function budgetChecks(
  sb: Db,
  clientId: string,
  order: BudgetOrder,
  live: BudgetSnapshot,
  shownCents: number | null,
  snapshotAt: string | null,
  now: Date,
  exceptCard: string | null,
  freshMs: number,
): Promise<HardCheck[]> {
  const guard = guardBudget(order, live, shownCents)
  const pending = await pendingRaiseCents(sb, clientId, exceptCard, order.adAccountId)
  const raise = order.newDailyBudgetCents > (live.currentCents ?? order.newDailyBudgetCents)
    ? raiseCheck(order, live, pending)
    : null
  return [...guard.checks, ageCheck(snapshotAt, now, freshMs), ...(raise ? [raise] : [])]
}

function raiseCheck(order: BudgetOrder, live: BudgetSnapshot, pending: { account: number; client: number } | null): HardCheck {
  if (!pending) return { label: '同时在改的预算', state: 'unread', reason: '其它还没写完的加预算读不到' }
  const before = live.currentCents ?? 0
  const block = quota(before, order.newDailyBudgetCents, live, pending)
  return block
    ? { label: '同时在改的预算', state: 'red', reason: block }
    : { label: '同时在改的预算', state: 'green', reason: '加上还没写完的加预算也没有超过每日上限' }
}

function quota(
  before: number,
  after: number,
  live: BudgetSnapshot,
  pending: { account: number; client: number },
): string | null {
  if (!Number.isSafeInteger(live.accountLiveCents) || !Number.isSafeInteger(live.accountCapCents)) return '每日上限读不到，没有改。'
  if (!Number.isSafeInteger(live.otherAccountsLiveCents) || !Number.isSafeInteger(live.clientCapCents)) return '每日上限读不到，没有改。'
  const accountLive = live.accountLiveCents as number
  const clientLive = accountLive + (live.otherAccountsLiveCents as number)
  return raiseQuotaBlock(before, after, {
    accountLiveCents: accountLive,
    accountCapCents: live.accountCapCents as number,
    clientLiveCents: clientLive,
    clientCapCents: live.clientCapCents as number,
    siblingAccountCents: pending.account,
    siblingClientCents: pending.client,
  })
}

function ageCheck(snapshotAt: string | null, now: Date, freshMs: number): HardCheck {
  const at = snapshotAt ? Date.parse(snapshotAt) : Number.NaN
  if (!Number.isFinite(at)) return { label: '快照还新', state: 'unread', reason: '预算快照时间读不到' }
  const age = now.getTime() - at
  if (!Number.isSafeInteger(freshMs) || freshMs <= 0 || age < 0 || age > freshMs) {
    return { label: '快照还新', state: 'red', reason: '预算快照过期，没有改。' }
  }
  return { label: '快照还新', state: 'green', reason: '快照还在一天以内' }
}

function earlyBudget(live: BudgetSnapshot): string | null {
  if (live.stepRatio === 'unreadable') return '允许的调整幅度读不到，没有出卡。'
  if (live.stepRatio === 'off') return '这个客户关掉了调整日预算的确认卡。'
  if (live.stepRatio === 'invalid') return '这个客户允许的调整幅度设置无效，没有出卡。'
  if (!Number.isSafeInteger(live.currentCents) || (live.currentCents ?? 0) <= 0) return '现日预算读不到，没有按 0 出卡。'
  return null
}

function budgetOrder(input: {
  entityId: string
  adAccountId: string
  name: string | null
  beforeCents: number
  afterCents: number
}): BudgetOrder {
  return {
    prescriptionId: input.entityId,
    adsetId: input.entityId,
    adAccountId: input.adAccountId,
    newDailyBudgetCents: input.afterCents,
    name: input.name,
    expectedMetric: 'ads.account.spend',
    direction: input.afterCents > input.beforeCents ? 'up' : 'down',
    observationWindowDays: 7,
  }
}

function budgetHold(args: BudgetIssue, card: ConfirmationCardView, subject: string): MoneyHold {
  return baseHold({
    lane: 'budget',
    source: args.source,
    card,
    subject,
    what: card.what,
    level: args.level,
    entityId: args.entityId,
    adAccountId: args.adAccountId,
    campaignId: args.campaignId,
    scaleAdsetId: args.scaleAdsetId,
    name: args.name,
    beforeCents: args.beforeCents,
    afterCents: args.afterCents,
    snapshotAt: args.snapshotAt,
    raising: args.afterCents > args.beforeCents,
    goalId: args.goalId,
    cycleDate: args.cycleDate,
    requestId: args.requestId,
    kernelRunId: null,
    kernelDecisionId: null,
  })
}

function pauseHold(args: PauseIssue, card: ConfirmationCardView, subject: string): MoneyHold {
  return baseHold({
    lane: 'pause_adset',
    source: 'auto_pause',
    card,
    subject,
    what: PAUSE_AD_SET_WHAT,
    level: 'adset',
    entityId: args.entityId,
    adAccountId: args.adAccountId,
    campaignId: args.campaignId,
    scaleAdsetId: null,
    name: args.name,
    beforeCents: 0,
    afterCents: 0,
    snapshotAt: null,
    raising: false,
    goalId: null,
    cycleDate: null,
    requestId: null,
    kernelRunId: args.kernelRunId,
    kernelDecisionId: args.kernelDecisionId,
  })
}

function baseHold(input: Omit<MoneyHold, 'kind' | 'status' | 'cardRunId' | 'fingerprint' | 'expectedDecisionId' | 'subjectKey' | 'wroteMeta' | 'readbackCents'> & { card: ConfirmationCardView; subject: string }): MoneyHold {
  return {
    kind: 'money_card',
    lane: input.lane,
    status: 'holding',
    source: input.source,
    cardRunId: input.card.runId,
    fingerprint: input.card.fingerprint,
    expectedDecisionId: input.card.expectedDecisionId,
    subjectKey: input.subject,
    what: input.what,
    level: input.level,
    entityId: input.entityId,
    adAccountId: input.adAccountId,
    campaignId: input.campaignId,
    scaleAdsetId: input.scaleAdsetId,
    name: input.name,
    beforeCents: input.beforeCents,
    afterCents: input.afterCents,
    snapshotAt: input.snapshotAt,
    raising: input.raising,
    goalId: input.goalId,
    cycleDate: input.cycleDate,
    requestId: input.requestId,
    kernelRunId: input.kernelRunId,
    kernelDecisionId: input.kernelDecisionId,
    wroteMeta: false,
    readbackCents: null,
  }
}

function pauseOrder(input: { entityId: string; adAccountId: string; campaignId: string }): PauseAdSetOrder {
  return {
    prescriptionId: input.entityId,
    version: 1,
    adAccountId: input.adAccountId,
    campaignId: input.campaignId,
    adsetId: input.entityId,
    metric: 'ads.account.spend',
    direction: 'pause',
    observationDays: 7,
    basis: '确认之后才暂停',
  }
}

function pauseMoneyFacts(subject: string, checks: readonly HardCheck[]) {
  return {
    subjectKey: subject,
    what: PAUSE_AD_SET_WHAT,
    account: '已登记的广告账户',
    amount: '不改预算',
    date: '确认之后才暂停',
    scope: '只暂停这一个广告组，不开启，不改预算',
    hardChecks: checks,
  }
}

function pauseSubject(entityId: string, adAccountId: string): string {
  return `pause-set:${canonicalHashOfInput({ entityId, adAccountId }).slice(0, 12)}`
}

function honestSource(check: HardCheck): HardCheck {
  if (check.label !== '来源仍批准') return check
  return { label: '来源仍批准', state: 'green', reason: '这是暂停建议，确认后才暂停' }
}

function unreadablePause(): LiveFacts {
  return { registeredAccountIds: null, target: null, campaignAdSets: null }
}

function finishPayload(prev: MoneyHold, result: MoneyWriteResult): MoneyHold {
  return {
    ...prev,
    status: result.wroteMeta || result.queued ? 'executed' : 'failed',
    wroteMeta: result.wroteMeta,
    readbackCents: result.readbackCents,
    resultLine: result.reason,
  }
}

function raiseRefused(hold: MoneyHold, clicker: CardClicker): boolean {
  return hold.raising && (clicker.kind !== 'opc' || !isSpendApproverEmail(emailOf(clicker)))
}

function quiet(reason: string): MoneyIssueResult {
  return { card: null, reason, wroteMeta: false }
}

function refFromCard(card: ConfirmationCardView): MoneyCardRef {
  return { runId: card.runId, expectedDecisionId: card.expectedDecisionId, fingerprint: card.fingerprint, what: card.what, status: card.status }
}

function refFrom(hold: MoneyHold): MoneyCardRef {
  return { runId: hold.cardRunId, expectedDecisionId: hold.expectedDecisionId, fingerprint: hold.fingerprint, what: hold.what, status: 'waiting' }
}

function stopped(row: MoneyRow, reason: string, card: ConfirmationCardView | null): MoneyConfirmResult {
  void row
  return { handled: true, wroteMeta: false, reason, card, readbackCents: null }
}

function emailOf(clicker: CardClicker): string {
  if (clicker.kind === 'opc' || clicker.kind === 'fde') return clicker.email
  return ''
}

export async function loadMoneyHold(sb: Db, clientId: string, runId: string): Promise<MoneyRow | null> {
  const { data, error } = await sb.from('flywheel_actions').select('id, payload')
    .eq('client_id', clientId).eq('action_type', MONEY_ACTION).eq('payload->>cardRunId', runId)
  if (error) throw new ConfirmationCardError('invalid', '确认卡的台账读不出来，没有改。')
  const rows = ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asMoney)
  return rows.length === 1 ? rows[0] ?? null : null
}

async function openHold(sb: Db, clientId: string, subject: string): Promise<MoneyRow | null> {
  const { data, error } = await sb.from('flywheel_actions').select('id, payload')
    .eq('client_id', clientId).eq('action_type', MONEY_ACTION)
    .eq('payload->>subjectKey', subject).eq('payload->>status', 'holding')
  if (error) throw new ConfirmationCardError('invalid', '确认卡的台账读不出来，没有出卡。')
  const rows = ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asMoney)
  return rows.length === 1 ? rows[0] ?? null : null
}

async function pendingRaiseCents(
  sb: Db,
  clientId: string,
  exceptCard: string | null,
  accountId: string,
): Promise<{ account: number; client: number } | null> {
  const { data, error } = await sb.from('flywheel_actions').select('payload')
    .eq('client_id', clientId).eq('action_type', MONEY_ACTION).eq('payload->>status', 'holding')
  if (error) return null
  let account = 0
  let client = 0
  for (const row of (data ?? []) as Array<{ payload?: unknown }>) {
    const hold = asMoney({ id: 'x', payload: row.payload })[0]?.payload
    if (!hold || !hold.raising || hold.cardRunId === exceptCard) continue
    const delta = hold.afterCents - hold.beforeCents
    if (!Number.isSafeInteger(delta) || delta <= 0) return null
    if (hold.adAccountId === accountId) account += delta
    client += delta
    if (!Number.isSafeInteger(account) || !Number.isSafeInteger(client)) return null
  }
  return { account, client }
}

async function insertHold(sb: Db, clientId: string, payload: MoneyHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: MONEY_ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: null,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有改。')
}

async function claimHold(sb: Db, clientId: string, row: MoneyRow): Promise<boolean> {
  const next: MoneyHold = { ...row.payload, status: 'writing', wroteMeta: false }
  const { data, error } = await sb.from('flywheel_actions').update({ payload: next })
    .eq('id', row.id).eq('client_id', clientId).eq('payload->>status', 'holding').select('id').maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

async function saveHold(sb: Db, clientId: string, row: MoneyRow, payload: MoneyHold): Promise<void> {
  const patch: Record<string, unknown> = { payload }
  if (payload.status === 'executed') patch.executed_at = new Date().toISOString()
  const { error } = await sb.from('flywheel_actions').update(patch).eq('id', row.id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再改一次。')
}

function asMoney(row: { id?: unknown; payload?: unknown }): MoneyRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as MoneyHold
  if (payload.kind !== 'money_card' || !payload.cardRunId || !payload.lane) return []
  return [{ id: row.id, payload }]
}
