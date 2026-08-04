/**
 * 「这一笔是人做的，还是机器发的」。
 *
 * 判错的代价是不对称的：把机器发的算成人跟过 → 销售看到一片灰卡，以为活做完了，
 * 而那些人一个电话都没接到。反过来只是让一张卡多留一天。
 * 所以这里钉的是「拿不准就算人没跟过」。
 */

import { describe, expect, it } from 'vitest'
import { isAutomatedTouch } from '../automated-touch'

describe('按来源', () => {
  it('群发工具写出来的整类是机器发的', () => {
    expect(isAutomatedTouch('mailchimp', null)).toBe(true)
  })

  /** 销售手打的电话记录 —— 这就是「人跟过」本身，认错它整套分级都塌了。 */
  it('人手记的电话不是机器发的', () => {
    expect(isAutomatedTouch('me_manual', null)).toBe(false)
  })

  /**
   * 邮件不整类拉黑：info@ 的已发送里绝大多数是同事真的在回信。
   * 整类拉黑等于把「我们回过这个客人」全部抹掉。
   */
  it('邮箱同步不整类拉黑 —— 大部分已发送是同事真的在回信', () => {
    expect(isAutomatedTouch('microsoft_mail', { subject: 'Re: 想问一下行程' })).toBe(false)
  })
})

describe('按标记', () => {
  it('写入方标了 automated → 认', () => {
    expect(isAutomatedTouch('microsoft_mail', { automated: true })).toBe(true)
  })

  it('标了 false → 是人做的', () => {
    expect(isAutomatedTouch('microsoft_mail', { automated: false })).toBe(false)
  })

  /** 拿不准一律当「人没跟过」—— 多留一张卡，比埋掉一个热线索便宜。 */
  it.each([
    ['没有这个字段', {}],
    ['字符串 "true"', { automated: 'true' }],
    ['数字 1', { automated: 1 }],
    ['null', { automated: null }],
  ])('%s → 不当成机器发的', (_label, metadata) => {
    expect(isAutomatedTouch('microsoft_mail', metadata as Record<string, unknown>)).toBe(false)
  })

  it('没有 metadata 也不炸', () => {
    expect(isAutomatedTouch('microsoft_mail', null)).toBe(false)
    expect(isAutomatedTouch(null, undefined)).toBe(false)
  })

  /** 来源整类拉黑优先 —— 群发那一笔不会因为没标 automated 而被当成人做的。 */
  it('来源已经是机器发的，就算没标 automated 也算', () => {
    expect(isAutomatedTouch('mailchimp', { automated: false })).toBe(true)
  })
})
