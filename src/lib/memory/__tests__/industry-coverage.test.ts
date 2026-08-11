import { describe, it, expect } from 'vitest'
import { summariseIndustryCoverage, type ClientIndustryRow } from '../industry-coverage'

const KNOWN = ['real_estate', 'travel', 'building_supplies', 'healthcare', 'immigration']

const c = (name: string, industry: string | null): ClientIndustryRow => ({
  clientId: name, clientName: name, industry,
})

describe('summariseIndustryCoverage', () => {
  it('规范值 + 该行业有经验 → 能读到', () => {
    const s = summariseIndustryCoverage([c('Roman', 'real_estate')], KNOWN, { real_estate: 3 })
    expect(s.clients[0].status).toBe('canonical')
    expect(s.clients[0].readableLessons).toBe(3)
  })

  it('🔴 自由文本 → 永远匹配不上，读到 0 条', () => {
    const s = summariseIndustryCoverage(
      [c('Trade Plus', 'SPC/hybrid flooring wholesale (B2B trade)')],
      KNOWN, { building_supplies: 5 },
    )
    expect(s.clients[0].status).toBe('free_text')
    expect(s.clients[0].readableLessons).toBe(0)
    expect(s.clients[0].note).toContain('永远命中不了')
  })

  it('🔴 Oztop 的实际情况：填 flooring，词表里是 building_supplies → 匹配不上', () => {
    const s = summariseIndustryCoverage([c('oztop', 'flooring')], KNOWN, { building_supplies: 5 })
    expect(s.clients[0].status).toBe('free_text')
    expect(s.clients[0].readableLessons).toBe(0)
  })

  it('没填 → 只能读全局/渠道层', () => {
    const s = summariseIndustryCoverage([c('smiledental', null)], KNOWN, {})
    expect(s.clients[0].status).toBe('missing')
    expect(s.clients[0].note).toContain('只能读到全局/渠道层')
  })

  it('空白字符串等同没填', () => {
    expect(summariseIndustryCoverage([c('x', '   ')], KNOWN, {}).clients[0].status).toBe('missing')
  })

  it('大小写/空格归一 —— 跟取数侧同一套规则', () => {
    const s = summariseIndustryCoverage([c('x', '  Real_Estate ')], KNOWN, { real_estate: 2 })
    expect(s.clients[0].status).toBe('canonical')
    expect(s.clients[0].readableLessons).toBe(2)
  })

  it('行业填对但该行业还没经验 → 说清楚是「还没攒」不是「读不到」', () => {
    const s = summariseIndustryCoverage([c('x', 'travel')], KNOWN, {})
    expect(s.clients[0].status).toBe('canonical')
    expect(s.clients[0].note).toContain('还没攒下')
  })
})

describe('孤儿行业 —— 攒了经验却没人读', () => {
  it('🔴 有经验但没有任何客户挂在这个行业上 → 标出来', () => {
    const s = summariseIndustryCoverage([c('Roman', 'real_estate')], KNOWN, {
      real_estate: 3, healthcare: 2,
    })
    expect(s.orphanIndustries).toEqual(['healthcare'])
  })

  it('0 条经验的行业不算孤儿（本来就没攒）', () => {
    const s = summariseIndustryCoverage([c('Roman', 'real_estate')], KNOWN, {
      real_estate: 3, healthcare: 0,
    })
    expect(s.orphanIndustries).toEqual([])
  })

  it('自由文本客户不算「占用了」那个行业 —— 它其实读不到', () => {
    const s = summariseIndustryCoverage([c('x', 'Healthcare — Physiotherapy')], KNOWN, { healthcare: 2 })
    expect(s.orphanIndustries).toEqual(['healthcare'])
  })
})

describe('汇总与排序', () => {
  const CLIENTS = [
    c('正常A', 'real_estate'),
    c('正常B', 'travel'),
    c('没填', null),
    c('自由文本', 'Travel — Tour Operator'),
  ]

  it('三类计数对得上', () => {
    const s = summariseIndustryCoverage(CLIENTS, KNOWN, {})
    expect(s.total).toBe(4)
    expect(s.canonical).toBe(2)
    expect(s.freeText).toBe(1)
    expect(s.missing).toBe(1)
  })

  it('🔴 问题最大的排最前：自由文本 → 没填 → 正常', () => {
    const s = summariseIndustryCoverage(CLIENTS, KNOWN, {})
    expect(s.clients.map(r => r.status)).toEqual(['free_text', 'missing', 'canonical', 'canonical'])
  })
})

// ── 回归：2026-08-04 实际数据形状 ──────────────────────────────────
describe('回归：当天真实的 26 客户分布', () => {
  it('20/26 读不到行业经验', () => {
    const real: ClientIndustryRow[] = [
      ...Array.from({ length: 15 }, (_, i) => c(`未填${i}`, null)),
      c('30 Kiteroa', 'real_estate'), c('IB Real Estate', 'real_estate'),
      c('Parkhomes', 'real_estate'), c('Roman HU', 'real_estate'),
      c('CTS Tours NZ', 'travel'),
      c('oztop', 'flooring'),
      c('Harbourline Physio', 'Healthcare — Physiotherapy'),
      c('双子移民留学', 'Immigration & Education Consulting'),
      c('Trade Plus Flooring', 'SPC/hybrid flooring wholesale (B2B trade)'),
      c('Kiwi Silk Road Travel', 'Travel — Tour Operator'),
      c('NZCPE 2026', 'B2B trade expo organiser (China–New Zealand trade)'),
    ]
    const s = summariseIndustryCoverage(real, KNOWN, { real_estate: 3 })
    expect(s.total).toBe(26)
    expect(s.canonical).toBe(5)          // 4 地产 + 1 旅游
    expect(s.freeText + s.missing).toBe(21)
    // 真正能读到行业经验的只有 4 个地产客户（travel 还没攒经验）
    expect(s.clients.filter(r => r.readableLessons > 0)).toHaveLength(4)
  })
})

/**
 * 2026-08-05 魏征 B3：这里的归一化跟取数侧不是同一套，于是体检结果跟真实行为相反。
 *
 * 取数侧（service.ts）会把空格/连字符转下划线，所以 `Real Estate` 实际上**能**
 * 命中 `real_estate` 的行业经验；而这里原来只做 trim+lowercase，把它判成
 * 「自由文本、读不到课」。越认真看这份体检，被误导得越狠。
 */
describe('归一化必须跟取数侧同一套（魏征 B3）', () => {
  const KNOWN = ['real_estate', 'building_supplies']

  it.each([
    ['Real Estate'],
    ['real estate'],
    ['REAL-ESTATE'],
    ['  Real  Estate  '],
  ])('「%s」要判成词表内，不是自由文本', (written) => {
    const r = summariseIndustryCoverage(
      [{ clientId: 'c1', clientName: 'A', industry: written }],
      KNOWN,
      { real_estate: 3 },
    )
    expect(r.clients[0].status).toBe('canonical')
  })

  it('真不在词表里的仍然判自由文本', () => {
    const r = summariseIndustryCoverage(
      [{ clientId: 'c1', clientName: 'A', industry: 'Travel — Tour Operator' }],
      KNOWN,
      {},
    )
    expect(r.clients[0].status).toBe('free_text')
  })
})
