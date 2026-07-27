/**
 * 跟进记录分类。
 *
 * 每一条用例都是 CTS 六周里的真实原话（含原始拼写错误），不是编的。
 * 重点在「别再联系」：漏判一条，下次就有人打给明确说过别打的客户 —— 那是
 * 骚扰，不是准确率问题。所以规则宁可多报，也不交给 AI 决定。
 */

import { describe, expect, it } from 'vitest'
import { classifyNote } from '../note-parser'

const outcome = (s: string) => classifyNote(s).outcome
const dnc = (s: string) => classifyNote(s).do_not_contact

describe('别再联系 —— 一条都不能漏', () => {
  it.each([
    '7.14大瑞更新， 客户明确说了不要电话，只邮件联系',
    '客户直接说不需要联系',
    'do not follow up',
    'do not want to talk about it',
    'indian no need follow up',
    'does not want to talk',
    'follow up with best of china neve been to China but do not like phone call',
    'not intending to go',
  ])('抓到: %s', (note) => {
    expect(dnc(note)).toBe(true)
  })

  it('正常的记录不会被误判成拒绝', () => {
    expect(dnc('good talk')).toBe(false)
    expect(dnc('nice talk and very keen March Best of China')).toBe(false)
    expect(dnc('follow up with Best of China itinerary')).toBe(false)
  })

  it('号码是坏的同时客户也拒绝过，两个信号都要保住', () => {
    const r = classifyNote('invalid mumber do not follow up')
    expect(r.outcome).toBe('bad_number')
    expect(r.do_not_contact).toBe(true)
  })
})

describe('没联系上 —— 占了 CTS 六周的 15%', () => {
  it.each([
    // 主流写法是 message 不是 mail —— 六周里 message 出现 82 次、mail 只有 16 次，
    // 还带各种手误。只匹配 "voice mail" 会漏掉 82 条，等于漏掉大半个漏斗损耗。
    'voice message',
    'voice messsage',
    'voice messge',
    'voice message 9 July',
    'can not leave voice message',
    'voice mail',
    'can not get through',
    'can not go through',
    'cannot reach',
    'no answer',
    'does not answer the phone',
    'home phone no answer',
    'dropped',
    'cut off',
  ])('抓到: %s', (note) => {
    expect(outcome(note)).toBe('no_answer')
  })
})

describe('号码本身是坏的', () => {
  it('认得原始数据里的拼写错误 mumber', () => {
    // Sheet1 里真的是这么拼的，出现 25 次
    expect(outcome('invalid mumber')).toBe('bad_number')
  })

  it('认得 wrong number', () => {
    expect(outcome('wrong number')).toBe('bad_number')
  })
})

describe('其余分类', () => {
  it('聊过但没兴趣', () => {
    expect(outcome('not interested (buddy gone sounds very senoir)')).toBe('not_interested')
    expect(outcome('already booked with another company')).toBe('not_interested')
    expect(outcome('all sorted')).toBe('not_interested')
  })

  it('约了下次', () => {
    expect(outcome('busy call tomorrow 2:30pm')).toBe('callback_set')
    expect(outcome('call after 9am tomorrow 7 JUL')).toBe('callback_set')
    expect(outcome('call in two weeks after back to NZ 13 July')).toBe('callback_set')
    expect(outcome('will call me back')).toBe('callback_set')
  })

  it('真的聊上了', () => {
    expect(outcome('good talk')).toBe('spoke')
    expect(outcome('great talk about 15 days tour')).toBe('spoke')
    expect(outcome('86 years old has been to china')).toBe('spoke')
  })

  it('空记录不装懂', () => {
    expect(outcome('')).toBe('unknown')
    expect(outcome('   ')).toBe('unknown')
  })
})

describe('优先级：坏号码 > 拒绝 > 没接通 > 没兴趣 > 约回电', () => {
  it('没接通的记录不会被里面的 call 字样误判成约了回电', () => {
    // "can not get through" 里没有 call，但真实数据里有混着写的
    expect(outcome('voice mail call tomorrow')).toBe('no_answer')
  })
})

/**
 * AI 层的清洗。第一轮富化 287 条真实记录时，模型交出了这些垃圾：
 * 把客户自己的品牌 CTS 和自家团名 Legacy / Panorama 当成竞品、
 * 把销售的族裔备注 "indian" 当公司、返回字符串 "null"、
 * 把备注末尾的通话日期 "9 July" 当成客户的出行时间。
 * 提示词已经改过，这里是最后一道闸 —— 提示词会漂，代码不会。
 */
import { cleanCompetitorForTest, cleanTravelWindowForTest, cleanNullishForTest } from '../note-parser'

describe('AI 输出清洗', () => {
  it('字符串 "null" 不是值', () => {
    expect(cleanNullishForTest('null')).toBeNull()
    expect(cleanNullishForTest('N/A')).toBeNull()
    expect(cleanNullishForTest('  ')).toBeNull()
    expect(cleanNullishForTest('not specified')).toBeNull()
  })

  it('客户自己的品牌和团名不是竞品', () => {
    expect(cleanCompetitorForTest('CTS')).toBeNull()
    expect(cleanCompetitorForTest('Legacy')).toBeNull()
    expect(cleanCompetitorForTest('Panorama')).toBeNull()
    expect(cleanCompetitorForTest('Best of China')).toBeNull()
  })

  it('族裔不是公司', () => {
    expect(cleanCompetitorForTest('indian')).toBeNull()
  })

  it('没名字的说法留不下情报', () => {
    expect(cleanCompetitorForTest('another company')).toBeNull()
  })

  it('真竞品留下 —— 这条是全批唯一有价值的一条', () => {
    expect(cleanCompetitorForTest('Inspiring Vacations')).toBe('Inspiring Vacations')
  })

  it('过去的年份不可能是出行时间', () => {
    const now = new Date('2026-07-26T00:00:00Z')
    expect(cleanTravelWindowForTest('2023-07-09', now)).toBeNull()
    expect(cleanTravelWindowForTest('2024 年底', now)).toBeNull()
  })

  it('未来的时间留下', () => {
    const now = new Date('2026-07-26T00:00:00Z')
    expect(cleanTravelWindowForTest('明年三月', now)).toBe('明年三月')
    expect(cleanTravelWindowForTest('2027 年三月', now)).toBe('2027 年三月')
  })
})
