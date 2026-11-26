/** 建草稿每天预算的顶按客户自己设的上限走；没设才回到 50。 */
import { describe, expect, it } from 'vitest'
import { draftDailyCeiling, MAX_AUTO_DAILY_BUDGET, validateDraft, type AdDraft } from '../ad-draft'
import '../ad-draft-expansion'
import { pausedDraftCeiling, pausedDraftFacts, type PausedDraftReview } from '../paused-draft-facts'

function draft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'lead_form',
    clientId: 'client-1',
    campaignName: 'lead campaign',
    adSetName: 'group',
    dailyBudget: 80,
    durationDays: 10,
    geoCountries: ['NZ'],
    pageId: 'page-1',
    leadFormId: 'form-1',
    creatives: [{ name: 'A', primaryText: 'Hello there', headline: 'Read more', imageHash: 'hash-1' }],
    ...over,
  }
}

function review(clientCapCents: number | null, accountCapCents: number | null): PausedDraftReview {
  return {
    adAccountId: 'act_test',
    accounts: [{ ad_account_id: 'act_test', currency: 'NZD', daily_cap_cents: accountCapCents, owned_by_client: true }],
    clientCapCents,
    liveDeliveringCents: 0,
    campaignShapes: null,
  }
}

function check(facts: ReturnType<typeof pausedDraftFacts>, label: string) {
  return facts.hardChecks.find((c) => c.label === label)
}

describe('draftDailyCeiling', () => {
  it('客户总上限和账户上限取较小的，分换成元', () => {
    expect(draftDailyCeiling(20001, null)).toBe(200.01)
    expect(draftDailyCeiling(null, 15000)).toBe(150)
    expect(draftDailyCeiling(20000, 10000)).toBe(100)
  })

  it('都没设、或读到的不是正整数分 → 回到 50', () => {
    expect(draftDailyCeiling(null, null)).toBe(MAX_AUTO_DAILY_BUDGET)
    expect(draftDailyCeiling(undefined, undefined)).toBe(MAX_AUTO_DAILY_BUDGET)
    expect(draftDailyCeiling(0, -5)).toBe(MAX_AUTO_DAILY_BUDGET)
    expect(draftDailyCeiling(Number.NaN, 12.5)).toBe(MAX_AUTO_DAILY_BUDGET)
  })
})

describe('validateDraft 带上限', () => {
  const budgetFields = (d: AdDraft, max?: number) =>
    validateDraft(d, max === undefined ? undefined : { maxDailyBudget: max }).filter((p) => p.message.includes('每日上限'))

  it('不给上限 → 还是 50', () => {
    expect(budgetFields(draft())).toHaveLength(1)
    expect(budgetFields(draft({ dailyBudget: 50 }))).toEqual([])
  })

  it('给了 200 → 80 放行，200 放行，200.01 拦', () => {
    expect(budgetFields(draft(), 200)).toEqual([])
    expect(budgetFields(draft({ dailyBudget: 200 }), 200)).toEqual([])
    expect(budgetFields(draft({ dailyBudget: 200.01 }), 200)).toHaveLength(1)
  })

  it('乱给的上限（0、负数、NaN）不放宽，回到 50', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(budgetFields(draft(), bad)).toHaveLength(1)
    }
  })

  it('系列预算同样按给的上限判', () => {
    const d = draft({ budgetMode: 'campaign', campaignDailyBudget: 80 })
    const campaignCap = (max?: number) =>
      validateDraft(d, max === undefined ? undefined : { maxDailyBudget: max })
        .filter((p) => p.field === 'campaignDailyBudget' && p.message.includes('每日上限'))
    expect(campaignCap()).toHaveLength(1)
    expect(campaignCap(200)).toEqual([])
  })
})

describe('暂停草稿确认卡', () => {
  it('客户上限 200、账户没单设 → 每天 80 的建前复核和日预算上限都过', () => {
    const r = review(20000, null)
    expect(pausedDraftCeiling(r)).toBe(200)
    const facts = pausedDraftFacts(draft(), '账户', r)
    expect(check(facts, '建前复核')?.state).toBe('green')
    expect(check(facts, '日预算上限')?.state).toBe('green')
  })

  it('账户上限 60 比客户上限小 → 每天 80 建前复核不过', () => {
    const facts = pausedDraftFacts(draft(), '账户', review(20000, 6000))
    expect(check(facts, '建前复核')?.state).toBe('red')
  })

  it('客户一个上限都没设 → 回到 50，每天 80 不过', () => {
    const r = review(null, null)
    expect(pausedDraftCeiling(r)).toBe(MAX_AUTO_DAILY_BUDGET)
    expect(check(pausedDraftFacts(draft(), '账户', r), '建前复核')?.state).toBe('red')
  })

  it('客户上限比 50 低 → 卡上单份草稿的顶仍是 50，不另收紧（真实金额由日预算上限检查拦）', () => {
    const r = review(3000, null)
    expect(pausedDraftCeiling(r)).toBe(MAX_AUTO_DAILY_BUDGET)
    expect(check(pausedDraftFacts(draft({ dailyBudget: 40 }), '账户', r), '日预算上限')?.state).toBe('red')
  })

  it('不属于这个客户的账户上限不算数', () => {
    const r: PausedDraftReview = {
      ...review(null, null),
      accounts: [{ ad_account_id: 'act_test', currency: 'NZD', daily_cap_cents: 50000, owned_by_client: false }],
    }
    expect(pausedDraftCeiling(r)).toBe(MAX_AUTO_DAILY_BUDGET)
  })
})
