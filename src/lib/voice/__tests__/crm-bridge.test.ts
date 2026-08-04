/**
 * 电话 → CRM。
 *
 * 这层在 2026-08-03 之前**根本不存在**：语音那套打完电话、转写、出摘要，
 * 全存在自己的表里，CRM 一个字都看不到。于是分批规则说的每句话都不准 ——
 * 打通了聊十分钟的人，看板上仍然是「新客人，还没人联系过」。
 *
 * 这里钉的三条，每一条错了都会直接伤到客人或销售：
 *   ① 演练电话绝不进客户的 CRM —— 掺进去的假数据查不出来
 *   ② 通话结果翻错 = 该联系的人消失，或说过别打的人被继续打（合规）
 *   ③ 没接通的电话绝不能算「聊过了」—— 那会把人踢出「还没搭上话」，从此没人碰
 */

import { describe, expect, it } from 'vitest'
import {
  callOutcomeToCrm,
  callSummaryLine,
  counterpartyNumber,
  wasAnswered,
  type BridgeableCall,
} from '../crm-bridge'

function call(over: Partial<BridgeableCall> = {}): BridgeableCall {
  return {
    id: 'call-1',
    direction: 'outbound',
    is_simulated: false,
    from_number: '+6499001122',
    to_number: '+6421363598',
    started_at: '2026-08-03T01:00:00Z',
    ended_at: '2026-08-03T01:06:00Z',
    duration_seconds: 360,
    outcome: 'qualified',
    summary: '想 11 月去南岛，要一份四人报价',
    ...over,
  }
}

describe('电话那头是谁的号码', () => {
  /** 方向决定，不靠猜 —— 猜错会把客户的记录挂到我们自己的号码上。 */
  it('打出去 → 对方是被叫', () => {
    expect(counterpartyNumber(call({ direction: 'outbound' }))).toBe('+6421363598')
  })

  it('打进来 → 对方是主叫', () => {
    expect(counterpartyNumber(call({ direction: 'inbound' }))).toBe('+6499001122')
  })
})

describe('接通了没有', () => {
  it.each([[360], [1]])('通话 %s 秒 → 接通了', (d) => {
    expect(wasAnswered({ duration_seconds: d })).toBe(true)
  })

  it.each([[0], [null]])('通话时长 %s → 没接通', (d) => {
    expect(wasAnswered({ duration_seconds: d })).toBe(false)
  })
})

describe('通话结果翻译成 CRM 的词', () => {
  it.each([
    ['resolved', 'spoke'],
    ['qualified', 'spoke'],
    ['appointment_requested', 'spoke'],
    ['transferred', 'spoke'],
    ['follow_up_required', 'spoke'],
  ])('%s → %s（真的聊上了）', (voice, crm) => {
    expect(callOutcomeToCrm(voice, true)).toBe(crm)
  })

  /** 翻成 bad_number 才会进「号码要修」，等人补一个对的 —— 翻错这人就没了。 */
  it('打错号码 → bad_number', () => {
    expect(callOutcomeToCrm('wrong_number', true)).toBe('bad_number')
  })

  /** 这条是合规：客人在电话里说不要了，翻错他明天照样被打。 */
  it('明确没兴趣 → not_interested', () => {
    expect(callOutcomeToCrm('not_interested', true)).toBe('not_interested')
  })

  it('通话失败 → no_answer，三天内还会让人再试', () => {
    expect(callOutcomeToCrm('failed', true)).toBe('no_answer')
  })

  /**
   * 认不出来的结果不猜成 spoke —— 猜错会让一通没打通的电话把人踢出
   * 「还没搭上话」，那个人从此没人再碰。
   */
  it.each([[null], ['某个以后新加的结果']])('认不出的结果（%s）→ unknown，不猜', (o) => {
    expect(callOutcomeToCrm(o, true)).toBe('unknown')
  })

  describe('没接通的电话', () => {
    /** 无论摘要写了什么，没接通就不能算聊过了。 */
    it.each([['resolved'], ['qualified'], [null]])('结果写着 %s 但没接通 → no_answer', (o) => {
      expect(callOutcomeToCrm(o, false)).toBe('no_answer')
    })

    /** 唯一的例外：号码本身是错的，那跟「没人接」是两回事。 */
    it('号码错了且没接通 → 仍然是 bad_number，不是 no_answer', () => {
      expect(callOutcomeToCrm('wrong_number', false)).toBe('bad_number')
    })
  })
})

describe('卡片上那一行', () => {
  it('打通了 → 说清方向、时长、聊了什么', () => {
    const line = callSummaryLine(call(), true)
    expect(line).toContain('打过去')
    expect(line).toContain('6 分钟')
    expect(line).toContain('南岛')
  })

  it('客人打进来的要说清楚是他找的我们', () => {
    expect(callSummaryLine(call({ direction: 'inbound' }), true)).toContain('客人打进来')
  })

  it('没接通就说没接通，不编时长', () => {
    const line = callSummaryLine(call({ duration_seconds: 0 }), false)
    expect(line).toContain('没接通')
    expect(line).not.toContain('分钟')
  })

  /** 摘要还没生成时**不假装知道聊了什么** —— 空着比编一句强。 */
  it('还没出摘要 → 老实说还没出，不留空白让人误会', () => {
    const line = callSummaryLine(call({ summary: null }), true)
    expect(line).toContain('还没出摘要')
  })

  it('不到一分钟不显示「0 分钟」', () => {
    expect(callSummaryLine(call({ duration_seconds: 25 }), true)).toContain('不到一分钟')
  })
})
