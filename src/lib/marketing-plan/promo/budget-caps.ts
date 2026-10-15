/**
 * 广告日预算 vs 上限 —— 纯函数。
 *
 * 规则（设计稿 §5.2-7 + Codex 对币种的意见）：
 *  - 按「账户」汇总本计划所有广告步骤的日预算，不是逐个步骤比；
 *  - 账户币种必须能确定（来自账户快照），缺失 → unknown，不猜；
 *  - 客户总上限（ad_strategy_configs.daily_budget_cap_cents）没有币种，只有当全部涉及账户
 *    币种一致时才与之比较，币种不一致或缺失 → unknown（不做换算）；
 *  - 账户级上限（client_meta_ad_accounts.daily_budget_cap_cents）按账户比，没设就不比这一层；
 *  - 已在投放的预算暂未纳入（读取口径还没定：CBO / ABO 层级），结果里明说。
 *
 * 结论只有三种：ok / over / unknown。unknown 在检查清单里是灰色，花钱相关的硬门不能批准。
 */

import type { AdsStep } from './spec'

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

/**
 * 传入的 steps 必须是「同一时间段内同时生效」的广告步骤——也就是同一个阶段的。
 * 阶段在时间上不重叠，所以按阶段检查；不能把后面阶段的预算算进前面阶段。
 */
export function checkAdsBudget(
  steps: readonly AdsStep[],
  accounts: readonly AccountCapFacts[],
  clientCapCents: number | null,
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

  const byId = new Map(accounts.map(a => [a.ad_account_id, a]))
  for (const [accountId, total] of Object.entries(perAccount)) {
    const acc = byId.get(accountId)
    if (!acc || !acc.owned_by_client) {
      reasons.push(`广告账户 ${accountId} 不属于这个客户，不能使用`)
      over = true // 归属错误是确定的错，不是"没核实"
      continue
    }
    if (!acc.currency) {
      reasons.push(`广告账户 ${accountId} 读不到币种，无法核对上限`)
      unknown = true
    }
    if (acc.daily_cap_cents !== null && total > acc.daily_cap_cents) {
      reasons.push(`广告账户 ${accountId} 本计划日预算合计 ${total} 分，超过该账户日上限 ${acc.daily_cap_cents} 分`)
      over = true
    }
  }

  if (clientCapCents === null) {
    reasons.push('客户的广告日预算总上限还没设置')
    unknown = true
  } else {
    const involved = Object.keys(perAccount).map(id => byId.get(id)).filter((a): a is AccountCapFacts => !!a)
    const currencies = new Set(involved.map(a => a.currency))
    if (currencies.has(null) || currencies.size !== 1) {
      reasons.push('涉及的广告账户币种缺失或不一致，客户总上限无法比较（不做币种换算）')
      unknown = true
    } else {
      const sum = Object.values(perAccount).reduce((a, b) => a + b, 0)
      if (sum > clientCapCents) {
        reasons.push(`本计划日预算合计 ${sum} 分，超过客户日预算总上限 ${clientCapCents} 分`)
        over = true
      }
    }
  }

  return {
    verdict: over ? 'over' : unknown ? 'unknown' : 'ok',
    reasons,
    per_account_cents: perAccount,
    notes: [NOTE_LIVE_BUDGET],
  }
}
