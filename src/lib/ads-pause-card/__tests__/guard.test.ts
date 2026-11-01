import { describe, expect, it } from 'vitest'
import { extractPauseOrders, type PauseOrder } from '../order'
import { guardPause, type LiveFacts, type SuccessorLive } from '../guard'

const order: PauseOrder = {
  sourceKind: 'plan_step',
  sourceId: 'plan-1',
  stepId: 'step-1',
  level: 'ad',
  adAccountId: 'act_42',
  campaignId: '100',
  adsetId: '200',
  adId: '300',
  basis: '这条素材已经过了推广期',
  expectedMetric: 'ads.account.cost_per_lead',
  successorAdId: null,
}

function live(patch: Partial<LiveFacts> = {}): LiveFacts {
  return {
    registeredAccountIds: ['act_42'],
    object: { campaignId: '100', accountId: '42', adsetId: '200' },
    campaignAds: [
      { id: '300', adsetId: '200', effectiveStatus: 'ACTIVE' },
      { id: '301', adsetId: '201', effectiveStatus: 'ACTIVE' },
    ],
    successor: blankSuccessor(),
    ...patch,
  }
}

function blankSuccessor(): SuccessorLive {
  return { readable: true, accountId: null, campaignId: null, adsetId: null, effectiveStatus: null }
}

function placed(patch: Partial<SuccessorLive> = {}): SuccessorLive {
  return { readable: true, accountId: '42', campaignId: '100', adsetId: '200', effectiveStatus: 'ACTIVE', ...patch }
}

describe('pause card guards', () => {
  it('passes a pause that leaves another ad running', () => {
    const result = guardPause(order, live(), false)
    expect(result.block).toBeNull()
    expect(result.checks.map((check) => check.label)).toContain('只暂停')
  })

  it('blocks when the object is not in the client account or campaign', () => {
    const result = guardPause(order, live({ object: { campaignId: '999', accountId: '42', adsetId: '200' } }), false)
    expect(result.block).toContain('不属于')
  })

  it('does not treat an unreadable account as owned', () => {
    const result = guardPause(order, live({ registeredAccountIds: null }), false)
    expect(result.checks.find((check) => check.label === '归属')?.state).toBe('unread')
    expect(result.block).toBeTruthy()
  })

  it('warns and blocks until the empty campaign is confirmed on its own', () => {
    const only = live({ campaignAds: [{ id: '300', adsetId: '200', effectiveStatus: 'ACTIVE' }] })
    expect(guardPause(order, only, false).block).toContain('单独确认')
    expect(guardPause(order, only, true).block).toBeNull()
  })

  it('waits until the replacement ad reads back as active', () => {
    const replacing = { ...order, successorAdId: '400' }
    const waiting = guardPause(replacing, live({ successor: placed({ effectiveStatus: 'PAUSED' }) }), false)
    expect(waiting.block).toContain('还没回读到在投')
    const ready = guardPause(replacing, live({ successor: placed({ accountId: 'act_42' }) }), false)
    expect(ready.block).toBeNull()
    expect(ready.checks.find((check) => check.label === '新广告在投')?.state).toBe('green')
  })

  it('does not unlock a pause when an active ad is in another account or campaign', () => {
    const replacing = { ...order, successorAdId: '400' }
    const otherAccount = guardPause(replacing, live({
      registeredAccountIds: ['act_42', 'act_77'],
      successor: placed({ accountId: '77' }),
    }), false)
    expect(otherAccount.checks.find((check) => check.label === '新广告在投')?.state).toBe('red')
    expect(otherAccount.block).toContain('同一个已登记账户')
    const otherCampaign = guardPause(replacing, live({ successor: placed({ campaignId: '999' }) }), false)
    expect(otherCampaign.checks.find((check) => check.label === '新广告在投')?.state).toBe('red')
    expect(otherCampaign.block).toContain('同一个已登记账户')
    const unlisted = guardPause(replacing, live({
      registeredAccountIds: ['act_99'],
      successor: placed(),
    }), false)
    expect(unlisted.checks.find((check) => check.label === '新广告在投')?.state).toBe('red')
  })

  it('stays red when the replacement is missing an account, campaign, ad set, or status', () => {
    const replacing = { ...order, successorAdId: '400' }
    const gaps: Array<Partial<SuccessorLive>> = [
      { accountId: null },
      { campaignId: null },
      { adsetId: null },
      { effectiveStatus: null },
    ]
    for (const gap of gaps) {
      const result = guardPause(replacing, live({ successor: placed(gap) }), false)
      expect(result.checks.find((check) => check.label === '新广告在投')?.state).toBe('red')
      expect(result.block).toContain('不全')
    }
  })

  it('still allows a replacement in another ad set of the same campaign', () => {
    const replacing = { ...order, successorAdId: '400' }
    const result = guardPause(replacing, live({ successor: placed({ adsetId: '201' }) }), false)
    expect(result.checks.find((check) => check.label === '新广告在投')?.state).toBe('green')
    expect(result.block).toBeNull()
  })
})

describe('pause orders from a plan or prescription', () => {
  const row = {
    step_id: 'step-1',
    level: 'ad',
    ad_account_id: 'act_42',
    campaign_id: '100',
    adset_id: '200',
    ad_id: '300',
    basis: '这条素材已经过了推广期',
    expected_metric: 'ads.account.cost_per_lead',
    successor_ad_id: '400',
  }

  it('reads an approved plan order and ignores a draft', () => {
    const approved = extractPauseOrders('plan_step', 'plan-1', 'approved', { ad_pause_orders: [row] })
    expect(approved.orders).toHaveLength(1)
    expect(approved.orders[0]?.successorAdId).toBe('400')
    const draft = extractPauseOrders('plan_step', 'plan-1', 'draft', { ad_pause_orders: [row] })
    expect(draft.orders).toHaveLength(0)
  })

  it('reads a prescription action and refuses budget or a missing metric', () => {
    const body = { phases: [{ actions: [{ ...row, id: 'step-9', action_type: 'ads.pause_ad', level: undefined }] }] }
    const found = extractPauseOrders('prescription', 'rx-1', 'approved', body)
    expect(found.orders[0]?.level).toBe('ad')
    const budget = extractPauseOrders('plan_step', 'plan-1', 'approved', { ad_pause_orders: [{ ...row, daily_budget_cents: 100 }] })
    expect(budget.orders).toHaveLength(0)
    expect(budget.blocked[0]?.reason).toContain('不能用来开启或改预算')
    const missing = extractPauseOrders('plan_step', 'plan-1', 'approved', {
      ad_pause_orders: [{ ...row, expected_metric: undefined }],
    })
    expect(missing.orders).toHaveLength(0)
    expect(missing.blocked[0]?.reason).toContain('没有预期指标')
  })

  it('does not invent a metric or a basis', () => {
    const placeholder = extractPauseOrders('plan_step', 'plan-1', 'approved', { ad_pause_orders: [{ ...row, basis: '待定' }] })
    expect(placeholder.orders).toHaveLength(0)
    expect(placeholder.blocked[0]?.reason).toContain('占位')
  })
})
