import { describe, it, expect } from 'vitest'
import { selectAssetUrls, type AssetRow } from './client-asset-pool'

/**
 * ⚠️ 行形状照真实 schema 写：`quality_score` 在 `vision_metadata` 里面，
 * 不是表上的列。首版这里编了个顶层 `quality_score` 字段，测试全绿而生产
 * 查询直接报错返回空 —— 别再把便于测试的形状当成真实形状。
 */
const row = (url: string | null, quality?: number | null, kind?: string): AssetRow => ({
  storage_url: url,
  vision_metadata: {
    scene: 'interior',
    ...(kind ? { kind } : {}),
    ...(quality == null ? {} : { quality_score: quality }),
  },
})

describe('selectAssetUrls', () => {
  it('按质量分从高到低取', () => {
    const out = selectAssetUrls([row('a', 6), row('b', 9), row('c', 7)])
    expect(out).toEqual(['b', 'c', 'a'])
  })

  it('排除视频行 —— i2v 要静图，喂视频会失败', () => {
    const out = selectAssetUrls([row('img', 8), row('vid', 10, 'video')])
    expect(out).toEqual(['img'])
  })

  it('低质量图不进池', () => {
    expect(selectAssetUrls([row('bad', 2), row('ok', 8)])).toEqual(['ok'])
  })

  it('没有质量分的图仍收（老数据不该被误伤）', () => {
    expect(selectAssetUrls([row('legacy', null)])).toEqual(['legacy'])
  })

  it('质量分是字符串也认（jsonb 取出来是文本）', () => {
    const stringy: AssetRow = { storage_url: 'sv', vision_metadata: { quality_score: '9' } }
    const low: AssetRow = { storage_url: 'lo', vision_metadata: { quality_score: '2' } }
    expect(selectAssetUrls([low, stringy])).toEqual(['sv'])
  })

  it('vision_metadata 缺失整个字段也不炸', () => {
    expect(selectAssetUrls([{ storage_url: 'bare' }])).toEqual(['bare'])
  })

  it('空地址跳过，不产出打不开的链接', () => {
    expect(selectAssetUrls([row(null, 9), row('good', 8)])).toEqual(['good'])
  })

  it('按上限截断', () => {
    const many = Array.from({ length: 50 }, (_, i) => row(`u${i}`, 8))
    expect(selectAssetUrls(many, 5)).toHaveLength(5)
  })

  it('全部不合格时返回空数组（调用方走降级，不是崩）', () => {
    expect(selectAssetUrls([row(null), row('v', 9, 'video')])).toEqual([])
  })

  it('requireVerified=true 时只保留 client_verified/fde_shot 来源', () => {
    const verified: AssetRow = { storage_url: 'v', vision_metadata: { quality_score: 8 }, source: 'client_verified' }
    const fdeShot: AssetRow = { storage_url: 'f', vision_metadata: { quality_score: 8 }, source: 'fde_shot' }
    const uploaded: AssetRow = { storage_url: 'u', vision_metadata: { quality_score: 9 }, source: 'client_provided' }
    const ai: AssetRow = { storage_url: 'a', vision_metadata: { quality_score: 9 }, source: 'ai_generated' }
    const out = selectAssetUrls([verified, fdeShot, uploaded, ai], 40, { requireVerified: true })
    expect(out.sort()).toEqual(['f', 'v'])
  })

  it('requireVerified 默认 false，保持原有口径不筛来源（evaluate.ts 现有调用方不受影响）', () => {
    const uploaded: AssetRow = { storage_url: 'u', vision_metadata: { quality_score: 9 }, source: 'client_provided' }
    expect(selectAssetUrls([uploaded])).toEqual(['u'])
  })
})
