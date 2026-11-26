/**
 * 「别再联系」到底成不成立。
 *
 * 🔴 这是系统里最重的一个标记：成立 = **任何渠道都不许再发**。
 *
 * 早前的判词把「not intending to go」（我不打算去）当成了「别再联系我」，
 * 被误判的人从此收不到我们任何消息。而在这份判据存在之前，取消客户档案上
 * 那个勾**没有用**（判据看的是触点），系统里也没有取消入口 ——
 * 「这个人判错了」是一件没人做得到的事。
 */

import { describe, expect, it } from 'vitest'
import { dncClearedAt, isDoNotCall, isDoNotContact, withoutClearedDnc, DNC_CLEARED_OUTCOME, DO_NOT_CALL_OUTCOME } from '../dnc'

const at = (d: string) => `2026-08-${d}T00:00:00Z`
const cleared = (d: string) => ({ outcome: DNC_CLEARED_OUTCOME, occurredAt: at(d) })

describe('说过别再联系的，一条都不许漏', () => {
  it('触点里说过 → 算', () => {
    expect(isDoNotContact(false, [{ outcome: 'do_not_contact', occurredAt: at('01') }])).toBe(true)
  })

  it('历史导入只写了 metadata.do_not_contact → 也算', () => {
    expect(isDoNotContact(false, [{ flagged: true, occurredAt: at('01') }])).toBe(true)
  })

  /** contacts 那一列是反规范化的镜像，写失败过 —— 但说是就得认。 */
  it('只有 contacts 那一列说是 → 也算', () => {
    expect(isDoNotContact(true, [])).toBe(true)
  })

  it('谁都没说过 → 不算', () => {
    expect(isDoNotContact(false, [{ outcome: 'spoke', occurredAt: at('01') }])).toBe(false)
  })
})

describe('人明确纠正过「这条判错了」', () => {

  it('纠正晚于那条误判 → 这个人回到名单上', () => {
    expect(
      isDoNotContact(false, [{ outcome: 'do_not_contact', occurredAt: at('01') }, cleared('02')]),
    ).toBe(false)
  })

  /**
   * 🔴 连 contacts 那一列都不算数 —— 纠正的人看过原话，
   * 而那一列很可能正是当初被误判时写上去的。不这样的话「取消」按钮点了没用。
   */
  it('纠正之后，contacts 那一列说是也不算数', () => {
    expect(
      isDoNotContact(true, [{ outcome: 'do_not_contact', occurredAt: at('01') }, cleared('02')]),
    ).toBe(false)
  })

  /** 纠正之后客人**又**说了别再联系 —— 以最后一次为准，重新算数。 */
  it('纠正之后他又说了别再联系 → 重新算数', () => {
    expect(
      isDoNotContact(false, [
        { outcome: 'do_not_contact', occurredAt: at('01') },
        cleared('02'),
        { outcome: 'do_not_contact', occurredAt: at('03') },
      ]),
    ).toBe(true)
  })

  /** 纠正**早于**那条拒联 —— 说明后来他真的说了，不许放回来。 */
  it('纠正早于那条拒联 → 仍然算数', () => {
    expect(
      isDoNotContact(false, [cleared('01'), { outcome: 'do_not_contact', occurredAt: at('02') }]),
    ).toBe(true)
  })
})

/**
 * 光让 `isDoNotContact()` 返回 false 不够 —— 那条误判的触点还在库里，而分段
 * 逻辑看的是触点上的结果值。分段那边不跟着作废，就会出现最坏的一种结局：
 * 黄条消失了、人工任务也不再冒出来，人却照样不回名单，且再没有按钮能处理他。
 */
describe('纠正的时间点要给分段用', () => {
  it('没纠正过 → 0', () => {
    expect(dncClearedAt([{ outcome: 'do_not_contact', occurredAt: at('01') }])).toBe(0)
  })

  it('纠正过 → 那一刻', () => {
    expect(dncClearedAt([cleared('02')])).toBe(new Date(at('02')).getTime())
  })

  it('纠正过多次 → 取最后一次', () => {
    expect(dncClearedAt([cleared('02'), cleared('05')])).toBe(new Date(at('05')).getTime())
  })

  it('时间戳是坏的不许算成「刚刚纠正过」', () => {
    expect(dncClearedAt([{ outcome: 'dnc_cleared', occurredAt: 'not-a-date' }])).toBe(0)
  })
})

/**
 * 谁拿触点上的 `outcome` 做判断，谁就得先过这一道。已经踩过两次：分段看到它
 * 判 excluded；今日名单的「建议改到停止营销」看到它，会**立刻建议把刚纠正过的
 * 人再埋一次** —— FDE 顺手一点，白干。
 */
describe('把被推翻过的拒联触点滤掉', () => {
  const dnc = (d: string) => ({ outcome: 'do_not_contact', occurredAt: at(d) })

  it('没纠正过 → 原样返回', () => {
    expect(withoutClearedDnc([dnc('01')])).toHaveLength(1)
  })

  it('纠正晚于它 → 滤掉', () => {
    expect(withoutClearedDnc([dnc('01'), cleared('02')]).map((t) => t.outcome)).toEqual([
      'dnc_cleared',
    ])
  })

  it('纠正早于它 → 留着，后来他真的说了', () => {
    expect(withoutClearedDnc([cleared('01'), dnc('02')])).toHaveLength(2)
  })

  it('🔴 只滤「别再联系」—— 没资格替客人收回「我不买了」', () => {
    const kept = withoutClearedDnc([
      { outcome: 'not_interested', occurredAt: at('01') },
      cleared('02'),
    ])
    expect(kept.map((t) => t.outcome)).toContain('not_interested')
  })
})

describe('只别打电话（do_not_call）—— 只拦电话，不拦邮件', () => {
  const noCall = (d: string) => ({ outcome: DO_NOT_CALL_OUTCOME, occurredAt: at(d) })

  it('说过不要电话 → 不能打电话', () => {
    expect(isDoNotCall(false, [noCall('01')])).toBe(true)
  })

  it('🔴 只说过不要电话 → 不算「别再联系」（邮件照常能发）', () => {
    expect(isDoNotContact(false, [noCall('01')])).toBe(false)
  })

  it('之后被人放回电话名单（更晚的 dnc_cleared）→ 又能打了', () => {
    expect(isDoNotCall(false, [noCall('01'), cleared('02')])).toBe(false)
  })

  it('放回之后客人又说不要电话 → 又不能打', () => {
    expect(isDoNotCall(false, [noCall('01'), cleared('02'), noCall('03')])).toBe(true)
  })

  it('清除和不要电话同一时刻 → 宁可不打', () => {
    expect(isDoNotCall(false, [noCall('02'), cleared('02')])).toBe(true)
  })

  it('不要电话那条时间读不出来 → 清除证明不了更晚，宁可不打', () => {
    expect(isDoNotCall(false, [{ outcome: DO_NOT_CALL_OUTCOME, occurredAt: 'not-a-date' }, cleared('02')])).toBe(true)
  })

  it('清除那条时间读不出来 → 不算推翻', () => {
    expect(isDoNotCall(false, [noCall('01'), { outcome: DNC_CLEARED_OUTCOME, occurredAt: '' }])).toBe(true)
  })

  it('全面拒绝（别再联系）一定也不能打电话', () => {
    expect(isDoNotCall(true, [])).toBe(true)
    expect(isDoNotCall(false, [{ outcome: 'do_not_contact', occurredAt: at('01') }])).toBe(true)
    expect(isDoNotCall(false, [{ flagged: true, occurredAt: at('01') }])).toBe(true)
  })

  it('谁都没说过 → 能打', () => {
    expect(isDoNotCall(false, [])).toBe(false)
    expect(isDoNotCall(false, [{ outcome: 'spoke', occurredAt: at('01') }])).toBe(false)
  })

  it('withoutClearedDnc 对 do_not_contact 的行为不变', () => {
    const tps = [{ outcome: 'do_not_contact', occurredAt: at('01') }, noCall('01'), cleared('02')]
    expect(withoutClearedDnc(tps).map((t) => t.outcome)).toEqual([DO_NOT_CALL_OUTCOME, DNC_CLEARED_OUTCOME])
  })
})
