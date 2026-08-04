/**
 * 素材抓取过滤测试 —— 样本全部来自 2026-07-25 Pinterest 真实抓取结果。
 *
 * 守的是「抓回来的图能不能直接进 1080×1920 竖屏成片」:
 * 太小会糊、横图放竖屏两边黑边、没人收藏的图通常不好看。
 */

import { describe, expect, it } from 'vitest'
import { buildSearchQueries, normalizeHarvest } from './stock-harvest'

/** 真实抓取样本(节选自 dataset 2uvObLM6gVcKikIHc) */
const REAL = [
  { title: 'Zhangjiajie National Forest Park', imageUrls: { original: 'https://i.pinimg.com/a.webp' },
    width: 800, height: 1280, saves: 2440, isVideo: false, dominantColor: '#45554f' },
  { title: 'Fanjing Heights', imageUrls: { original: 'https://i.pinimg.com/b.jpg' },
    width: 736, height: 1308, saves: 1399, isVideo: false, dominantColor: '#5a7576' },
  { title: 'Glass Bridge', imageUrls: { original: 'https://i.pinimg.com/c.jpg' },
    width: 768, height: 1376, saves: 72, isVideo: false, dominantColor: '#525c59' },
  // 太小 → 放进 1080 宽会糊
  { title: 'Stiai ca?', imageUrls: { original: 'https://i.pinimg.com/d.jpg' },
    width: 600, height: 857, saves: 91, isVideo: false, dominantColor: '#3d4c45' },
  // 收藏数太低
  { title: 'Fanjing dup', imageUrls: { original: 'https://i.pinimg.com/e.jpg' },
    width: 736, height: 1308, saves: 40, isVideo: false, dominantColor: '#5b8398' },
]

describe('normalizeHarvest — 用真实抓取样本', () => {
  it('🔴 按收藏数降序 —— 用打乱顺序的输入测,否则测不出排序有没有真发生', () => {
    // 教训:原来直接用 REAL(本身已降序)做断言,把「不排序」这个变异放过去了
    const shuffled = [REAL[2], REAL[0], REAL[1]] // 72 / 2440 / 1399
    const r = normalizeHarvest(shuffled)
    expect(r.map((x) => x.saves)).toEqual([2440, 1399, 72])
  })

  it('🔴 滤掉宽度不足的(放进 1080 竖屏会糊)', () => {
    expect(normalizeHarvest(REAL).some((x) => x.width < 700)).toBe(false)
  })

  it('🔴 滤掉收藏数过低的(没人认可的图通常不好看)', () => {
    expect(normalizeHarvest(REAL).some((x) => x.saves < 50)).toBe(false)
  })

  it('🔴 只留竖版(横图放 9:16 会有黑边或被裁掉主体)', () => {
    const withLandscape = [...REAL, {
      imageUrls: { original: 'https://x/land.jpg' }, width: 1920, height: 1080, saves: 9999, isVideo: false,
    }]
    const r = normalizeHarvest(withLandscape)
    expect(r.some((x) => x.url.includes('land'))).toBe(false)
    // 收藏数最高但被形状滤掉 —— 证明形状闸优先于热度
    expect(r[0].saves).toBe(2440)
  })

  it('滤掉视频(本模块只补静图,视频走 i2v)', () => {
    const withVid = [...REAL, {
      imageUrls: { original: 'https://x/v.mp4' }, width: 1080, height: 1920, saves: 5000, isVideo: true,
    }]
    expect(normalizeHarvest(withVid).some((x) => x.url.endsWith('.mp4'))).toBe(false)
  })

  it('同一张图去重', () => {
    expect(normalizeHarvest([REAL[0], REAL[0], REAL[1]])).toHaveLength(2)
  })

  it('脏数据不炸:null / 非对象 / 缺字段', () => {
    expect(() => normalizeHarvest([null, 'x', 42, {}, { width: 'abc' }])).not.toThrow()
    expect(normalizeHarvest([null, 'x', 42, {}])).toEqual([])
  })

  it('阈值可调(客户素材荒时可放宽)', () => {
    expect(normalizeHarvest(REAL, { minSaves: 0, minWidth: 500 }).length)
      .toBeGreaterThan(normalizeHarvest(REAL).length)
  })

  it('长宽比按真实数据算对(800×1280 = 1.6)', () => {
    expect(normalizeHarvest(REAL)[0].aspectRatio).toBe(1.6)
  })
})

describe('buildSearchQueries — 搜索词只从品牌资料溯源', () => {
  it('用内容支柱拼词(跟角度溯源同一条纪律)', () => {
    const q = buildSearchQueries({
      contentPillars: [{ name: 'Destination Inspiration' }, { name: 'Cultural Heritage' }],
      coreProposition: null,
    })
    expect(q[0]).toContain('Destination Inspiration')
    expect(q[0]).toContain('vertical')
  })

  it('支柱为空 → 退回 core_proposition 的实词,不把整句当搜索词', () => {
    const q = buildSearchQueries({
      contentPillars: null,
      coreProposition: 'Backed by China Travel Service with Kiwi-led operations',
    })
    expect(q).toHaveLength(1)
    expect(q[0].split(/\s+/).length).toBeLessThanOrEqual(6)
  })

  it('两者都空 → 空数组(绝不瞎编搜索词)', () => {
    expect(buildSearchQueries({ contentPillars: null, coreProposition: null })).toEqual([])
  })

  it('限制条数,不无限发请求(每条都要花钱)', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Pillar ${i}` }))
    expect(buildSearchQueries({ contentPillars: many, coreProposition: null, max: 3 })).toHaveLength(3)
  })
})
