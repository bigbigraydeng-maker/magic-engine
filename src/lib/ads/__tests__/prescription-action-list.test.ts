import { describe, expect, it } from 'vitest'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import {
  attachPrescriptionActionList,
  fakeBudgetAction,
  fakePauseAction,
  parsePrescriptionActionList,
  pauseCardOrderFromAction,
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
  it('keeps a pause row on the new pause-card order and does not write pause_ad_set', () => {
    const pause = fakePauseAction()
    const attached = attachPrescriptionActionList({
      ...baseContent(),
      action_list: [pause],
    })
    expect(attached.action_list?.[0]?.type).toBe(ADS_ACTION_TYPE.PAUSE_AD_SET)
    expect('pause_ad_set' in attached).toBe(false)
    const order = pauseCardOrderFromAction('rx-fake', 1, pause)
    expect(order.ok).toBe(true)
    if (!order.ok) return
    expect(order.order.direction).toBe('pause')
    expect(order.order.adsetId).toBe('adset_FAKE_A')
    expect(order.order.basis).toBe(pause.reason)
  })

  it('removes invalid action_list instead of persisting it', () => {
    const attached = attachPrescriptionActionList({
      ...baseContent(),
      action_list: [{ type: ADS_ACTION_TYPE.PAUSE_AD_SET }],
    })
    expect(attached.action_list).toBeUndefined()
  })
})
