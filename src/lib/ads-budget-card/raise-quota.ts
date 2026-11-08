/**
 * Re-judge a budget-card raise against the snapshot already required
 * before the provider write, plus other raises that snapshot does not show yet.
 * A cut does not use this. There is no in-process lock.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { budgetEntityKey, readKernelPreBudget, type KernelPreBudget } from '@/lib/capabilities/ads/envelope-facts'

type Db = KernelDeps['supabase']

export interface RaiseQuotaFacts {
  readonly accountLiveCents: number
  readonly accountCapCents: number
  readonly clientLiveCents: number
  readonly clientCapCents: number
  readonly siblingAccountCents: number
  readonly siblingClientCents: number
}

export interface RaiseWriteContext {
  readonly runId: string
  readonly accountId: string
  readonly level: 'adset' | 'campaign'
  readonly entityId: string
  readonly snapshottedAt: string | null
  readonly now?: Date
}

export function raiseQuotaBlock(before: number, after: number, facts: RaiseQuotaFacts): string | null {
  if (!Number.isSafeInteger(after) || after <= before) return null
  if (!safeCap(facts.accountCapCents) || !safeCap(facts.clientCapCents)) return '每日上限读不到，没有改。'
  if (!safeTotal(facts.accountLiveCents) || !safeTotal(facts.clientLiveCents)) {
    return '现在的每日预算合计读不到，没有改。'
  }
  const accountAfter = facts.accountLiveCents - before + after + facts.siblingAccountCents
  const clientAfter = facts.clientLiveCents - before + after + facts.siblingClientCents
  if (!Number.isSafeInteger(accountAfter) || !Number.isSafeInteger(clientAfter)) {
    return '现在的每日预算合计读不到，没有改。'
  }
  if (accountAfter > facts.accountCapCents && accountAfter > facts.accountLiveCents) {
    return '改完会超过这个广告账户的每日上限，没有改。'
  }
  if (clientAfter > facts.clientCapCents && clientAfter > facts.clientLiveCents) {
    return '改完会超过这位客户所有广告账户加在一起的每日上限，没有改。'
  }
  return null
}

export async function cardRaiseCapBlock(
  sb: Db,
  clientId: string,
  before: number,
  after: number,
  ctx: RaiseWriteContext,
): Promise<string | null> {
  if (after <= before) return null
  if (!ctx.snapshottedAt) return '执行前的预算快照读不到，没有改。'
  const loaded = await readKernelPreBudget(sb, clientId, ctx.accountId, ctx.level, ctx.entityId, before, ctx.now ?? new Date())
  if (!loaded.ok) return loaded.reason
  const sibling = await unreflectedRaises(sb, clientId, ctx, loaded.budget)
  if (!sibling.ok) return sibling.reason
  return raiseQuotaBlock(before, after, {
    accountLiveCents: loaded.budget.accountLiveCents,
    accountCapCents: loaded.budget.accountCapCents,
    clientLiveCents: loaded.budget.clientLiveCents,
    clientCapCents: loaded.budget.clientCapCents,
    siblingAccountCents: sibling.account,
    siblingClientCents: sibling.client,
  })
}

function safeCap(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function safeTotal(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

async function unreflectedRaises(
  sb: Db,
  clientId: string,
  ctx: RaiseWriteContext,
  budget: KernelPreBudget,
): Promise<{ ok: true; account: number; client: number } | { ok: false; reason: string }> {
  const running = await siblingRows(sb, clientId, 'running', null)
  if (!running.ok) return running
  const done = await siblingRows(sb, clientId, 'succeeded', budget.roundAt)
  if (!done.ok) return done
  return sumSiblings([...running.rows, ...done.rows], ctx, budget)
}

async function siblingRows(
  sb: Db,
  clientId: string,
  status: 'running' | 'succeeded',
  since: string | null,
): Promise<{ ok: true; rows: ReadonlyArray<Record<string, unknown>> } | { ok: false; reason: string }> {
  let query = sb.from('action_runs').select('id, status, input, updated_at')
    .eq('client_id', clientId)
    .eq('action_key', 'ads.scale_unit_budget')
    .eq('status', status)
  if (since) query = query.gte('updated_at', since)
  const { data, error } = await query.limit(100)
  if (error) return { ok: false, reason: '其它上调还没算清，没有改。' }
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : []
  if (rows.length >= 100) return { ok: false, reason: '其它上调还没算清，没有改。' }
  return { ok: true, rows }
}

function sumSiblings(
  rows: ReadonlyArray<Record<string, unknown>>,
  ctx: RaiseWriteContext,
  budget: KernelPreBudget,
): { ok: true; account: number; client: number } | { ok: false; reason: string } {
  let account = 0
  let client = 0
  for (const row of rows) {
    if (row.id === ctx.runId) continue
    const piece = oneSibling(row, ctx, budget)
    if (piece === 'bad') return { ok: false, reason: '其它上调还没算清，没有改。' }
    if (piece === 'skip') continue
    account += piece.account
    client += piece.client
    if (!Number.isSafeInteger(account) || !Number.isSafeInteger(client)) {
      return { ok: false, reason: '其它上调还没算清，没有改。' }
    }
  }
  return { ok: true, account, client }
}

function oneSibling(
  row: Record<string, unknown>,
  ctx: RaiseWriteContext,
  budget: KernelPreBudget,
): { account: number; client: number } | 'skip' | 'bad' {
  const input = asRecord(row.input)
  if (!input) return 'bad'
  const parsed = siblingMoney(input)
  if (parsed === 'bad') return 'bad'
  if (parsed === 'skip') return 'skip'
  if (parsed.level === ctx.level && parsed.entityId === ctx.entityId && sameAccount(parsed.accountId, ctx.accountId)) {
    return 'skip'
  }
  const minor = lookupMinor(budget.entityMinor, parsed.accountId, parsed.level, parsed.entityId)
  if (minor === undefined || minor === null) return 'bad'
  const counted = isCounted(budget.countedLive, parsed.accountId, parsed.level, parsed.entityId)
  const extra = extraCents(minor, parsed.before, parsed.after, counted)
  if (extra === 'bad') return 'bad'
  if (extra === 0) return 'skip'
  const onAccount = sameAccount(parsed.accountId, ctx.accountId) ? extra : 0
  return { account: onAccount, client: extra }
}

function siblingMoney(input: Record<string, unknown>): { accountId: string; level: 'adset' | 'campaign'; entityId: string; before: number; after: number } | 'skip' | 'bad' {
  const accountId = text(input.ad_account_id)
  const adsetId = text(input.adset_id)
  const before = input.before_cents
  const after = input.after_cents
  if (!accountId || !adsetId) return 'bad'
  if (typeof before !== 'number' || typeof after !== 'number' || !Number.isSafeInteger(before) || !Number.isSafeInteger(after)) {
    return 'bad'
  }
  if (before <= 0 || after <= before) return 'skip'
  const campaignId = text(input.campaign_id)
  if (campaignId) return { accountId, level: 'campaign', entityId: campaignId, before, after }
  return { accountId, level: 'adset', entityId: adsetId, before, after }
}

function extraCents(minor: number, before: number, after: number, counted: boolean): number | 'bad' {
  if (minor === after && counted) return 0
  if (minor === before && counted) return after - before
  if (minor === before && !counted) return after
  return 'bad'
}

function lookupMinor(
  map: ReadonlyMap<string, number | null>,
  accountId: string,
  level: string,
  entityId: string,
): number | null | undefined {
  for (const id of accountForms(accountId)) {
    const key = budgetEntityKey(id, level, entityId)
    if (map.has(key)) return map.get(key)
  }
  return undefined
}

function isCounted(keys: ReadonlySet<string>, accountId: string, level: string, entityId: string): boolean {
  return accountForms(accountId).some((id) => keys.has(budgetEntityKey(id, level, entityId)))
}

function accountForms(accountId: string): string[] {
  const digits = accountId.replace(/^act_/i, '')
  return [accountId, digits, `act_${digits}`]
}

function sameAccount(left: string, right: string): boolean {
  return left.replace(/^act_/i, '') === right.replace(/^act_/i, '')
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
