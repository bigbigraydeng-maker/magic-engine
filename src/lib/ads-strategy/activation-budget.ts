/**
 * 开启一条暂停的私信广告之前，先算一笔账：这个客户所有广告账户当前在投的
 * 每日预算合计，加上这条草案的每日预算，会不会超过客户的每日总上限。
 *
 * 纯函数，不联网、不读数据库。读 Meta 数据的事别的模块做，这里只做判定。
 * 金额一律用整数「分」（最小货币单位），避免浮点误差。
 *
 * 只看**配置状态**（status），不看 effective_status：审核中的对象配置状态
 * 也是 ACTIVE，会被算进去 —— 这是故意的偏保守。
 */

export const ALLOWED_BUDGET_CURRENCIES: readonly string[] = ['NZD', 'AUD', 'USD']

export interface BudgetCampaignFact {
  id: string
  accountId: string
  status: string
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
}

export interface BudgetAdSetFact {
  id: string
  accountId: string
  campaignId: string
  status: string
  dailyBudgetCents: number | null
  lifetimeBudgetCents: number | null
}

export interface BudgetAccountFact {
  accountId: string
  currency: string | null
  complete: boolean
  capCents: number | null
  campaigns: readonly BudgetCampaignFact[]
  adSets: readonly BudgetAdSetFact[]
}

export interface ActivationBudgetInput {
  mode: 'pre' | 'post'
  clientCapCents: number | null
  capSnapshotCents: number
  registeredAccountIds: readonly string[]
  accounts: readonly BudgetAccountFact[]
  draft: {
    accountId: string
    campaignId: string
    adSetId: string
    dailyBudgetCents: number
    currency: string
  }
}

export type ActivationBudgetCode = 'budget_unavailable' | 'budget_cap_exceeded'

export type ActivationBudgetResult =
  | { ok: true; totalCents: number; draftCents: number; capCents: number; currency: string }
  | {
      ok: false
      code: ActivationBudgetCode
      message: string
      totalCents?: number
      draftCents?: number
      capCents?: number
    }

const isPositiveInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0

const isPositiveAmount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0

const upper = (s: string): string => s.trim().toUpperCase()

const isActive = (status: string): boolean => upper(status) === 'ACTIVE'

/** 分 → 「NZD 115.00」这种给人看的字符串。 */
function formatMoney(cents: number, currency: string): string {
  return `${upper(currency)} ${(cents / 100).toFixed(2)}`
}

function fail(
  code: ActivationBudgetCode,
  message: string,
  extra?: { totalCents?: number; draftCents?: number; capCents?: number },
): ActivationBudgetResult {
  return { ok: false, code, message, ...extra }
}

/** A. 输入合法性。任何一条不满足就返回失败，否则返回 null。 */
function validateInput(input: ActivationBudgetInput): ActivationBudgetResult | null {
  const { draft, registeredAccountIds, accounts } = input

  if (!isPositiveInt(draft.dailyBudgetCents)) {
    return fail('budget_unavailable', '这条广告的每日预算读不到或不是正整数，无法检查预算。')
  }
  const draftCurrency = upper(draft.currency)
  if (!ALLOWED_BUDGET_CURRENCIES.includes(draftCurrency)) {
    return fail('budget_unavailable', `这个币种（${draft.currency || '读不到'}）暂不支持自动检查预算。`)
  }
  if (!isPositiveInt(input.capSnapshotCents)) {
    return fail('budget_unavailable', '授权人批准时看到的上限快照读不到，无法检查预算。')
  }
  if (!isPositiveInt(input.clientCapCents)) {
    return fail(
      'budget_unavailable',
      '这个客户还没设每日总预算上限，请先到 广告健康 → 自治设置 填上。',
    )
  }
  if (registeredAccountIds.length === 0) {
    return fail('budget_unavailable', '这个客户没有登记任何广告账户，无法检查预算。')
  }
  if (!registeredAccountIds.includes(draft.accountId)) {
    return fail('budget_unavailable', `这条广告所属账户（${draft.accountId}）不在客户登记的账户里。`)
  }

  for (const accountId of registeredAccountIds) {
    const acct = accounts.find((a) => a.accountId === accountId)
    if (!acct) {
      return fail('budget_unavailable', `读不到广告账户 ${accountId} 的数据，无法检查预算。`)
    }
    if (!acct.complete) {
      return fail('budget_unavailable', `广告账户 ${accountId} 的数据没读全，无法检查预算。`)
    }
    const acctCurrency = acct.currency ? upper(acct.currency) : ''
    if (!acctCurrency || acctCurrency !== draftCurrency) {
      return fail('budget_unavailable', '各账户币种不一致或读不到，无法比较。')
    }
  }
  return null
}

/** 一个 ACTIVE 系列名下、计入在投的日预算合计；遇到无法比较的预算返回失败。 */
function campaignActiveCents(
  campaign: BudgetCampaignFact,
  adSets: readonly BudgetAdSetFact[],
  excludeIds: readonly string[],
): number | ActivationBudgetResult {
  if (isPositiveAmount(campaign.dailyBudgetCents)) {
    return campaign.dailyBudgetCents
  }
  if (isPositiveAmount(campaign.lifetimeBudgetCents)) {
    return fail(
      'budget_unavailable',
      `系列 ${campaign.id} 只设了总预算，没有日预算，无法比较。`,
    )
  }
  let sum = 0
  for (const adSet of adSets) {
    if (adSet.campaignId !== campaign.id) continue
    if (!isActive(adSet.status)) continue
    if (excludeIds.includes(adSet.id)) continue
    if (isPositiveAmount(adSet.dailyBudgetCents)) {
      sum += adSet.dailyBudgetCents
      continue
    }
    if (isPositiveAmount(adSet.lifetimeBudgetCents)) {
      return fail(
        'budget_unavailable',
        `广告组 ${adSet.id} 只设了总预算，没有日预算，无法比较。`,
      )
    }
    return fail('budget_unavailable', `广告组 ${adSet.id} 读不到预算，无法比较。`)
  }
  return sum
}

/** 单个账户的在投每日预算合计。 */
function accountActiveCents(
  acct: BudgetAccountFact,
  excludeIds: readonly string[],
): number | ActivationBudgetResult {
  let sum = 0
  for (const campaign of acct.campaigns) {
    if (!isActive(campaign.status)) continue
    if (excludeIds.includes(campaign.id)) continue
    const cents = campaignActiveCents(campaign, acct.adSets, excludeIds)
    if (typeof cents !== 'number') return cents
    sum += cents
  }
  return sum
}

/** C. 所有登记账户的在投合计。 */
function totalActiveCents(
  input: ActivationBudgetInput,
): { totalCents: number; perAccount: Map<string, number> } | ActivationBudgetResult {
  const excludeIds =
    input.mode === 'pre' ? [input.draft.campaignId, input.draft.adSetId] : []
  const perAccount = new Map<string, number>()
  let totalCents = 0
  for (const accountId of input.registeredAccountIds) {
    const acct = input.accounts.find((a) => a.accountId === accountId)
    if (!acct) {
      return fail('budget_unavailable', `读不到广告账户 ${accountId} 的数据，无法检查预算。`)
    }
    const cents = accountActiveCents(acct, excludeIds)
    if (typeof cents !== 'number') return cents
    perAccount.set(accountId, cents)
    totalCents += cents
  }
  return { totalCents, perAccount }
}

/** D. 账户级上限检查。通过返回 null。 */
function checkAccountCap(
  input: ActivationBudgetInput,
  perAccount: Map<string, number>,
): ActivationBudgetResult | null {
  const acct = input.accounts.find((a) => a.accountId === input.draft.accountId)
  if (!acct) return null
  const accountTotal = perAccount.get(input.draft.accountId) ?? 0
  const projected =
    input.mode === 'pre' ? accountTotal + input.draft.dailyBudgetCents : accountTotal

  if (!isPositiveInt(acct.capCents)) {
    if (input.registeredAccountIds.length >= 2) {
      return fail(
        'budget_unavailable',
        `这个客户绑了多个广告账户，但账户 ${input.draft.accountId} 没设每日上限，无法检查预算。`,
      )
    }
    return null
  }
  if (projected > acct.capCents) {
    return fail(
      'budget_cap_exceeded',
      `账户合计 ${formatMoney(accountTotal, input.draft.currency)}、` +
        `本条 ${formatMoney(input.draft.dailyBudgetCents, input.draft.currency)}、` +
        `账户上限 ${formatMoney(acct.capCents, input.draft.currency)}，超过账户上限。`,
      { totalCents: accountTotal, draftCents: input.draft.dailyBudgetCents, capCents: acct.capCents },
    )
  }
  return null
}

export function checkActivationBudget(input: ActivationBudgetInput): ActivationBudgetResult {
  const invalid = validateInput(input)
  if (invalid) return invalid

  const capCents = Math.min(input.capSnapshotCents, input.clientCapCents as number)

  const totals = totalActiveCents(input)
  if ('ok' in totals) return totals
  const { totalCents, perAccount } = totals

  const accountFail = checkAccountCap(input, perAccount)
  if (accountFail) return accountFail

  const projected =
    input.mode === 'pre' ? totalCents + input.draft.dailyBudgetCents : totalCents

  if (projected > capCents) {
    return fail(
      'budget_cap_exceeded',
      `当前在投合计 ${formatMoney(totalCents, input.draft.currency)}、` +
        `本条 ${formatMoney(input.draft.dailyBudgetCents, input.draft.currency)}、` +
        `上限 ${formatMoney(capCents, input.draft.currency)}，超过客户每日总上限。`,
      { totalCents, draftCents: input.draft.dailyBudgetCents, capCents },
    )
  }

  return {
    ok: true,
    totalCents,
    draftCents: input.draft.dailyBudgetCents,
    capCents,
    currency: upper(input.draft.currency),
  }
}
