/**
 * 「刚才给谁打了电话」这个待办。
 *
 * 每一条都对着一种真实的丢数据方式 —— 而丢数据正是这整套东西要修的病
 * （CTS 的电话记录：Excel 导进来 287 条，ME 自己记下的 3 条）：
 *   ① 过期的待办不能再问 —— 隔了大半天问「刚才那通」，只会收到随手乱点的假结果
 *   ② 认人再清 —— 抽屉里记的是 A，把刚给 B 拨的号清掉就等于弄丢 B 那通电话
 *   ③ localStorage 抛异常不能让「点号码」这件事失败
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingCall,
  clearPendingCallFor,
  getPendingCall,
  markDialled,
} from '../pending-call'

const KEY = 'me:crm:pending-call'

beforeEach(() => {
  window.localStorage.clear()
  clearPendingCall() // 顺带把模块里的快照缓存打掉
  vi.useRealTimers()
})

describe('拨号之后记下待办', () => {
  it('点了号码 → 拿得回这个人', () => {
    markDialled({ contactId: 'c1', name: '张三', phone: '+6421363598' })
    expect(getPendingCall()).toMatchObject({ contactId: 'c1', name: '张三', phone: '+6421363598' })
  })

  it('没拨过号 → 什么都没有', () => {
    expect(getPendingCall()).toBeNull()
  })

  it('拨第二个人 → 只留最后那一通（一个人同时只可能在打一通）', () => {
    markDialled({ contactId: 'c1', name: '张三', phone: '+64211' })
    markDialled({ contactId: 'c2', name: '李四', phone: '+64222' })
    expect(getPendingCall()?.contactId).toBe('c2')
  })
})

describe('太久之前的不再问', () => {
  /**
   * 40 分钟之后再弹出来问「刚才那通怎么样」，人已经想不起是哪一通了 ——
   * 那时候问只会得到一个随手乱点的答案，比不问更糟：假结果会进分批规则，
   * 一个真的聊过的人可能被标成「没打通」，然后一直被重复拨。
   */
  it('拨号超过 40 分钟 → 当作没有', () => {
    markDialled({ contactId: 'c1', name: '张三', phone: '+64211' })
    const stale = new Date(Date.now() - 41 * 60 * 1000).toISOString()
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ contactId: 'c1', name: '张三', phone: '+64211', dialledAt: stale }),
    )
    expect(getPendingCall()).toBeNull()
  })

  it('39 分钟前 → 还问（一通销售电话可以打很久）', () => {
    const fresh = new Date(Date.now() - 39 * 60 * 1000).toISOString()
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ contactId: 'c1', name: '张三', phone: '+64211', dialledAt: fresh }),
    )
    expect(getPendingCall()?.contactId).toBe('c1')
  })

  it('过期的顺手清掉，别让它下次又冒出来', () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ contactId: 'c1', name: '张三', phone: '+64211', dialledAt: stale }),
    )
    getPendingCall()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})

describe('别人记过了就别再问', () => {
  it('抽屉里记的正是这个人 → 待办清掉', () => {
    markDialled({ contactId: 'c1', name: '张三', phone: '+64211' })
    clearPendingCallFor('c1')
    expect(getPendingCall()).toBeNull()
  })

  /** 这一条是护栏：一刀清掉就把刚拨给 c1 的那通电话弄丢了。 */
  it('抽屉里记的是另一个人 → 待办原样留着', () => {
    markDialled({ contactId: 'c1', name: '张三', phone: '+64211' })
    clearPendingCallFor('c2')
    expect(getPendingCall()?.contactId).toBe('c1')
  })
})

describe('存不下也不能让点号码失败', () => {
  /** 隐私模式 / 存储满了，setItem 会抛。记不住就算了，电话必须照样拨出去。 */
  it('localStorage 抛异常 → markDialled 不抛', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => markDialled({ contactId: 'c1', name: '张三', phone: '+64211' })).not.toThrow()
    spy.mockRestore()
  })

  it('存的是坏 JSON → 当作没有，不炸页面', () => {
    window.localStorage.setItem(KEY, '{不是 json')
    expect(getPendingCall()).toBeNull()
  })

  it('存的东西缺字段 → 当作没有', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ name: '张三' }))
    expect(getPendingCall()).toBeNull()
  })
})
