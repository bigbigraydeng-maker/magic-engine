import { describe, it, expect } from 'vitest'
import {
  ALLOWED_BUDGET_CURRENCIES,
  checkActivationBudget,
  type ActivationBudgetInput,
} from '../activation-budget'

/** 一份合法输入：单账户 '111'，NZD，客户上限 15000 分，草案 500 分。 */
function base(): ActivationBudgetInput {
  return {
    mode: 'pre',
    clientCapCents: 15000,
    capSnapshotCents: 15000,
    registeredAccountIds: ['111'],
    accounts: [
      {
        accountId: '111',
        currency: 'NZD',
        complete: true,
        capCents: null,
        campaigns: [
          { id: 'c1', accountId: '111', status: 'ACTIVE', dailyBudgetCents: null, lifetimeBudgetCents: null },
          { id: 'draft-c', accountId: '111', status: 'PAUSED', dailyBudgetCents: null, lifetimeBudgetCents: null },
        ],
        adSets: [
          { id: 'a1', accountId: '111', campaignId: 'c1', status: 'ACTIVE', dailyBudgetCents: 10000, lifetimeBudgetCents: null },
          { id: 'draft-a', accountId: '111', campaignId: 'draft-c', status: 'PAUSED', dailyBudgetCents: 500, lifetimeBudgetCents: null },
        ],
      },
    ],
    draft: {
      accountId: '111',
      campaignId: 'draft-c',
      adSetId: 'draft-a',
      dailyBudgetCents: 500,
      currency: 'NZD',
    },
  }
}

describe('checkActivationBudget', () => {
  it('合法输入放行，合计与上限正确', () => {
    const r = checkActivationBudget(base())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.totalCents).toBe(10000)
      expect(r.capCents).toBe(15000)
      expect(r.draftCents).toBe(500)
      expect(r.currency).toBe('NZD')
    }
  })

  it('刚好等于上限放行，多 1 分拒绝并报出三个数', () => {
    const atCap = base()
    atCap.accounts[0].adSets[0].dailyBudgetCents = 14500
    const ok = checkActivationBudget(atCap)
    expect(ok.ok).toBe(true)

    const over = base()
    over.accounts[0].adSets[0].dailyBudgetCents = 14501
    const r = checkActivationBudget(over)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('budget_cap_exceeded')
      expect(r.message).toContain('NZD 145.01')
      expect(r.message).toContain('NZD 5.00')
      expect(r.message).toContain('NZD 150.00')
    }
  })

  it('CBO 系列只计系列日预算，不重复计广告组', () => {
    const input = base()
    input.accounts[0].campaigns[0].dailyBudgetCents = 8000
    input.accounts[0].adSets = [
      { id: 'a1', accountId: '111', campaignId: 'c1', status: 'ACTIVE', dailyBudgetCents: 3000, lifetimeBudgetCents: null },
      { id: 'a2', accountId: '111', campaignId: 'c1', status: 'ACTIVE', dailyBudgetCents: 3000, lifetimeBudgetCents: null },
      { id: 'draft-a', accountId: '111', campaignId: 'draft-c', status: 'PAUSED', dailyBudgetCents: 500, lifetimeBudgetCents: null },
    ]
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.totalCents).toBe(8000)
  })

  it('ABO 系列下多个 ACTIVE 广告组求和，非 ACTIVE 不计，大小写不敏感', () => {
    const input = base()
    input.accounts[0].adSets = [
      { id: 'a1', accountId: '111', campaignId: 'c1', status: 'active', dailyBudgetCents: 1000, lifetimeBudgetCents: null },
      { id: 'a2', accountId: '111', campaignId: 'c1', status: 'ACTIVE', dailyBudgetCents: 2000, lifetimeBudgetCents: null },
      { id: 'a3', accountId: '111', campaignId: 'c1', status: 'PAUSED', dailyBudgetCents: 4000, lifetimeBudgetCents: null },
      { id: 'a4', accountId: '111', campaignId: 'c1', status: 'DELETED', dailyBudgetCents: 4000, lifetimeBudgetCents: null },
      { id: 'a5', accountId: '111', campaignId: 'c1', status: 'ARCHIVED', dailyBudgetCents: 4000, lifetimeBudgetCents: null },
      { id: 'draft-a', accountId: '111', campaignId: 'draft-c', status: 'PAUSED', dailyBudgetCents: 500, lifetimeBudgetCents: null },
    ]
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.totalCents).toBe(3000)
  })

  it('孤立 ACTIVE 广告组（父系列 PAUSED 或不存在）不计入', () => {
    const input = base()
    input.accounts[0].campaigns[0].status = 'PAUSED'
    input.accounts[0].adSets = [
      { id: 'a1', accountId: '111', campaignId: 'c1', status: 'ACTIVE', dailyBudgetCents: 10000, lifetimeBudgetCents: null },
      { id: 'a2', accountId: '111', campaignId: 'ghost', status: 'ACTIVE', dailyBudgetCents: 10000, lifetimeBudgetCents: null },
      { id: 'draft-a', accountId: '111', campaignId: 'draft-c', status: 'PAUSED', dailyBudgetCents: 500, lifetimeBudgetCents: null },
    ]
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.totalCents).toBe(0)
  })

  it('只有总预算的 ACTIVE 系列拒绝并点名系列 id', () => {
    const input = base()
    input.accounts[0].campaigns[0].lifetimeBudgetCents = 500000
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('budget_unavailable')
      expect(r.message).toContain('c1')
    }
  })

  it('ABO 广告组只有总预算拒绝并点名广告组 id', () => {
    const input = base()
    input.accounts[0].adSets[0].dailyBudgetCents = null
    input.accounts[0].adSets[0].lifetimeBudgetCents = 500000
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('budget_unavailable')
      expect(r.message).toContain('a1')
    }
  })

  it('ABO 广告组两个预算都没有拒绝', () => {
    const input = base()
    input.accounts[0].adSets[0].dailyBudgetCents = null
    input.accounts[0].adSets[0].lifetimeBudgetCents = null
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('budget_unavailable')
      expect(r.message).toContain('a1')
    }
  })

  it('客户上限为 null / 0 / 负数 / 小数都拒绝，不许用快照代替', () => {
    for (const bad of [null, 0, -1, 100.5]) {
      const input = base()
      input.clientCapCents = bad
      const r = checkActivationBudget(input)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe('budget_unavailable')
        expect(r.message).toContain('广告健康')
      }
    }
  })

  it('有效上限取快照与当前值的较小者', () => {
    const input = base()
    input.capSnapshotCents = 10000
    input.clientCapCents = 15000
    input.accounts[0].adSets[0].dailyBudgetCents = 9600
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('budget_cap_exceeded')
      expect(r.capCents).toBe(10000)
    }
  })

  it('登记账户没读全或缺失都拒绝并点名账户', () => {
    const incomplete = base()
    incomplete.accounts[0].complete = false
    const r1 = checkActivationBudget(incomplete)
    expect(r1.ok).toBe(false)
    if (!r1.ok) {
      expect(r1.code).toBe('budget_unavailable')
      expect(r1.message).toContain('111')
    }

    const missing = base()
    missing.accounts = []
    const r2 = checkActivationBudget(missing)
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.code).toBe('budget_unavailable')
      expect(r2.message).toContain('111')
    }
  })

  it('币种校验：null / 不一致拒绝，小写通过，JPY 拒绝，白名单固定', () => {
    const nullCurrency = base()
    nullCurrency.accounts[0].currency = null
    expect(checkActivationBudget(nullCurrency).ok).toBe(false)

    const mismatch = base()
    mismatch.accounts[0].currency = 'AUD'
    expect(checkActivationBudget(mismatch).ok).toBe(false)

    const lower = base()
    lower.draft.currency = 'nzd'
    const r = checkActivationBudget(lower)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.currency).toBe('NZD')

    const jpy = base()
    jpy.draft.currency = 'JPY'
    const rj = checkActivationBudget(jpy)
    expect(rj.ok).toBe(false)
    if (!rj.ok) expect(rj.code).toBe('budget_unavailable')

    expect(ALLOWED_BUDGET_CURRENCIES).toEqual(['NZD', 'AUD', 'USD'])
  })

  it('多账户：本账户没设上限拒绝；超账户上限拒绝；单账户缺上限不影响', () => {
    const twoAccounts = (): ActivationBudgetInput => {
      const input = base()
      input.registeredAccountIds = ['111', '222']
      input.accounts = [
        ...input.accounts,
        {
          accountId: '222',
          currency: 'NZD',
          complete: true,
          capCents: null,
          campaigns: [],
          adSets: [],
        },
      ]
      return input
    }

    const noCap = twoAccounts()
    const r1 = checkActivationBudget(noCap)
    expect(r1.ok).toBe(false)
    if (!r1.ok) {
      expect(r1.code).toBe('budget_unavailable')
      expect(r1.message).toContain('111')
    }

    const overAcct = twoAccounts()
    overAcct.accounts[0].capCents = 9000
    const r2 = checkActivationBudget(overAcct)
    expect(r2.ok).toBe(false)
    if (!r2.ok) {
      expect(r2.code).toBe('budget_cap_exceeded')
      expect(r2.message).toContain('NZD 100.00')
      expect(r2.message).toContain('NZD 90.00')
    }

    const single = base()
    single.accounts[0].capCents = null
    expect(checkActivationBudget(single).ok).toBe(true)
  })

  it('pre 不重复计草案对象；post 合计已含本条不再加', () => {
    const pre = base()
    pre.accounts[0].campaigns[1].status = 'ACTIVE'
    pre.accounts[0].adSets[1].status = 'ACTIVE'
    const rp = checkActivationBudget(pre)
    expect(rp.ok).toBe(true)
    if (rp.ok) expect(rp.totalCents).toBe(10000)

    const postOk = base()
    postOk.mode = 'post'
    postOk.accounts[0].campaigns[1].status = 'ACTIVE'
    postOk.accounts[0].adSets[1].status = 'ACTIVE'
    postOk.accounts[0].adSets[0].dailyBudgetCents = 14500
    const r1 = checkActivationBudget(postOk)
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.totalCents).toBe(15000)

    const postOver = base()
    postOver.mode = 'post'
    postOver.clientCapCents = 14999
    postOver.capSnapshotCents = 14999
    postOver.accounts[0].campaigns[1].status = 'ACTIVE'
    postOver.accounts[0].adSets[1].status = 'ACTIVE'
    postOver.accounts[0].adSets[0].dailyBudgetCents = 14500
    const r2 = checkActivationBudget(postOver)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.code).toBe('budget_cap_exceeded')
  })

  it('草案预算非法、登记账户为空或不含草案账户都拒绝', () => {
    for (const bad of [0, -1, 100.5]) {
      const input = base()
      input.draft.dailyBudgetCents = bad
      const r = checkActivationBudget(input)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe('budget_unavailable')
    }

    const empty = base()
    empty.registeredAccountIds = []
    expect(checkActivationBudget(empty).ok).toBe(false)

    const notRegistered = base()
    notRegistered.registeredAccountIds = ['999']
    notRegistered.accounts = [
      { accountId: '999', currency: 'NZD', complete: true, capCents: null, campaigns: [], adSets: [] },
    ]
    const r = checkActivationBudget(notRegistered)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('budget_unavailable')
  })

  it('金额格式化为「币种 + 两位小数的元」', () => {
    const input = base()
    // 上限压到 10000：合计 11500 + 本条 500 才算超限
    input.clientCapCents = 10000
    input.capSnapshotCents = 10000
    input.accounts[0].adSets[0].dailyBudgetCents = 11500
    const r = checkActivationBudget(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('budget_cap_exceeded')
      expect(r.message).toContain('NZD 115.00')
    }
  })
})
