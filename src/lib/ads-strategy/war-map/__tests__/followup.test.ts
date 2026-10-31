import { describe, expect, it } from 'vitest'
import { buildAdjust } from '../actions'
import {
  budgetHoldFor,
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

  it('adds the budget note only when the 24h follow-up rate is below 80% and someone is still waiting', () => {
    const low = adjust(0.5, 2)
    const ok = adjust(0.8, 2)
    const clear = adjust(0.5, 0)
    expect(low.actions.find((a) => a.key.startsWith('opp-O1'))?.how).toContain('先补跟进，暂不建议加预算')
    expect(low.actions.find((a) => a.key.startsWith('growth-'))?.how).toContain('先补跟进，暂不建议加预算')
    expect(ok.actions.some((a) => a.how.includes('先补跟进'))).toBe(false)
    expect(clear.actions.some((a) => a.how.includes('先补跟进'))).toBe(false)
    expect(budgetHoldFor(clearFollowup(0.5, 0))).toBe(false)
    expect(budgetHoldFor(clearFollowup(0.79, 1))).toBe(true)
  })

  it('zero waiting leads is a neutral line, not a 24-hour warning', () => {
    const action = buildFollowupAction(clearFollowup(0.5, 0))
    expect(action.severity).toBe('info')
    expect(action.what).toBe('超过 24 小时的广告线索都有人跟进了')
    expect(action.what).not.toContain('0 条')
  })
})

function clearFollowup(rate: number, waiting: number) {
  return { unreadable: false, groups: [], inWindow: waiting, outsideWindow: 0, rateWithin24h: rate }
}

function adjust(rate: number, waiting = 2) {
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
    followup: clearFollowup(rate, waiting),
  })
}
