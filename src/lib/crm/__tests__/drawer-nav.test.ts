/**
 * `drawer-nav.ts` —— 每条测试对应 spec §3.3 明确点名的一条判据，
 * 不是随手凑的用例。
 */

import { describe, expect, it } from 'vitest'
import { currentPositionLabel, nextNavStep, type NavInput } from '../drawer-nav'

describe('分段模式', () => {
  const base = (over: Partial<Extract<NavInput, { mode: 'segment' }>> = {}): NavInput => ({
    mode: 'segment',
    direction: 'next',
    loadedIds: ['a', 'b', 'c'],
    currentIndex: 0,
    sectionKey: 'hot',
    sectionTitle: '今天要联系',
    sectionPage: 1,
    perPage: 100,
    sectionTotal: 217,
    nextSection: { key: 'cold', title: '先放着', total: 73 },
    ...over,
  })

  it('还在已加载的这批里 → 直接换人，位置是全局序号（段内页码换算过）', () => {
    const step = nextNavStep(base({ sectionPage: 1, currentIndex: 0, perPage: 100 }))
    expect(step).toEqual({ kind: 'move', contactId: 'b', positionLabel: '今天要联系 · 第 2 位 / 共 217 位' })
  })

  it('跨页的位置换算是对的——第 2 页第 0 个 = 全局第 101 位', () => {
    const step = nextNavStep(base({ sectionPage: 2, currentIndex: 0, perPage: 100 }))
    expect(step).toEqual({ kind: 'move', contactId: 'b', positionLabel: '今天要联系 · 第 102 位 / 共 217 位' })
  })

  it('这一页走完、全段还没完 → need_more，要打开新一页的第一个', () => {
    const step = nextNavStep(base({ currentIndex: 2, sectionPage: 1, sectionTotal: 217, perPage: 100 }))
    expect(step).toEqual({ kind: 'need_more', reason: 'section_next_page', openFirst: true })
  })

  it('🔴 段尾——绝不自动跳下一段，只给消息 + 下一段名字，kind 不是 move', () => {
    // 217 人、每页 100 → 3 页；第 3 页（第 200/201 位起）走到最后一个
    const step = nextNavStep(
      base({ sectionPage: 3, currentIndex: 2, loadedIds: ['x', 'y', 'z'], sectionTotal: 217, perPage: 100 }),
    )
    expect(step.kind).toBe('end_of_section')
    expect((step as { message: string }).message).toContain('217 位看完了')
    expect((step as { message: string }).message).toContain('先放着')
    expect((step as { message: string }).message).toContain('73 位')
  })

  it('已经是最后一段，段尾消息不提"看下一段"', () => {
    const step = nextNavStep(
      base({ sectionPage: 1, currentIndex: 2, sectionTotal: 3, perPage: 100, nextSection: null }),
    )
    expect(step).toEqual({ kind: 'end_of_section', message: '这一段的 3 位看完了 —— 已经是最后一段' })
  })

  it('往前走、不是第 1 页 → need_more 要上一页，openFirst=false（该打开那页最后一个）', () => {
    const step = nextNavStep(base({ direction: 'prev', sectionPage: 2, currentIndex: 0 }))
    expect(step).toEqual({ kind: 'need_more', reason: 'section_next_page', openFirst: false })
  })

  it('往前走、已经是第 1 页第 1 位 → end_of_list，不是 not_in_list', () => {
    const step = nextNavStep(base({ direction: 'prev', sectionPage: 1, currentIndex: 0 }))
    expect(step).toEqual({ kind: 'end_of_list', message: '已经是这一段第一位了' })
  })

  it('currentIndex=-1（人被筛选/搜索掉出列表）→ not_in_list，提示去搜索框找', () => {
    const step = nextNavStep(base({ currentIndex: -1 }))
    expect(step.kind).toBe('not_in_list')
    expect((step as { message: string }).message).toContain('搜索框')
  })
})

describe('平铺模式 —— 不出全局序号', () => {
  const base = (over: Partial<Extract<NavInput, { mode: 'flat' }>> = {}): NavInput => ({
    mode: 'flat',
    direction: 'next',
    loadedIds: ['a', 'b', 'c'],
    currentIndex: 0,
    page: 1,
    totalPages: 3,
    ...over,
  })

  it('还在本页里 → 换人，位置只说"本页"，不说全局总数', () => {
    const step = nextNavStep(base({ currentIndex: 0 }))
    expect(step).toEqual({ kind: 'move', contactId: 'b', positionLabel: '第 2 位 / 本页 3 位' })
    // 🔴 断言反过来的那件事：不出现"共"这个字——那是分段模式才有的全局位置说法。
    expect((step as { positionLabel: string }).positionLabel).not.toContain('共')
  })

  it('走的是传进来的 loadedIds 顺序（调用方已经按"最近联系"客户端重排过），不是另一份顺序', () => {
    // 用一个跟"接口原始顺序"故意不同的 loadedIds，确认函数只认这个参数、不会自己另排一套。
    const step = nextNavStep(base({ loadedIds: ['z', 'y', 'x'], currentIndex: 0 }))
    expect((step as { contactId: string }).contactId).toBe('y')
  })

  it('本页走完、还有下一页 → need_more，要打开新页第一个', () => {
    const step = nextNavStep(base({ currentIndex: 2, page: 1, totalPages: 3 }))
    expect(step).toEqual({ kind: 'need_more', reason: 'flat_next_page', openFirst: true })
  })

  it('本页走完、已经是最后一页 → end_of_list', () => {
    const step = nextNavStep(base({ currentIndex: 2, page: 3, totalPages: 3 }))
    expect(step).toEqual({ kind: 'end_of_list', message: '已经是最后一位了' })
  })

  it('往前走、不是第 1 页 → need_more 要上一页，openFirst=false', () => {
    const step = nextNavStep(base({ direction: 'prev', page: 2, currentIndex: 0 }))
    expect(step).toEqual({ kind: 'need_more', reason: 'flat_prev_page', openFirst: false })
  })

  it('往前走、已经是第 1 页第一位 → end_of_list', () => {
    const step = nextNavStep(base({ direction: 'prev', page: 1, currentIndex: 0 }))
    expect(step).toEqual({ kind: 'end_of_list', message: '已经是第一位了' })
  })

  it('currentIndex=-1 → not_in_list', () => {
    const step = nextNavStep(base({ currentIndex: -1 }))
    expect(step.kind).toBe('not_in_list')
  })
})

describe('currentPositionLabel —— 抽屉打开那一刻就要有值，不等点了一次上一位/下一位', () => {
  it('分段模式：给全局序号（段内页码换算过）', () => {
    const label = currentPositionLabel({
      mode: 'segment',
      direction: 'next',
      loadedIds: ['a', 'b', 'c'],
      currentIndex: 1,
      sectionKey: 'hot',
      sectionTitle: '今天要联系',
      sectionPage: 2,
      perPage: 100,
      sectionTotal: 217,
      nextSection: null,
    })
    // 第 2 页第 1 个（0-based）= 全局第 102 位
    expect(label).toBe('今天要联系 · 第 102 位 / 共 217 位')
  })

  it('平铺模式：只给本页序号，不出现"共"字', () => {
    const label = currentPositionLabel({
      mode: 'flat',
      direction: 'next',
      loadedIds: ['a', 'b', 'c'],
      currentIndex: 0,
      page: 1,
      totalPages: 3,
    })
    expect(label).toBe('第 1 位 / 本页 3 位')
    expect(label).not.toContain('共')
  })

  it('currentIndex=-1（人不在已加载列表里）→ null', () => {
    const label = currentPositionLabel({
      mode: 'flat',
      direction: 'next',
      loadedIds: ['a', 'b', 'c'],
      currentIndex: -1,
      page: 1,
      totalPages: 3,
    })
    expect(label).toBeNull()
  })
})
