/**
 * 阶段模型。
 *
 * 这里只有一个真正要命的判断：哪些阶段会让一个人从销售今天的名单上消失。
 * 判错的代价是双向的 —— 该消的没消，销售继续打给已经成交的人；不该消的消了，
 * 付了定金的客人没人催余款，而且他在 ME 里只剩「不在名单上的人」那一个入口。
 */

import { describe, expect, it } from 'vitest'
import {
  stageSuppressesWorklist,
  isMarketingAction,
  actionMeta,
  MARKETING_ACTIONS,
  UNKNOWN_ACTION_META,
} from '../pipeline'

describe('哪些阶段会把人移出今天的名单', () => {
  it('还在谈的人留在名单上', () => {
    expect(stageSuppressesWorklist('nurture', false)).toBe(false)
    expect(stageSuppressesWorklist('defer', false)).toBe(false)
  })

  it('成交 / 转售后 / 停止营销的人移出名单', () => {
    expect(stageSuppressesWorklist('suppress', false)).toBe(true)
    expect(stageSuppressesWorklist('postsale', false)).toBe(true)
    expect(stageSuppressesWorklist('won', false)).toBe(true)
  })

  it('标了「最后一步」的，不管挂什么动作都移出名单', () => {
    expect(stageSuppressesWorklist('nurture', true)).toBe(true)
    expect(stageSuppressesWorklist('defer', true)).toBe(true)
  })

  it('没配阶段的人不受影响', () => {
    expect(stageSuppressesWorklist(null, false)).toBe(false)
    expect(stageSuppressesWorklist(undefined, undefined)).toBe(false)
  })
})

describe('认不出来的动作', () => {
  it('不是合法动作就认不出来', () => {
    expect(isMarketingAction('nurture')).toBe(true)
    expect(isMarketingAction('nope')).toBe(false)
    expect(isMarketingAction(null)).toBe(false)
  })

  it('界面拿到不认识的动作不炸，给中性说明', () => {
    // 将来有人往数据库里加了新动作、前端还没跟上时的兜底。
    expect(actionMeta('brand_new_action')).toBe(UNKNOWN_ACTION_META)
    expect(actionMeta(null).title).toBe(UNKNOWN_ACTION_META.title)
  })
})

describe('给运营看的说明', () => {
  it('每个动作都有中文标题和一句人话，不能漏', () => {
    for (const a of MARKETING_ACTIONS) {
      const m = actionMeta(a)
      expect(m.title.length).toBeGreaterThan(0)
      expect(m.behaviour.length).toBeGreaterThan(0)
      // 界面上不许出现系统内部的英文代号
      expect(m.title).not.toContain(a)
    }
  })

  it('会让人消失在名单上的三个动作，必须在说明里讲出这件事', () => {
    // 运营就是照这句话决定把「已付定金」挂哪一档的。说漏了，
    // 他会以为只是关掉自动邮件，结果销售的通话名单里也不见了这个人。
    for (const a of ['suppress', 'postsale', 'won'] as const) {
      expect(actionMeta(a).behaviour).toContain('名单')
    }
  })
})
