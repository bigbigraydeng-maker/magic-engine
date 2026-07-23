/**
 * master_briefs.products 规范化测试。
 *
 * 这个字段直接进内容生成的 system prompt(brief-injector 渲染成「主力产品:名称(卖点)」),
 * 所以脏数据的代价不是显示难看,是**广告文案会照着脏数据写出去**。
 */

import { describe, expect, it } from 'vitest'
import { MAX_PRODUCTS, normalizeProducts } from './products'

describe('normalizeProducts', () => {
  it('正常结构原样保留', () => {
    expect(normalizeProducts([{ name: 'SPC 复合地板', usp: '防水耐磨' }]))
      .toEqual([{ name: 'SPC 复合地板', usp: '防水耐磨' }])
  })

  it('非数组 / null → 空(客户没填)', () => {
    expect(normalizeProducts(null)).toEqual([])
    expect(normalizeProducts(undefined)).toEqual([])
    expect(normalizeProducts('SPC')).toEqual([])
    expect(normalizeProducts({ name: 'x' })).toEqual([])
  })

  it('🔴 名称为空的行整条丢弃(只有卖点没产品名,对 AI 毫无意义且污染 prompt)', () => {
    expect(normalizeProducts([
      { name: '', usp: '很好用' },
      { name: '   ', usp: '也很好' },
      { name: 'SPC', usp: '' },
    ])).toEqual([{ name: 'SPC', usp: '' }])
  })

  it('缺 usp 也能存(先把产品名录进去,卖点可以后补)', () => {
    expect(normalizeProducts([{ name: 'Hybrid 地板' }]))
      .toEqual([{ name: 'Hybrid 地板', usp: '' }])
  })

  it('🔴 按名称去重(不分大小写)—— 同一产品重复会让 AI 反复强调它', () => {
    const r = normalizeProducts([
      { name: 'SPC Flooring', usp: 'a' },
      { name: 'spc flooring', usp: 'b' },
      { name: 'Carpet', usp: 'c' },
    ])
    expect(r).toHaveLength(2)
    expect(r[0].usp).toBe('a') // 保留先出现的
    expect(r[1].name).toBe('Carpet')
  })

  it('折叠多余空白 + 去首尾空格', () => {
    expect(normalizeProducts([{ name: '  SPC   复合   地板 ', usp: ' 防水  耐磨 ' }]))
      .toEqual([{ name: 'SPC 复合 地板', usp: '防水 耐磨' }])
  })

  it('🔴 限量,防超长清单把 prompt 撑爆', () => {
    const many = Array.from({ length: MAX_PRODUCTS + 10 }, (_, i) => ({ name: `p${i}`, usp: 'x' }))
    expect(normalizeProducts(many)).toHaveLength(MAX_PRODUCTS)
  })

  it('超长文本截断(单条产品不该占掉半个 prompt)', () => {
    const r = normalizeProducts([{ name: 'a'.repeat(200), usp: 'b'.repeat(300) }])
    expect(r[0].name.length).toBeLessThanOrEqual(80)
    expect(r[0].usp.length).toBeLessThanOrEqual(120)
  })

  it('数组里混进非对象 → 跳过,不炸', () => {
    expect(normalizeProducts([null, 'SPC', 42, ['x'], { name: 'Carpet', usp: '' }]))
      .toEqual([{ name: 'Carpet', usp: '' }])
  })

  it('name/usp 是非字符串 → 当空处理', () => {
    expect(normalizeProducts([{ name: 123, usp: {} }])).toEqual([])
    expect(normalizeProducts([{ name: 'SPC', usp: 999 }])).toEqual([{ name: 'SPC', usp: '' }])
  })
})
