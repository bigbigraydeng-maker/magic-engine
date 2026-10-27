import { describe, expect, it } from 'vitest'
import { checkAdsBudget, collectPhaseBudgetProblems, type AccountCapFacts } from '../budget-caps'
import { baseSpec } from './fixtures'
import { allAdsSteps, type PromoSpec } from '../spec'

const acct = (o: Partial<AccountCapFacts> = {}): AccountCapFacts => ({
  ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: true, ...o,
})

const stepsOf = (s: PromoSpec) => allAdsSteps(s).map(x => x.step)

function specWithBudgets(budgets: Record<string, number>): PromoSpec {
  const s = baseSpec()
  s.phases[0].steps = Object.entries(budgets).map(([acc, cents], i) => ({
    id: `a${i}`, kind: 'ads_campaign' as const,
    settings: { ad_account_id: acc, daily_budget_cents: cents, audience_ref: 'x', creative_refs: [], placements: [], paused_ranges: [] },
  }))
  return s
}

describe('checkAdsBudget', () => {
  it('没有广告步骤 → ok', () => {
    const s = baseSpec(); s.phases[0].steps = []
    expect(checkAdsBudget(allAdsSteps(s).map(x => x.step), [], null).verdict).toBe('ok')
  })

  it('单账户、各自不超 → ok，并声明没纳入已在投放预算', () => {
    const r = checkAdsBudget(stepsOf(baseSpec()), [acct()], 20000)
    expect(r.verdict).toBe('ok')
    expect(r.notes.join('')).toContain('已在投放')
  })

  it('两个步骤各自不超账户上限、合计超 → over（按账户汇总，不逐个比）', () => {
    const r = checkAdsBudget(stepsOf(specWithBudgets({ act_1: 6000 })), [acct({ daily_cap_cents: 10000 })], 50000)
    expect(r.verdict).toBe('ok')
    const s = baseSpec()
    s.phases[0].steps = [0, 1].map(i => ({
      id: `a${i}`, kind: 'ads_campaign' as const,
      settings: { ad_account_id: 'act_1', daily_budget_cents: 6000, audience_ref: 'x', creative_refs: [], placements: [], paused_ranges: [] },
    }))
    const r2 = checkAdsBudget(stepsOf(s), [acct({ daily_cap_cents: 10000 })], 50000)
    expect(r2.verdict).toBe('over')
    expect(r2.per_account_cents.act_1).toBe(12000)
  })

  it('合计超客户总上限（同币种）→ over', () => {
    const r = checkAdsBudget(stepsOf(specWithBudgets({ act_1: 8000, act_2: 8000 })),
      [acct(), acct({ ad_account_id: 'act_2', daily_cap_cents: null })], 12000)
    expect(r.verdict).toBe('over')
  })

  it('账户不属于该客户 → over（确定的错，不是未核实）', () => {
    const r = checkAdsBudget(stepsOf(baseSpec()), [acct({ owned_by_client: false })], 20000)
    expect(r.verdict).toBe('over')
    expect(r.reasons.join('')).toContain('不属于这个客户')
  })

  it('账户根本不在列表里 → over', () => {
    expect(checkAdsBudget(stepsOf(baseSpec()), [], 20000).verdict).toBe('over')
  })

  it('币种读不到 → unknown', () => {
    expect(checkAdsBudget(stepsOf(baseSpec()), [acct({ currency: null })], 20000).verdict).toBe('unknown')
  })

  it('客户总上限没设 → unknown', () => {
    expect(checkAdsBudget(stepsOf(baseSpec()), [acct()], null).verdict).toBe('unknown')
  })

  it('多账户币种不一致 → 客户总上限无法比较 → unknown，不做换算', () => {
    const r = checkAdsBudget(stepsOf(specWithBudgets({ act_1: 1000, act_2: 1000 })),
      [acct(), acct({ ad_account_id: 'act_2', currency: 'NZD' })], 999999)
    expect(r.verdict).toBe('unknown')
    expect(r.reasons.join('')).toContain('币种')
  })

  it('over 优先于 unknown', () => {
    const r = checkAdsBudget(stepsOf(specWithBudgets({ act_1: 99999 })), [acct({ daily_cap_cents: 100 })], null)
    expect(r.verdict).toBe('over')
  })

  it('按阶段汇总超上限时带上阶段名，读不到上限不算拒绝', () => {
    const over = collectPhaseBudgetProblems(baseSpec(), [acct({ daily_cap_cents: 100 })], 20000)
    expect(over[0]).toContain('阶段 1')
    expect(collectPhaseBudgetProblems(baseSpec(), [acct()], null)).toEqual([])
  })
})
