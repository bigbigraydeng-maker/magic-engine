import { describe, it, expect } from 'vitest'
import { selectAssetUrls, type AssetRow } from './client-asset-pool'

const row = (url: string | null, quality?: number | null, kind?: string): AssetRow => ({
  storage_url: url,
  quality_score: quality,
  vision_metadata: kind ? { kind } : { scene: 'interior' },
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
})
