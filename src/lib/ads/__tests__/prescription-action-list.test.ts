import { describe, expect, it } from 'vitest'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import {
  attachPrescriptionActionList,
  fakeBudgetAction,
  fakePauseAction,
  parsePrescriptionActionList,
} from '../prescription-action-list'
import type { PrescriptionContent } from '@/types/diagnostic'

function baseContent(): PrescriptionContent {
  return {
    summary: '测试处方',
    phases: [],
    kpi_targets: [],
    budget_allocation: [],
  }
}

describe('parsePrescriptionActionList', () => {
  it('accepts one pause and one budget with fake ids', () => {
    const pause = fakePauseAction()
    const budget = fakeBudgetAction()
    const out = parsePrescriptionActionList([pause, budget])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.action_list).toHaveLength(2)
    expect(out.dropped_reason).toBeNull()
  })

  it('drops extras beyond one pause and one budget', () => {
    const out = parsePrescriptionActionList([
      fakePauseAction(),
      fakePauseAction({ target: { ad_account_id: 'act_FAKE_X', campaign_id: 'camp_FAKE_X', adset_id: 'adset_FAKE_X' } }),
      fakeBudgetAction(),
      fakeBudgetAction({ proposed_daily_budget_cents: 9_900 }),
    ])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.action_list.map((a) => a.type)).toEqual([
      ADS_ACTION_TYPE.PAUSE_AD_SET,
      ADS_ACTION_TYPE.ADJUST_ADSET_DAILY_BUDGET,
    ])
    expect(out.dropped_reason).toContain('已丢弃多余 2 条')
  })

  it('rejects invalid shapes', () => {
    expect(parsePrescriptionActionList({}).ok).toBe(false)
    expect(parsePrescriptionActionList([{ type: 'ads.pause_campaign' }]).ok).toBe(false)
    expect(parsePrescriptionActionList([fakePauseAction({ observation_days: 0 })]).ok).toBe(false)
  })
})

describe('attachPrescriptionActionList', () => {
  it('mirrors pause into legacy pause_ad_set when absent', () => {
    const pause = fakePauseAction()
    const attached = attachPrescriptionActionList({
      ...baseContent(),
      action_list: [pause],
    })
    expect(attached.pause_ad_set).toMatchObject({
      ad_account_id: 'act_FAKE_A',
      adset_id: 'adset_FAKE_A',
      direction: 'pause',
      basis: pause.reason,
    })
  })

  it('removes invalid action_list instead of persisting it', () => {
    const attached = attachPrescriptionActionList({
      ...baseContent(),
      action_list: [{ type: ADS_ACTION_TYPE.PAUSE_AD_SET }],
    })
    expect(attached.action_list).toBeUndefined()
  })
})
