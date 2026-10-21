import { describe, expect, it } from 'vitest'

import type { OtherAccountFact } from '../types'
import { summarizeOtherAccounts } from '../other-accounts-text'

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`

function fact(overrides: Partial<OtherAccountFact> = {}): OtherAccountFact {
  return {
    tail: '7274',
    label: '主账户',
    hidden: true,
    account_status: 3,
    currency: 'NZD',
    open_campaign_count: 4,
    live_daily_budget_cents: 11500,
    live_lifetime_budget_count: 0,
    live_entity_count: 5,
    snapshot_at: '2026-10-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('summarizeOtherAccounts', () => {
  it('1. realistic case: hidden unpaid account with open budget', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact()],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toBe(
      '客户登记了 2 个广告账户，这里只核对这一个账户；另一个账户「主账户」（尾号 7274，已在广告健康页隐藏，账户欠款、现在投不出去）里仍有 4 个系列开着，日预算合计 115.00 NZD。它现在投不出去，但一旦恢复投放（比如还款），两个账户合计 249.00 NZD，会超过客户总上限 150.00 NZD',
    )
    expect(result.how).toBe(
      '不要给欠款的账户还款；如必须还款，先通知广告总控，还款后立刻把它里面开着的系列暂停（欠款期间 Meta 不允许改动，没法先停）',
    )
  })

  it('2. combined within the cap', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact()],
      live: 3000,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason.endsWith('两个账户合计 145.00 NZD，在客户总上限 150.00 NZD 内')).toBe(true)
  })

  it('3. no client cap', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact()],
      live: 13400,
      clientCap: null,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason.endsWith('客户总上限没设，合计没法比')).toBe(true)
  })

  it('4. other account running and not hidden', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ account_status: 1, hidden: false })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toContain('账户正常，正在投放')
    expect(result.reason).toContain('已经超过客户总上限')
    expect(result.reason).not.toContain('已在广告健康页隐藏')
    expect(result.how).toBe('把这个账户里开着的预算计入客户总上限；超了就先降预算或暂停多余的系列')
  })

  it('5a. unknown status', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ account_status: null })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toContain('账户状态没读到')
    expect(result.reason).toContain('状态没读到，不确定它现在能不能投')
    expect(result.how).toBe(
      '先弄清这个账户为什么投不出去（状态码 / 欠款 / 停用）；恢复之前先处理它里面开着的系列',
    )
  })

  it('5b. other status code', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ account_status: 2 })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toContain('账户状态码 2、可能投不出去')
  })

  it('6. two open accounts', () => {
    const result = summarizeOtherAccounts({
      registered: 3,
      others: [fact(), fact({ tail: '8888', label: '副账户' })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toContain('另有 2 个账户有开着的预算：')
    expect(result.reason).toContain('各账户合计')
  })

  it('7. one open plus one empty other account', () => {
    const result = summarizeOtherAccounts({
      registered: 3,
      others: [
        fact(),
        fact({
          tail: '9999',
          label: '空账户',
          hidden: false,
          live_daily_budget_cents: 0,
          live_lifetime_budget_count: 0,
        }),
      ],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toContain('（另有 1 个登记账户没有开着的预算）')
  })

  it('8. lifetime budget only counts as open', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ live_daily_budget_cents: 0, live_lifetime_budget_count: 2 })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
    if (result.kind !== 'open') return
    expect(result.reason).toContain('另有 2 个用终身预算、折不出日预算')
  })

  it('9. none open', () => {
    const result = summarizeOtherAccounts({
      registered: 3,
      others: [
        fact({ hidden: true, live_daily_budget_cents: 0, live_lifetime_budget_count: 0 }),
        fact({
          tail: '1111',
          label: '另一个',
          hidden: false,
          live_daily_budget_cents: 0,
          live_lifetime_budget_count: 0,
        }),
      ],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result).toEqual({ kind: 'none_open', accounts: 2, hidden: 1 })
  })

  it('10a. cannot_sum when no other accounts', () => {
    const result = summarizeOtherAccounts({
      registered: 1,
      others: [],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result).toEqual({ kind: 'cannot_sum' })
  })

  it('10b. cannot_sum on mixed currency', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ currency: 'AUD' })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result).toEqual({ kind: 'cannot_sum' })
  })

  it('10c. null currency does not trigger cannot_sum', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ currency: null })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
  })

  it('10d. currency comparison is case-insensitive', () => {
    const result = summarizeOtherAccounts({
      registered: 2,
      others: [fact({ currency: 'nzd' })],
      live: 13400,
      clientCap: 15000,
      currency: 'NZD',
      money,
    })
    expect(result.kind).toBe('open')
  })
})
