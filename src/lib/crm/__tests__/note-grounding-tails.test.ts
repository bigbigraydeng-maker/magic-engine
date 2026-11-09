/**
 * 员工笔记「不许编」闸的三个已知口子（PR #3417 复审遗留）：
 *   1. 「千」没换算：「预算三千」被改写成「预算五千」能过
 *   2. 别名 / 昵称地名没查：魔都、帝都、长城被改成九寨沟能过；dalian 被当成 Dali
 *   3. 英文笔记被翻成中文后丢了出行时间：「next March」→「明年三月」
 * 判不准的一律退回员工原话。
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: () => ({ responses: { create: vi.fn() } }),
}))

import { cnNumeralsToArabic, firstUngroundedClaim, groundNoteParse } from '../note-grounding'
import type { NoteParse } from '../note-parser'

const BASE: NoteParse = {
  outcome: 'spoke',
  do_not_contact: false,
  travel_window: null,
  tour_interest: null,
  competitor: null,
  callback_at: null,
  mentioned_next_step: false,
  summary: '',
}

const ground = (note: string, over: Partial<NoteParse>) => groundNoteParse(note, { ...BASE, ...over })

describe('口子 1：「千 / 百 / 万」要换算成数字再比', () => {
  it('换算结果', () => {
    expect(cnNumeralsToArabic('预算三千')).toBe('预算3000')
    expect(cnNumeralsToArabic('三千五')).toBe('3500')
    expect(cnNumeralsToArabic('两万')).toBe('20000')
    expect(cnNumeralsToArabic('一万二千')).toBe('12000')
    expect(cnNumeralsToArabic('3千')).toBe('3000')
    expect(cnNumeralsToArabic('两百')).toBe('200')
    // 没有千百万的老写法不受影响
    expect(cnNumeralsToArabic('两个人，三月，十二天')).toBe('2人，3月，12天')
  })

  it('「预算三千」被改写成「预算五千」→ 拦，退回原话', () => {
    expect(firstUngroundedClaim('客户预算五千。', '预算三千')).not.toBeNull()
    expect(ground('预算三千', { summary: '客户预算五千。' }).summary).toBe('预算三千')
  })

  it('改写对得上就放行：三千 / 3000 / 3千 互通', () => {
    expect(firstUngroundedClaim('客户预算三千。', '预算三千')).toBeNull()
    expect(firstUngroundedClaim('客户预算3000。', '预算三千')).toBeNull()
    expect(firstUngroundedClaim('客户预算三千。', 'budget 3000')).toBeNull()
    expect(firstUngroundedClaim('客户预算3千。', '预算三千')).toBeNull()
  })
})

describe('口子 2：别名 / 昵称地名也要有依据', () => {
  it.each([
    ['魔都'],
    ['帝都'],
    ['长城'],
  ])('原话写「%s」，摘要改成九寨沟 → 拦，退回原话', (word) => {
    const note = `客户想去${word}`
    expect(firstUngroundedClaim('客户想去九寨沟。', note)).not.toBeNull()
    expect(ground(note, { summary: '客户想去九寨沟。' }).summary).toBe(note)
  })

  it('摘要里冒出别名，原话完全没有 → 拦', () => {
    expect(firstUngroundedClaim('客户想去魔都。', '客户想去九寨沟')).not.toBeNull()
    expect(firstUngroundedClaim('客户想去帝都。', 'wants to see the Great Wall')).not.toBeNull()
  })

  it('别名和正名互通：原话「魔都」，摘要「上海」放行；原话 Shanghai，摘要「魔都」放行', () => {
    expect(firstUngroundedClaim('客户想去上海。', '客户想去魔都')).toBeNull()
    expect(firstUngroundedClaim('客户想去北京。', '客户想去帝都')).toBeNull()
    expect(firstUngroundedClaim('客户想去魔都。', 'wants to visit Shanghai')).toBeNull()
  })

  it('原话写长城 / Great Wall，摘要写长城 → 放行；九寨沟原话对九寨沟摘要 → 放行', () => {
    expect(firstUngroundedClaim('客户想看长城。', 'wants the Great Wall')).toBeNull()
    expect(firstUngroundedClaim('客户想去九寨沟。', 'interested in Jiuzhaigou')).toBeNull()
  })

  it('dalian 不是 Dali', () => {
    expect(firstUngroundedClaim('客户想去大理。', 'wants to visit Dalian')).not.toBeNull()
    expect(firstUngroundedClaim('客户想去大连。', 'wants to visit Dalian')).toBeNull()
    expect(firstUngroundedClaim('客户想去大理。', 'wants to visit Dali and Lijiang')).toBeNull()
  })
})

describe('口子 3：英文「next / this + 月份」翻成「明年 / 今年 + 月」不丢出行时间', () => {
  it('「wants to travel next March」→「明年三月」保留', () => {
    const g = ground('wants to travel next March', { travel_window: '明年三月', summary: '客户想明年三月出行。' })
    expect(g.travel_window).toBe('明年三月')
    expect(g.summary).toBe('客户想明年三月出行。')
  })

  it('「this June」→「今年六月」保留', () => {
    expect(ground('keen to go this June', { travel_window: '今年六月', summary: '客户想今年六月去。' }).travel_window).toBe('今年六月')
  })

  it('月份对不上仍然置空：next March 不能变成明年五月', () => {
    expect(ground('wants to travel next March', { travel_window: '明年五月', summary: '客户想明年五月出行。' }).travel_window).toBeNull()
  })

  it('原话没有任何「明年 / next」，摘要却写明年 → 仍然拦', () => {
    expect(ground('wants to travel in March', { travel_window: '明年三月', summary: '客户想明年三月出行。' }).travel_window).toBeNull()
    expect(firstUngroundedClaim('客户想明年出行。', 'wants to travel')).not.toBeNull()
  })

  it('may 是情态动词时不当月份：「next may call」不能证明明年', () => {
    expect(firstUngroundedClaim('客户明年出行。', 'next may call back')).not.toBeNull()
  })
})
