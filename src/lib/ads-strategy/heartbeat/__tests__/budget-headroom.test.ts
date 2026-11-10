import { describe, it, expect } from 'vitest'
import type { LiveAccountView, LiveAdset } from '../live-view'
import { computeBudgetHeadroom } from '../budget-headroom'

function adset(over: Partial<LiveAdset>): LiveAdset {
  return {
    adsetId: 'as1', name: 'as1', status: 'ACTIVE', spendToday: 0, impressionsToday: 0,
    dailyBudget: null, budgetLevel: 'adset', createdToday: false, adCount: 1, ...over,
  }
}

function account(over: Partial<LiveAccountView>): LiveAccountView {
  return {
    adAccountId: 'act_1', readState: 'ok', reason: null, currency: 'NZD', accountDay: '2026-11-06',
    active: [], newToday: [], ...over,
  }
}

describe('computeBudgetHeadroom', () => {
  it('组 A 100 + 扩量 100，客户总上限 200.01 → 合计 200，只剩 0.01，顶满', () => {
    const r = computeBudgetHeadroom([account({ active: [adset({ adsetId: 'A', dailyBudget: 100 }), adset({ adsetId: 'X', dailyBudget: 100 })] })], 20001)
    expect(r.totalDaily).toBe(200)
    expect(r.cap).toBe(200.01)
    expect(r.headroom).toBeCloseTo(0.01, 5)
    expect(r.level).toBe('full')
    expect(r.currency).toBe('NZD')
  })

  it('上限 300 → 还剩 100，宽裕', () => {
    const r = computeBudgetHeadroom([account({ active: [adset({ dailyBudget: 100 }), adset({ adsetId: 'b', dailyBudget: 100 })] })], 30000)
    expect(r.headroom).toBe(100)
    expect(r.level).toBe('ample')
  })

  it('剩下不到一成 → 紧', () => {
    const r = computeBudgetHeadroom([account({ active: [adset({ dailyBudget: 200 })] })], 21000)
    expect(r.headroom).toBe(10)
    expect(r.level).toBe('tight')
  })

  it('合计超过上限 → over，余量为负', () => {
    const r = computeBudgetHeadroom([account({ active: [adset({ dailyBudget: 250 })] })], 20001)
    expect(r.level).toBe('over')
    expect(r.headroom).toBeCloseTo(-49.99, 5)
  })

  it('没设总上限 → no_cap，不编上限', () => {
    const r = computeBudgetHeadroom([account({ active: [adset({ dailyBudget: 100 })] })], null)
    expect(r.level).toBe('no_cap')
    expect(r.cap).toBeNull()
    expect(r.headroom).toBeNull()
  })

  it('预算设在系列层的在投组读不到 → 计数，不加进合计', () => {
    const r = computeBudgetHeadroom([account({ active: [adset({ dailyBudget: 30 }), adset({ adsetId: 'c', budgetLevel: 'campaign', dailyBudget: null })] })], 20001)
    expect(r.totalDaily).toBe(30)
    expect(r.unreadableCount).toBe(1)
  })

  it('整个账户没读到 → 计数；其余账户照常合计', () => {
    const r = computeBudgetHeadroom([
      account({ active: [adset({ dailyBudget: 100 })] }),
      account({ adAccountId: 'act_2', readState: 'unreadable', active: [adset({ adsetId: 'z', dailyBudget: 999 })] }),
    ], 20001)
    expect(r.totalDaily).toBe(100)
    expect(r.unreadableAccounts).toBe(1)
  })

  it('两种币种同时在投 → unavailable', () => {
    const r = computeBudgetHeadroom([
      account({ active: [adset({ dailyBudget: 100 })] }),
      account({ adAccountId: 'act_2', currency: 'AUD', active: [adset({ adsetId: 'y', dailyBudget: 50 })] }),
    ], 20001)
    expect(r.state).toBe('unavailable')
  })

  it('没有在投的组 → 合计 0', () => {
    const r = computeBudgetHeadroom([account({})], 1000)
    expect(r.totalDaily).toBe(0)
    expect(r.level).toBe('ample')
  })
})
