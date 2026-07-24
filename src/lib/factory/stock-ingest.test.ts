/**
 * 抓来的素材入库测试。
 *
 * 这组测试守两条会**直接造成事故**的红线:
 * ① track 必须是 b_generated —— 标成 a_real 会让网图盖上客户真实价格发出去
 *    (selectClips 在有 verified_offer 时只留 a_real,那是「AI 绝不背书真价」的唯一实现)
 * ② scene_tag 不能是具体地标 —— B 轨具体地标会被 complete-work-order 以 422 拒收(护栏 6)
 */

import { describe, expect, it } from 'vitest'
import { buildStockClipRows, toSceneTag } from './stock-ingest'
import type { HarvestedImage } from './stock-harvest'

const img = (o: Partial<HarvestedImage> = {}): HarvestedImage => ({
  url: 'https://i.pinimg.com/a.jpg',
  width: 800, height: 1280, saves: 2440,
  title: 'Zhangjiajie', dominantColor: '#45554f', aspectRatio: 1.6,
  ...o,
})

const WHITELIST = ['establishing', 'texture_macro', 'lifestyle_moment'] as const
const okPath = (_: HarvestedImage, i: number) => `clips/b-generated/c-1/stock_${i}.mp4`

const build = (over: Partial<Parameters<typeof buildStockClipRows>[0]> = {}) =>
  buildStockClipRows({
    clientId: 'c-1',
    images: [img()],
    query: 'china travel photography vertical',
    sceneTagWhitelist: WHITELIST,
    storagePathFor: okPath,
    ...over,
  })

describe('🔴 红线:抓来的素材绝不能标成真拍', () => {
  it('track 一律 b_generated', () => {
    for (const r of build({ images: [img(), img({ url: 'b' }), img({ url: 'c' })] })) {
      expect(r.track).toBe('b_generated')
    }
  })

  it('source_meta 明确标 is_real_footage: false', () => {
    expect(build()[0].source_meta.is_real_footage).toBe(false)
  })

  it('绝不出现 a_real —— 标错会让网图盖上客户真价发出去', () => {
    expect(JSON.stringify(build())).not.toContain('a_real')
  })
})

describe('🔴 红线:scene_tag 不许是具体地标(护栏 6 会 422 拒收)', () => {
  it('白名单外的词退回抽象兜底', () => {
    expect(toSceneTag('great wall sunrise', WHITELIST)).toBe('establishing')
    expect(toSceneTag('zhangjiajie glass bridge', WHITELIST)).toBe('establishing')
  })

  it('白名单内的照用', () => {
    expect(toSceneTag('texture macro', WHITELIST)).toBe('texture_macro')
  })

  it('剥掉搜索词里的噪音词(photography/vertical 不该进 tag)', () => {
    expect(toSceneTag('establishing photography vertical', WHITELIST)).toBe('establishing')
  })

  it('空/怪字符不炸,退回兜底', () => {
    for (const q of ['', '   ', '!!!', '###...']) {
      expect(toSceneTag(q, WHITELIST)).toBe('establishing')
    }
  })
})

describe('入库规则', () => {
  it('🔴 没搬进自家存储的一律跳过 —— 外链会失效,成片到时候黑屏', () => {
    const rows = buildStockClipRows({
      clientId: 'c-1',
      images: [img({ url: 'a' }), img({ url: 'b' }), img({ url: 'c' })],
      query: 'x', sceneTagWhitelist: WHITELIST,
      // 第二张搬运失败
      storagePathFor: (_, i) => (i === 1 ? null : `clips/b-generated/c-1/s${i}.mp4`),
    })
    expect(rows).toHaveLength(2)
    expect(JSON.stringify(rows)).not.toContain('i.pinimg') // 绝不拿外链当 storage_url
  })

  it('storage_url 用的是搬运后的自家路径', () => {
    expect(build()[0].storage_url).toBe('clips/b-generated/c-1/stock_0.mp4')
  })

  it('溯源信息齐全:能一路查回原图和为什么选它', () => {
    const m = build()[0].source_meta
    expect(m.origin).toBe('stock_harvest')
    expect(m.source_url).toBe('https://i.pinimg.com/a.jpg')
    expect(m.saves).toBe(2440)
    expect(m.query).toBe('china travel photography vertical')
  })

  it('duration_seconds 必须 > 0(NOT NULL 且装配层要用)', () => {
    expect(build()[0].duration_seconds).toBeGreaterThan(0)
  })

  it('限量,不把几百张一次灌进库', () => {
    const many = Array.from({ length: 50 }, (_, i) => img({ url: `u${i}` }))
    expect(build({ images: many, max: 10 })).toHaveLength(10)
  })

  it('空输入 → 空数组,不炸', () => {
    expect(build({ images: [] })).toEqual([])
  })
})
