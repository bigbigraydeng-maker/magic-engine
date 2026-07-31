/**
 * 「我的客人」这一页的两条判定 —— 都属于「写错了不会报错，只会安静地骗人」那一类：
 *   · 谁带来的：只能顺证据往下退，退到没有就留空，绝不把「从私信进来」升级成「广告带来的」
 *   · 系统建议：人标过了不给、意向不是 high 不给、客户没配这一档不给
 */

import { describe, expect, it } from 'vitest'
import {
  sourceLine,
  suggestStage,
  compareGroups,
  compareByRecency,
  type BoardStage,
} from '../contact-board'

const STAGES: BoardStage[] = [
  { stageKey: 'new', label: '新线索' },
  { stageKey: 'contacted', label: '已联系' },
  { stageKey: 'qualified', label: '真买家' },
]

describe('sourceLine — 谁带来的', () => {
  it('有广告名就用广告名，并标成最高把握度', () => {
    const s = sourceLine({ adName: '30 Kiteroa - Reel A', platform: 'meta', firstChannel: 'messenger' })
    expect(s).toEqual({ text: '30 Kiteroa - Reel A', confidence: 'ad' })
  })

  it('没广告名但有渠道大类 → 退一档，说成「来自 Facebook / Instagram 广告」', () => {
    const s = sourceLine({ adName: null, platform: 'meta', firstChannel: 'messenger' })
    expect(s).toEqual({ text: 'Facebook / Instagram 广告', confidence: 'channel' })
  })

  it('只知道他从私信进来 → 再退一档，绝不说成广告带来的', () => {
    const s = sourceLine({ adName: null, platform: null, firstChannel: 'messenger' })
    expect(s).toEqual({ text: 'Facebook 私信', confidence: 'entry' })
    // 这一条是红线：私信读接口拿不到广告归因，标成 meta 就是编的。
    expect(s?.confidence).not.toBe('ad')
  })

  it('什么都没有 → null（界面留空，不许编一个来源）', () => {
    expect(sourceLine({ adName: null, platform: null, firstChannel: null })).toBeNull()
  })

  it('空字符串 / 全空格当作没有', () => {
    expect(sourceLine({ adName: '   ', platform: '', firstChannel: null })).toBeNull()
  })

  it('没见过的渠道值原样显示，不炸也不留白', () => {
    const s = sourceLine({ adName: null, platform: 'tiktok', firstChannel: null })
    expect(s).toEqual({ text: 'tiktok', confidence: 'channel' })
  })
})

describe('suggestStage — 系统建议', () => {
  it('人还没标 + 系统读到高意向 → 建议「真买家」', () => {
    expect(suggestStage({ currentStage: null, intent: 'high', stages: STAGES })).toEqual({
      toStage: 'qualified',
      label: '真买家',
      why: expect.any(String),
    })
  })

  it('人已经标过了 → 不给建议（人的判断压过系统）', () => {
    expect(suggestStage({ currentStage: 'contacted', intent: 'high', stages: STAGES })).toBeNull()
  })

  it.each(['medium', 'low', 'unknown'] as const)('意向是 %s → 不给建议', (intent) => {
    expect(suggestStage({ currentStage: null, intent, stages: STAGES })).toBeNull()
  })

  it('没有简报（intent 为 null）→ 不给建议', () => {
    expect(suggestStage({ currentStage: null, intent: null, stages: STAGES })).toBeNull()
  })

  it('这个客户压根没配「真买家」这一档 → 不给建议，绝不写进一个不存在的档', () => {
    const noQualified = STAGES.filter((s) => s.stageKey !== 'qualified')
    expect(suggestStage({ currentStage: null, intent: 'high', stages: noQualified })).toBeNull()
  })

  it('用的是客户自己配的名字，不是写死的中文', () => {
    const renamed: BoardStage[] = [{ stageKey: 'qualified', label: '认真看房的' }]
    expect(suggestStage({ currentStage: null, intent: 'high', stages: renamed })?.label).toBe('认真看房的')
  })
})

describe('排序', () => {
  it('「还没挂到房子上」永远垫底', () => {
    const groups = [
      { listingId: null, title: '还没挂到房子上的客人' },
      { listingId: 'l2', title: '30 Kiteroa Road' },
      { listingId: 'l1', title: '12 Bayside Ave' },
    ]
    expect([...groups].sort(compareGroups).map((g) => g.title)).toEqual([
      '12 Bayside Ave',
      '30 Kiteroa Road',
      '还没挂到房子上的客人',
    ])
  })

  it('最近有往来的排前面，完全没往来的垫底', () => {
    const people = [
      { lastTouchAt: null },
      { lastTouchAt: '2026-07-01T00:00:00Z' },
      { lastTouchAt: '2026-07-30T00:00:00Z' },
    ]
    expect([...people].sort(compareByRecency).map((p) => p.lastTouchAt)).toEqual([
      '2026-07-30T00:00:00Z',
      '2026-07-01T00:00:00Z',
      null,
    ])
  })
})
