import { beforeEach, describe, expect, it, vi } from 'vitest'

const submitActionRun = vi.hoisted(() => vi.fn())
const runAction = vi.hoisted(() => vi.fn())
vi.mock('@/lib/kernel/runner', () => ({ submitActionRun, runAction }))

import { queueAdsCampaignBudgetDecrease, runQueuedAdsCampaignBudgetDecrease } from '../ads-campaign-budget'

describe('direct campaign budget submission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not queue a budget decrease', async () => {
    const deps = {} as Parameters<typeof queueAdsCampaignBudgetDecrease>[0]
    const access = { ok: true, user: { id: 'auth-user-1' } } as Parameters<typeof queueAdsCampaignBudgetDecrease>[1]['access']

    await expect(queueAdsCampaignBudgetDecrease(deps, {
      clientId: 'client-1',
      access,
      cycleDate: '2026-09-30',
      adAccountId: 'act_1',
      campaignId: 'camp-1',
      afterCents: 100,
      executionItemId: 'item-1',
    })).rejects.toThrow(/closed/)

    expect(submitActionRun).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
  })

  it('does not resume a queued budget decrease', async () => {
    const deps = {} as Parameters<typeof runQueuedAdsCampaignBudgetDecrease>[0]
    await expect(runQueuedAdsCampaignBudgetDecrease(deps, 'client-1', 'run-1')).rejects.toThrow(/closed/)
    expect(submitActionRun).not.toHaveBeenCalled()
    expect(runAction).not.toHaveBeenCalled()
  })
})
