import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitActionRun = vi.hoisted(() => vi.fn())
vi.mock('@/lib/kernel/runner', () => ({ submitActionRun }))

import { queueAdsCampaignBudgetDecrease } from '../ads-campaign-budget'

describe('queueAdsCampaignBudgetDecrease', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists the authenticated human request as a Kernel run before dispatch', async () => {
    submitActionRun.mockResolvedValue({ run: { id: 'run-1' }, existing: false })
    const deps = {} as Parameters<typeof queueAdsCampaignBudgetDecrease>[0]
    const access = { ok: true, user: { id: 'auth-user-1' } } as Parameters<typeof queueAdsCampaignBudgetDecrease>[1]['access']

    await queueAdsCampaignBudgetDecrease(deps, {
      clientId: 'client-1',
      access,
      cycleDate: '2026-09-30',
      adAccountId: 'act_1234567890',
      campaignId: '987654321',
      afterCents: 4_000,
      executionItemId: 'item-1',
    })

    expect(submitActionRun).toHaveBeenCalledWith(deps, {
      clientId: 'client-1',
      actionKey: 'ads.cut_campaign_budget',
      purpose: 'maintenance',
      executionItemId: 'item-1',
      triggeredBy: 'human',
      triggeredByRef: 'auth-user-1',
      rationale: '从广告执行看板提交广告系列日预算下调',
      evidence: { source: 'meta-ads/execute' },
      input: {
        cycle_date: '2026-09-30',
        ad_account_id: 'act_1234567890',
        campaign_id: '987654321',
        after_cents: 4_000,
      },
    })
  })
})
