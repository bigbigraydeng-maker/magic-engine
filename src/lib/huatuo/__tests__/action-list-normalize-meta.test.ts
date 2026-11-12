import { describe, expect, it } from 'vitest'
import { fakeBudgetAction, fakePauseAction } from '@/lib/ads/prescription-action-list'
import { normalizePrescriptionContentWithMeta } from '../agent'

describe('normalizePrescriptionContentWithMeta action_list trim', () => {
  it('records dropped_reason when extras are capped', () => {
    const { content, action_list_dropped_reason } = normalizePrescriptionContentWithMeta({
      summary: 's',
      phases: [],
      kpi_targets: [],
      budget_allocation: [],
      action_list: [
        fakePauseAction(),
        fakePauseAction({ target: { ad_account_id: 'act_FAKE_Z', campaign_id: 'camp_FAKE_Z', adset_id: 'adset_FAKE_Z' } }),
        fakeBudgetAction(),
      ],
    })
    expect(content.action_list).toHaveLength(2)
    expect(action_list_dropped_reason).toContain('已丢弃多余')
    expect(content.pause_ad_set).toBeDefined()
  })

  it('does not mirror budget into a legacy top-level block', () => {
    const { content } = normalizePrescriptionContentWithMeta({
      summary: 's',
      phases: [],
      kpi_targets: [],
      budget_allocation: [],
      action_list: [fakeBudgetAction()],
    })
    expect(content.action_list).toHaveLength(1)
    expect('adjust_adset_daily_budget' in content).toBe(false)
    expect('pause_ad_set' in content).toBe(false)
  })
})
