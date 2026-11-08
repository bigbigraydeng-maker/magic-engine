/**
 * 广告日预算 vs 上限 —— 纯函数。
 *
 * 规则（设计稿 §5.2-7 + Codex 对币种的意见）：
 *  - 按「账户」汇总本计划所有广告步骤的日预算，不是逐个步骤比；
 *  - 账户币种必须能确定（来自账户快照），缺失 → unknown，不猜；
 *  - 客户总上限（ad_strategy_configs.daily_budget_cap_cents）没有币种，只有当全部涉及账户
 *    币种一致时才与之比较，币种不一致或缺失 → unknown（不做换算）；
 *  - 账户级上限（client_meta_ad_accounts.daily_budget_cap_cents）按账户比，没设就不比这一层；
 *  - 传入 liveByAccount 时，比较的是「已在投日预算 + 本计划」。不传则仍只比本计划，并在 notes 里说明。
 *    传 null、或某个账户没有数 = 没读到，结论是 unknown，不能当成没有在花钱。
 *
 * 结论只有三种：ok / over / unknown。unknown 在检查清单里是灰色，花钱相关的硬门不能批准。
 */

import type { AdsStep, PromoSpec } from './spec'

export interface AccountCapFacts {
  ad_account_id: string
  /** 账户币种，如 'AUD'；读不到 = null */
  currency: string | null
  /** 账户级日上限（账户币种的分）；没设 = null */
  daily_cap_cents: number | null
  /** 这个账户是否属于该客户 */
  owned_by_client: boolean
}

export type BudgetVerdict = 'ok' | 'over' | 'unknown'

export interface BudgetCheck {
  verdict: BudgetVerdict
  /** 给人看的中文原因，每条一件事 */
  reasons: string[]
  /** 每个账户本计划的日预算合计（分） */
  per_account_cents: Record<string, number>
  /** 说明性备注：本检查没覆盖的口径 */
  notes: string[]
}

const NOTE_LIVE_BUDGET = '已在投放的广告预算暂未纳入本检查（口径待定），批准前请对照广告账户当前预算。'
const LIVE_UNREAD = '已在投的日预算没读到，不能当成没有在花钱'

/**
 * 已在投日预算，按广告账户、最小货币单位。
 * 不传这个参数 = 这次不把已在投算进去。传 null = 没读到。
 */
export type LiveSpendByAccount = Readonly<Record<string, number>> | null

/**
 * 传入的 steps 必须是「同一时间段内同时生效」的广告步骤——也就是同一个阶段的。
 * 阶段在时间上不重叠，所以按阶段检查；不能把后面阶段的预算算进前面阶段。
 */
export function checkAdsBudget(
  steps: readonly AdsStep[],
  accounts: readonly AccountCapFacts[],
  clientCapCents: number | null,
  liveByAccount?: LiveSpendByAccount,
): BudgetCheck {
  const perAccount: Record<string, number> = {}
  for (const s of steps) {
    perAccount[s.settings.ad_account_id] = (perAccount[s.settings.ad_account_id] ?? 0) + s.settings.daily_budget_cents
  }
  const reasons: string[] = []
  let over = false
  let unknown = false

  if (steps.length === 0) {
    return { verdict: 'ok', reasons: [], per_account_cents: {}, notes: [] }
  }

  const compared = totalsWithLive(perAccount, liveByAccount)
  if (!compared.ok) {
    reasons.push(LIVE_UNREAD)
    unknown = true
  }
  const totals = compared.ok ? compared.per : perAccount
  const byId = new Map(accounts.map(a => [a.ad_account_id, a]))
  for (const [accountId, total] of Object.entries(totals)) {
    const flags = accountOver(accountId, total, byId.get(accountId), compared.ok)
    reasons.push(...flags.reasons)
    if (flags.over) over = true
    if (flags.unknown) unknown = true
  }
  const client = clientOver(totals, byId, clientCapCents, compared.ok)
  reasons.push(...client.reasons)
  if (client.over) over = true
  if (client.unknown) unknown = true

  return {
    verdict: over ? 'over' : unknown ? 'unknown' : 'ok',
    reasons,
    per_account_cents: perAccount,
    notes: liveByAccount === undefined ? [NOTE_LIVE_BUDGET] : [],
  }
}

function totalsWithLive(
  perAccount: Record<string, number>,
  liveByAccount: LiveSpendByAccount | undefined,
): { ok: true; per: Record<string, number> } | { ok: false } {
  if (liveByAccount === undefined) return { ok: true, per: perAccount }
  if (liveByAccount === null) return { ok: false }
  const per: Record<string, number> = {}
  for (const [accountId, draft] of Object.entries(perAccount)) {
    const live = liveByAccount[accountId]
    if (live === undefined || !Number.isSafeInteger(live) || live < 0) return { ok: false }
    const sum = draft + live
    if (!Number.isSafeInteger(sum)) return { ok: false }
    per[accountId] = sum
  }
  return { ok: true, per }
}

function accountOver(
  accountId: string,
  total: number,
  acc: AccountCapFacts | undefined,
  liveIncluded: boolean,
): { reasons: string[]; over: boolean; unknown: boolean } {
  if (!acc || !acc.owned_by_client) {
    return { reasons: [`广告账户 ${accountId} 不属于这个客户，不能使用`], over: true, unknown: false }
  }
  const reasons: string[] = []
  let unknown = false
  if (!acc.currency) {
    reasons.push(`广告账户 ${accountId} 读不到币种，无法核对上限`)
    unknown = true
  }
  if (acc.daily_cap_cents !== null && total > acc.daily_cap_cents) {
    const what = liveIncluded ? '已在投日预算加这份草稿合计' : '本计划日预算合计'
    reasons.push(`广告账户 ${accountId} ${what} ${total} 分，超过该账户日上限 ${acc.daily_cap_cents} 分`)
    return { reasons, over: true, unknown }
  }
  return { reasons, over: false, unknown }
}

function clientOver(
  totals: Record<string, number>,
  byId: ReadonlyMap<string, AccountCapFacts>,
  clientCapCents: number | null,
  liveIncluded: boolean,
): { reasons: string[]; over: boolean; unknown: boolean } {
  if (clientCapCents === null) {
    return { reasons: ['客户的广告日预算总上限还没设置'], over: false, unknown: true }
  }
  const involved = Object.keys(totals).map(id => byId.get(id)).filter((a): a is AccountCapFacts => !!a)
  const currencies = new Set(involved.map(a => a.currency))
  if (currencies.has(null) || currencies.size !== 1) {
    return {
      reasons: ['涉及的广告账户币种缺失或不一致，客户总上限无法比较（不做币种换算）'],
      over: false,
      unknown: true,
    }
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0)
  if (sum > clientCapCents) {
    const what = liveIncluded ? '已在投日预算加这份草稿合计' : '本计划日预算合计'
    return { reasons: [`${what} ${sum} 分，超过客户日预算总上限 ${clientCapCents} 分`], over: true, unknown: false }
  }
  return { reasons: [], over: false, unknown: false }
}

/** Same per-phase cap check the promo save uses. Unknown is not a rejection. */
export function collectPhaseBudgetProblems(
  spec: PromoSpec,
  accounts: readonly AccountCapFacts[],
  clientCapCents: number | null,
): string[] {
  const problems: string[] = []
  for (const phase of spec.phases) {
    const steps = phase.steps.flatMap(step => (step.kind === 'ads_campaign' ? [step] : []))
    const result = checkAdsBudget(steps, accounts, clientCapCents)
    if (result.verdict !== 'over') continue
    for (const reason of result.reasons) problems.push(`${phase.name}：${reason}`)
  }
  return problems
}
