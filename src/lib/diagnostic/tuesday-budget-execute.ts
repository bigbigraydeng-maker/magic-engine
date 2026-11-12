/**
 * Tuesday supervision issues the same budget-step hold other cards use.
 * The card lasts until 23:59 Pacific/Auckland on the issue day, like other
 * daily auto-job cards. Issuing does not write a budget.
 * Confirm goes through submitBudgetCard.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { isUuid } from '@/lib/validation-utils'
import { readPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { budgetFacts, budgetOrderKey } from '@/lib/ads-budget-card/facts'
import { guardBudget } from '@/lib/ads-budget-card/guard'
import { insertHold, retireStale, type BudgetHold } from '@/lib/ads-budget-card/ledger'
import { budgetStepIdempotencyKey } from '@/lib/ads-budget-card/path'
import { prescriptionLockSource, type VersionLockSource } from '@/lib/ads-budget-card/prescription-lock'
import type { BudgetOrder, BudgetSnapshot, MetricDirection } from '@/lib/ads-budget-card/types'
import { clipName } from '@/lib/ads-budget-card/copy'
import type { HardCheck } from '@/lib/confirmation-card/facts'
import {
  boundedBudgetAfter,
  budgetIntent,
  normalAdAccount,
  numericAdset,
} from './tuesday-budget-amount'
import { loadSupervisionStates, loadTuesdaySnapshot } from './tuesday-budget-live'
import type { WeeklyBudgetSuggestion } from './prescription-weekly-check'

export const TUESDAY_SUBJECT_PREFIX = 'tuesday-budget:'

export interface TuesdayPorts {
  locks: VersionLockSource
  readLive(clientId: string, order: BudgetOrder): Promise<BudgetSnapshot | { blocked: string }>
}

export interface TuesdayIssueResult {
  readonly clientId: string
  readonly issued: boolean
  readonly executed: false
  readonly reason: string
  readonly runId: string | null
  readonly fingerprint: string | null
}

const WINDOW_DAYS = 7
const AGENT = { kind: 'agent' as const, email: null }

export function productionTuesdayPorts(sb: SupabaseClient, now: Date): TuesdayPorts {
  return {
    locks: prescriptionLockSource(sb),
    readLive: (clientId, order) => loadTuesdaySnapshot(sb, clientId, order, now),
  }
}

export function tuesdaySubject(direction: 'increase' | 'decrease', adsetId: string, accountId: string): string {
  const hex = createHash('sha256').update(`${direction}|${adsetId}|${accountId}`).digest('hex').slice(0, 12)
  return `${TUESDAY_SUBJECT_PREFIX}${hex}`
}

export async function issueTuesdayBudgetTunes(
  deps: KernelDeps,
  proposals: readonly WeeklyBudgetSuggestion[],
  ports: TuesdayPorts,
  now?: Date,
): Promise<TuesdayIssueResult[]> {
  const out: TuesdayIssueResult[] = []
  for (const proposal of proposals) {
    const clash = clashing(proposals, proposal)
    out.push(clash ? skipped(proposal.clientId, clash) : await issueOne(deps, proposal, ports, now))
  }
  return out
}

export async function tuesdayConfirmRefusal(
  sb: SupabaseClient,
  clientId: string,
  hold: BudgetHold,
  live: BudgetSnapshot,
  now: Date,
): Promise<string | null> {
  if (live.status !== 'ACTIVE') return '这一组现在不是在投，没有改。'
  const states = await loadSupervisionStates(sb, [clientId], now)
  if ('error' in states) return states.error
  const intent = budgetIntent(states.filter((row) => row.clientId === clientId), now)
  const raising = hold.afterCents > hold.beforeCents
  const direction = raising ? 'increase' : 'decrease'
  if (intent.kind !== 'need' || intent.unitId !== hold.order.adsetId || intent.direction !== direction) {
    return '这周的加减预算条件已经不成立，没有改。'
  }
  return amountStillMatches(hold, live, direction)
}

async function issueOne(
  deps: KernelDeps,
  proposal: WeeklyBudgetSuggestion,
  ports: TuesdayPorts,
  now?: Date,
): Promise<TuesdayIssueResult> {
  const order = orderFrom(proposal)
  if ('skip' in order) return skipped(proposal.clientId, order.skip)
  const locked = await ports.locks.read(proposal.clientId, order.prescriptionId)
  if (!locked.ok) return skipped(proposal.clientId, locked.reason)
  const read = await ports.readLive(proposal.clientId, order)
  if ('blocked' in read) return skipped(proposal.clientId, read.blocked)
  const live = await capFromPlan(deps.supabase, proposal.clientId, locked.lock.planId, read)
  if (live.status !== 'ACTIVE') return skipped(proposal.clientId, '这一组现在不是在投，这次不出卡。')
  const guard = guardBudget(order, live, null)
  if (guard.block) return skipped(proposal.clientId, guard.block)
  const key = budgetStepIdempotencyKey(proposal.clientId, order, live.currentCents as number, locked.lock)
  if (!key) return skipped(proposal.clientId, '这张卡算不出幂等键，没有出卡。')
  return publish(deps, proposal, order, live, locked.lock, key, guard.checks, now)
}

async function publish(
  deps: KernelDeps,
  proposal: WeeklyBudgetSuggestion,
  order: BudgetOrder,
  live: BudgetSnapshot,
  lock: BudgetHold['lock'],
  key: string,
  checks: readonly HardCheck[],
  now?: Date,
): Promise<TuesdayIssueResult> {
  const subjectKey = tuesdaySubject(proposal.direction, order.adsetId, order.adAccountId)
  const facts = { ...budgetFacts(order, { ...live, name: safeFace(live.name) }, checks), subjectKey }
  try {
    const card = await issueConfirmationCard(deps, {
      clientId: proposal.clientId,
      clicker: AGENT,
      facts,
      now: now ?? deps.now(),
      lifetime: 'nz_day',
    })
    await retireStale(deps.supabase, proposal.clientId, subjectKey, card.fingerprint)
    await insertHold(deps.supabase, proposal.clientId, holdOf(order, live, lock, key, card.runId, card.fingerprint, subjectKey))
    return {
      clientId: proposal.clientId,
      issued: true,
      executed: false,
      reason: '已出确认卡，确认之后才改。',
      runId: card.runId,
      fingerprint: card.fingerprint,
    }
  } catch (error) {
    const reason = error instanceof ConfirmationCardError ? error.humanReason : '没有出卡，也没有改预算。'
    return skipped(proposal.clientId, reason)
  }
}

function amountStillMatches(
  hold: BudgetHold,
  live: BudgetSnapshot,
  direction: 'increase' | 'decrease',
): string | null {
  if (typeof live.stepRatio !== 'number') return '允许的调整幅度读不到，没有改。'
  if (!Number.isSafeInteger(live.currentCents) || (live.currentCents ?? 0) <= 0) return '现日预算读不到，没有改。'
  const bounded = boundedBudgetAfter(direction, live.currentCents as number, remainingOf(live), live.stepRatio)
  if ('blocked' in bounded) return bounded.blocked
  if (bounded.after !== hold.afterCents) return '按现在的额度重算，金额和卡上的不一样，没有改。'
  return null
}

function remainingOf(live: BudgetSnapshot): number | null {
  const accountCap = live.accountCapCents
  const accountLive = live.accountLiveCents
  const clientCap = live.clientCapCents
  const other = live.otherAccountsLiveCents
  if (!Number.isSafeInteger(accountCap) || !Number.isSafeInteger(accountLive)) return null
  if (!Number.isSafeInteger(clientCap) || !Number.isSafeInteger(other)) return null
  const accountRemaining = (accountCap as number) - (accountLive as number)
  const clientRemaining = (clientCap as number) - (accountLive as number) - (other as number)
  if (!Number.isSafeInteger(accountRemaining) || !Number.isSafeInteger(clientRemaining)) return null
  return Math.min(accountRemaining, clientRemaining)
}

function orderFrom(proposal: WeeklyBudgetSuggestion): BudgetOrder | { skip: string } {
  if (!isUuid(proposal.clientId) || !isUuid(proposal.prescriptionId)) return { skip: '客户或方案编号不对，没有出卡。' }
  if (!numericAdset(proposal.adsetId)) return { skip: '巡检没有说清是哪一组，这次不出卡。' }
  const accountId = normalAdAccount(proposal.adAccountId)
  if (!accountId) return { skip: '广告账户对不上这位客户，这次不出卡。' }
  const amounts = cleanAmounts(proposal)
  if ('skip' in amounts) return amounts
  return {
    prescriptionId: proposal.prescriptionId,
    adsetId: proposal.adsetId,
    adAccountId: accountId,
    newDailyBudgetCents: amounts.after,
    name: safeFace(proposal.name),
    expectedMetric: 'ads.account.spend',
    direction: amounts.direction,
    observationWindowDays: WINDOW_DAYS,
  }
}

function cleanAmounts(
  proposal: WeeklyBudgetSuggestion,
): { before: number; after: number; direction: MetricDirection } | { skip: string } {
  const before = proposal.beforeCents
  const after = proposal.afterCents
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before <= 0 || after <= 0) {
    return { skip: '金额读不到，没有出卡，也没有把金额填成 0。' }
  }
  if (after === before) return { skip: '金额没有变化，没有出卡，也没有改预算。' }
  if (proposal.direction === 'increase' && after < before) return { skip: '说是加预算，金额却更少，没有出卡。' }
  if (proposal.direction === 'decrease' && after > before) return { skip: '说是减预算，金额却更多，没有出卡。' }
  return { before, after, direction: proposal.direction === 'increase' ? 'up' : 'down' }
}

function holdOf(
  order: BudgetOrder,
  live: BudgetSnapshot,
  lock: BudgetHold['lock'],
  idempotencyKey: string,
  runId: string,
  fingerprint: string,
  subjectKey: string,
): BudgetHold {
  return {
    kind: 'adset_daily_budget',
    status: 'holding',
    cardRunId: runId,
    subjectKey,
    fingerprint,
    orderKey: budgetOrderKey(order),
    order,
    lock,
    idempotencyKey,
    beforeCents: live.currentCents as number,
    afterCents: order.newDailyBudgetCents,
    direction: order.direction,
    observationWindowDays: WINDOW_DAYS,
    confirmedBy: null,
    actionRunId: null,
    readbackCents: null,
    readbackMatched: null,
    writeAttempted: false,
    wroteMeta: false,
  }
}

async function capFromPlan(
  sb: SupabaseClient,
  clientId: string,
  planId: string,
  live: BudgetSnapshot,
): Promise<BudgetSnapshot> {
  const cap = await readPlanDailyTotalCap(sb, clientId, planId).catch(() => null)
  return { ...live, clientCapCents: cap && cap.ok ? cap.cents : null }
}

function clashing(rows: readonly WeeklyBudgetSuggestion[], row: WeeklyBudgetSuggestion): string | null {
  const same = rows.filter((item) => item.clientId === row.clientId)
  if (same.length <= 1) return null
  return '有不止一处要调，这次先不出卡。'
}

function safeFace(name: string | null): string | null {
  const text = clipName(name)
  if (text === '这一组' || /act_/i.test(text) || /\d{10,}/.test(text)) return null
  return text
}

function skipped(clientId: string, reason: string): TuesdayIssueResult {
  return { clientId, issued: false, executed: false, reason, runId: null, fingerprint: null }
}
