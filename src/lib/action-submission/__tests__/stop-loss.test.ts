import { beforeEach, describe, expect, it, vi } from 'vitest'

const runAction = vi.hoisted(() => vi.fn())
vi.mock('@/lib/kernel/runner', () => ({ runAction }))

import { submitStopLossThroughKernel } from '../stop-loss'

describe('submitStopLossThroughKernel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runAction.mockImplementation(async (_deps, input) => ({ kind: 'succeeded', run: { id: `run-${input.actionKey}` }, humanReason: null }))
  })

  it('campaign pause submits one authenticated Kernel action, never accepts caller identity', async () => {
    const deps = {} as Parameters<typeof submitStopLossThroughKernel>[0]
    await submitStopLossThroughKernel(deps, {
      clientId: 'client-a', access: { ok: true, user: { id: 'user-a' } } as never,
      goalId: 'goal-a', campaignId: '123456789', adAccountId: 'act_1234567890', cycleDate: '2026-09-30', requestId: 'attempt-1',
      action: 'pause_campaign', targets: [{ id: '123456789', name: 'Campaign', currentCents: 5000 }],
    })
    expect(runAction).toHaveBeenCalledWith(deps, expect.objectContaining({
      actionKey: 'ads.pause_campaign', triggeredBy: 'human', triggeredByRef: 'user-a', goalId: 'goal-a',
      idempotencyNonce: 'attempt-1',
      input: { cycle_date: '2026-09-30', ad_account_id: 'act_1234567890', campaign_id: '123456789' },
    }))
  })

  it('CBO decrease uses campaign action; ABO decreases are submitted serially per unit', async () => {
    const deps = {} as Parameters<typeof submitStopLossThroughKernel>[0]
    const base = {
      clientId: 'client-a', access: { ok: true, user: { id: 'user-a' } } as never,
      goalId: 'goal-a', campaignId: '123456789', adAccountId: 'act_1234567890', cycleDate: '2026-09-30', requestId: 'attempt-2',
    }
    await submitStopLossThroughKernel(deps, { ...base, action: 'cut_campaign', targets: [{ id: '123456789', name: 'Campaign', currentCents: 5000, afterCents: 4000 }] })
    expect(runAction.mock.calls[0][1]).toMatchObject({ actionKey: 'ads.cut_campaign_budget', purpose: 'maintenance', goalId: null, input: { campaign_id: '123456789', after_cents: 4000 } })
    runAction.mockClear()
    await submitStopLossThroughKernel(deps, { ...base, action: 'cut_unit', targets: [
      { id: 'adset-a', name: 'A', currentCents: 5000, afterCents: 4000 },
      { id: 'adset-b', name: 'B', currentCents: 3000, afterCents: 2400 },
    ] })
    expect(runAction).toHaveBeenCalledTimes(2)
    expect(runAction.mock.calls.map(([, input]) => (input as { input: { adset_id: string } }).input.adset_id)).toEqual(['adset-a', 'adset-b'])
  })

  it('returns user-facing warnings from the capability apply result', async () => {
    runAction.mockResolvedValueOnce({
      kind: 'succeeded', run: { id: 'run-cut' }, humanReason: null,
      execution: { steps: [{ step_key: 'apply', output: { status_warning: '广告系列状态已变化，未自动重新开启。' } }] },
    })
    const deps = {} as Parameters<typeof submitStopLossThroughKernel>[0]
    const result = await submitStopLossThroughKernel(deps, {
      clientId: 'client-a', access: { ok: true, user: { id: 'user-a' } } as never,
      campaignId: '123456789', adAccountId: 'act_1234567890', cycleDate: '2026-09-30', requestId: 'attempt-3',
      action: 'cut_campaign', targets: [{ id: '123456789', name: 'Campaign', currentCents: 5000, afterCents: 4000 }],
    })

    expect(result.runs[0]?.warnings).toEqual(['广告系列状态已变化，未自动重新开启。'])
  })
})
