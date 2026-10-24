/**
 * judgeAccountBilling —— 「其它登记账户」那部分（隐藏 ≠ 没预算）的单元测试。
 *
 * 设计决定（已批准）：
 * - 账户在广告健康页隐藏，本身不能把灯变绿；
 * - 只要还有其它登记账户开着预算，灯就停在黄；
 * - 只有其它账户都没有开着的预算时，才可能变绿；
 * - 其它账户没读到（other_accounts === null）时，行为和以前完全一样。
 *
 * 本文件按「住在 __tests__/ 里」写 import；之后会被挪过去。
 */

import { describe, expect, it } from 'vitest'

import { judgeAccountBilling } from '../judge'
import type {
  BudgetFacts,
  MetaFacts,
  OtherAccountFact,
  TrackingClientConfig,
} from '../types'

const NOW = new Date('2026-10-21T10:00:00.000Z')

const config: TrackingClientConfig = {
  ad_account_id: 'act_1111111111',
  site_url: 'https://www.example-shop.test',
  landing_targets: [],
  ga4_lead_events: [],
  web_form_to_crm: true,
  planned_daily_budget_cents: null,
  official_daily_cap_cents: null,
  currency: 'NZD',
}

const meta: MetaFacts = {
  read: true,
  as_of: NOW.toISOString(),
  account_dataset_ids: [],
  datasets: [],
  account: {
    status: 1,
    disable_reason: 0,
    has_funding_source: true,
    spend_cap_minor: 0,
    amount_spent_minor: 29434,
    currency: 'NZD',
  },
}

function budget(over: Partial<BudgetFacts> = {}): BudgetFacts {
  return {
    read: true,
    error: null,
    as_of: NOW.toISOString(),
    account_cap_cents: 15000,
    client_cap_cents: 15000,
    registered_account_count: 2,
    live_daily_budget_cents: 13400,
    live_lifetime_budget_count: 0,
    live_entity_count: 3,
    other_accounts: null,
    other_accounts_error: null,
    ...over,
  }
}

function other(over: Partial<OtherAccountFact> = {}): OtherAccountFact {
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
    snapshot_at: NOW.toISOString(),
    ...over,
  }
}

describe('judgeAccountBilling —— 其它登记账户', () => {
  it('其它账户没读到：行为和以前一样，出黄并说明「只核对这一个账户」', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({ other_accounts: null, registered_account_count: 2 }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('yellow')
    expect(r.reason).toContain(
      '客户登记了 2 个广告账户，这里只核对这一个账户；客户总上限是各账户加起来比的，这里没算',
    )
    expect(r.evidence.other_accounts_read).toBe(false)
  })

  it('另一个账户欠款但开着预算：仍是黄，说明合计会超客户总上限，并提醒不要还款', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({ other_accounts: [other()] }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('yellow')
    expect(r.reason).toContain('账户欠款、现在投不出去')
    expect(r.reason).toContain('日预算合计 115.00 NZD')
    expect(r.reason).toContain('两个账户合计 249.00 NZD，会超过客户总上限 150.00 NZD')
    expect(r.reason).toContain(
      '本账户现在在投的日预算合计 134.00 NZD，没超库里的账户级日上限 150.00 NZD',
    )
    expect(r.how).toContain('不要给欠款的账户还款')
    expect(r.evidence.other_live_daily_budget_cents).toBe(11500)
    expect(r.evidence.other_accounts_count).toBe(1)
    expect(r.evidence.other_accounts_read).toBe(true)
  })

  it('其它账户都没有开着的预算：变绿，并说明合计就是整个客户的在投合计', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({
        other_accounts: [
          other({ open_campaign_count: 0, live_daily_budget_cents: 0, live_entity_count: 0 }),
        ],
      }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('green')
    expect(r.reason).toContain(
      '另有 1 个登记账户（其中 1 个已在广告健康页隐藏）里没有开着的预算，所以这里的合计就是整个客户的在投合计',
    )
    expect(r.reason).toContain('账户级与客户级日上限 150.00 NZD')
    expect(r.how).toBe('')
  })

  it('另一个账户正在投放、合计超客户总上限：仍是黄（不是红）', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({
        other_accounts: [other({ account_status: 1, hidden: false })],
      }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('yellow')
    expect(r.reason).toContain('已经超过客户总上限')
  })

  it('其它账户币种对不上：回到旧的黄灯说法（只核对这一个账户）', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({ other_accounts: [other({ currency: 'AUD' })] }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('yellow')
    expect(r.reason).toContain(
      '客户登记了 2 个广告账户，这里只核对这一个账户；客户总上限是各账户加起来比的，这里没算',
    )
  })

  it('只登记了一个账户：变绿，不提「其它 / 另有」', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({ registered_account_count: 1, other_accounts: [] }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('green')
    expect(r.reason).not.toContain('其它')
    expect(r.reason).not.toContain('另有')
  })

  it('多账户下本账户自己的上限没设：仍是灰（老规则不变）', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({
        account_cap_cents: null,
        registered_account_count: 2,
        other_accounts: [other()],
      }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('gray')
  })

  it('本账户在投预算超过上限：不管其它账户怎样都是红', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({
        live_daily_budget_cents: 16000,
        other_accounts: [other()],
      }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('red')
  })

  it('两个其它账户、一个有开着的预算一个没有：说明里带上「另有 1 个登记账户没有开着的预算」', () => {
    const r = judgeAccountBilling({
      config,
      meta,
      budget: budget({
        other_accounts: [
          other(),
          other({
            tail: '8888',
            label: '备用账户',
            hidden: false,
            account_status: 1,
            open_campaign_count: 0,
            live_daily_budget_cents: 0,
            live_entity_count: 0,
          }),
        ],
      }),
    })

    expect(r.key).toBe('env.account_billing')
    expect(r.status).toBe('yellow')
    expect(r.reason).toContain('（另有 1 个登记账户没有开着的预算）')
  })
})
