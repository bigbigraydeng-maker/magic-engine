import { describe, expect, it } from 'vitest'
import { buildAdjust } from '../actions'
import {
  budgetHoldFromRate,
  buildFollowupAction,
  groupFollowupByAdset,
} from '../followup'
import type { WarMapInput } from '../types'

describe('ad follow-up card', () => {
  it('groups by ad set name and never includes a person name', () => {
    const groups = groupFollowupByAdset(
      [{ adsetId: 'set-a' }, { adsetId: 'set-a' }, { adsetId: 'set-b' }, { adsetId: null }],
      new Map([['set-a', '春季组']]),
    )
    const text = JSON.stringify(groups)
    expect(text).toContain('春季组')
    expect(text).toContain('名称读不到')
    expect(text).toContain('没归到广告组')
    expect(text).not.toContain('王女士')
    const action = buildFollowupAction({
      unreadable: false,
      groups,
      inWindow: 4,
      outsideWindow: 2,
      rateWithin24h: 0.5,
    })
    expect(action.what).toBe('广告线索超过 24 小时没人跟进：4 条，另有更早的 2 条')
    expect(action.how).not.toContain('set-a')
  })

  it('adds the budget note only when the 24h follow-up rate is below 80%', () => {
    expect(budgetHoldFromRate(0.8)).toBe(false)
    expect(budgetHoldFromRate(null)).toBe(false)
    expect(budgetHoldFromRate(0.79)).toBe(true)
    const low = adjust(0.5)
    const ok = adjust(0.8)
    expect(low.actions.find((a) => a.key.startsWith('opp-O1'))?.how).toContain('先补跟进，暂不建议加预算')
    expect(low.actions.find((a) => a.key.startsWith('growth-'))?.how).toContain('先补跟进，暂不建议加预算')
    expect(ok.actions.some((a) => a.how.includes('先补跟进'))).toBe(false)
  })
})

function adjust(rate: number) {
  const input = {
    now: '2026-10-16T03:00:00.000Z',
    creativePoolApproved: 3,
    growth: {
      date: '2026-10-16',
      goalTitle: null,
      paceReason: null,
      problems: [{ code: 'X1', title: '这一组可以加预算', how: '先看花费' }],
      opportunities: [{ code: 'O1', title: '这条素材还可以加力' }],
    },
  } as WarMapInput
  return buildAdjust({
    input,
    accounts: [{ adAccountId: 'act', name: '账户', statusCode: 1, capturedAt: null, light: 'green', sentence: '正常' }],
    poolRows: [],
    videoPoolIds: new Set(),
    frequencyRows: [],
    upstream: [],
    dataDay: '2026-10-16',
    staleDays: 0,
    followup: { unreadable: false, groups: [], inWindow: 0, outsideWindow: 0, rateWithin24h: rate },
  })
}
