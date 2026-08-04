import { describe, it, expect } from 'vitest'
import { newSeedKeywords, mergedSeedKeywords, shouldBackfillSeeds } from '../seed-keywords'
import type { DiscoveredKeyword } from '../types'

function kw(keyword: string, type: DiscoveredKeyword['type'] = 'category'): DiscoveredKeyword {
  return { keyword, type, rationale: 'because' }
}

describe('newSeedKeywords', () => {
  it('🔴 已经在 brief 里的词绝不重复加 —— 这是「不覆盖人工维护」的那道闸', () => {
    expect(
      newSeedKeywords([kw('chinese real estate agent auckland')], ['chinese real estate agent auckland']),
    ).toEqual([])
  })

  it('🔴 大小写和空格不同也算同一个词，否则会堆出一串看着不一样的重复词', () => {
    expect(newSeedKeywords([kw('  Physio Auckland  ')], ['physio auckland'])).toEqual([])
  })

  it('同一批里重复出现的词只进一次（agent 会把一个词同时归到两个类型）', () => {
    expect(newSeedKeywords([kw('physio auckland', 'category'), kw('physio auckland', 'local')], [])).toEqual([
      'physio auckland',
    ])
  })

  it('只带回真正新的词，按发现顺序', () => {
    expect(newSeedKeywords([kw('old one'), kw('new one'), kw('another new')], ['old one'])).toEqual([
      'new one',
      'another new',
    ])
  })

  it('空词、空白词、缺字段的词都丢掉，不写脏数据', () => {
    expect(newSeedKeywords([kw(''), kw('   '), { type: 'brand', rationale: 'x' } as DiscoveredKeyword], [])).toEqual([])
  })

  it('没有发现结果 / 字段缺失时安全返回空', () => {
    expect(newSeedKeywords(null, ['keep me'])).toEqual([])
    expect(newSeedKeywords(undefined, undefined)).toEqual([])
  })
})

describe('mergedSeedKeywords', () => {
  it('🔴 原有的词一个都不许少 —— 这个函数的结果会整段覆盖 keyword_seeds', () => {
    const result = mergedSeedKeywords([kw('brand new')], ['hand picked a', 'hand picked b'])
    expect(result).toEqual(['hand picked a', 'hand picked b', 'brand new'])
  })

  it('🔴 FDE 手写的大小写原样保留 —— 确认一次发现报告不许静默改写人工填的字段', () => {
    expect(mergedSeedKeywords([kw('new one')], ['Oztop Building Supplies', 'SPC Flooring'])).toEqual([
      'Oztop Building Supplies',
      'SPC Flooring',
      'new one',
    ])
  })

  it('大小写只用于比对：已存在的词不会因为大小写不同被当成新词加进去', () => {
    expect(mergedSeedKeywords([kw('oztop building supplies')], ['Oztop Building Supplies'])).toEqual([
      'Oztop Building Supplies',
    ])
  })

  it('没有新词时原样返回，不制造无意义的写入内容变化', () => {
    expect(mergedSeedKeywords([kw('existing')], ['existing'])).toEqual(['existing'])
  })
})

// 「确认发现」那颗按钮在已确认之后仍然挂在页面上、随时可点
// （zhangqian/page.tsx 的 confirmed 分支里还渲染着同一个 onConfirm）。
// 所以重复点击必须**不能**把 FDE 删掉的词加回来 —— 只有「简报是确认之后才建的」
// 这一种情况才是真的补漏。
describe('shouldBackfillSeeds', () => {
  it('首次确认（还没盖过章）—— 直接写', () => {
    expect(shouldBackfillSeeds({ confirmedAt: null, briefCreatedAt: '2026-07-01T00:00:00Z' })).toBe(true)
    expect(shouldBackfillSeeds({ confirmedAt: undefined, briefCreatedAt: null })).toBe(true)
  })

  it('🔴 重复确认 + 简报早于确认 → 不写。FDE 删掉的词不许被复活', () => {
    expect(
      shouldBackfillSeeds({
        confirmedAt: '2026-07-19T00:00:00Z',
        briefCreatedAt: '2026-07-01T00:00:00Z',
      }),
    ).toBe(false)
  })

  it('重复确认 + 简报是确认之后才建的 → 写。这才是真正要补的那 3 个客户', () => {
    expect(
      shouldBackfillSeeds({
        confirmedAt: '2026-07-19T00:00:00Z',
        briefCreatedAt: '2026-07-25T00:00:00Z',
      }),
    ).toBe(true)
  })

  it('🔴 拿不到简报建立时间 → 不写。证不出是补漏就别碰人家的字段', () => {
    expect(shouldBackfillSeeds({ confirmedAt: '2026-07-19T00:00:00Z', briefCreatedAt: null })).toBe(false)
  })

  it('时间完全相同不算「之后」，不写', () => {
    const t = '2026-07-19T00:00:00Z'
    expect(shouldBackfillSeeds({ confirmedAt: t, briefCreatedAt: t })).toBe(false)
  })
})
