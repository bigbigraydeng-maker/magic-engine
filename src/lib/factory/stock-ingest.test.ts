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
const okPath = (_: HarvestedImage, i: number) => `stock/c-1/stock_${i}.jpg`

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
      storagePathFor: (_, i) => (i === 1 ? null : `stock/c-1/s${i}.jpg`),
    })
    expect(rows).toHaveLength(2)
    expect(JSON.stringify(rows)).not.toContain('i.pinimg') // 绝不拿外链当 storage_url
  })

  it('storage_url 用的是搬运后的自家路径', () => {
    expect(build()[0].storage_url).toBe('stock/c-1/stock_0.jpg')
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

// ── 源图轮换(治「所有 AI 画面从同一张图长出来」)────────────────────────────
import { selectClips } from './strategist'
import { SHOT_RECIPES } from './shot-recipes'

const ctxWithNoStock = {
  clipStock: [],                 // 无库存 → 每段都要生成 → 每段都需要源图
  blocklist: [], recentAngles: [], activeWinners: [],
  now: new Date('2026-07-25T00:00:00Z'),
} as never

describe('🔴 i2v 源图轮换 —— 治「所有画面从同一张图长出来」', () => {
  const recipe = SHOT_RECIPES.find((r) => r.key === 'personal_story')!
  const pool = ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg']

  it('给了素材池 → 各段源图不重样(不再是同一张种子图)', () => {
    const { generationPlan } = selectClips(ctxWithNoStock, 'x', false, recipe, pool)
    const used = generationPlan.map((p) => p.source_image_url)
    expect(used.length).toBeGreaterThan(1)
    expect(new Set(used).size).toBeGreaterThan(1)   // 关键:不是全同一张
    expect(used.every((u) => u !== null)).toBe(true)
  })

  it('池子比段数少 → 循环复用,不越界不返回 undefined', () => {
    const { generationPlan } = selectClips(ctxWithNoStock, 'x', false, recipe, ['https://cdn/only.jpg'])
    expect(generationPlan.every((p) => p.source_image_url === 'https://cdn/only.jpg')).toBe(true)
  })

  it('池子为空 → 退回 null 交给 worker 兜底(保持老行为,不炸)', () => {
    const { generationPlan } = selectClips(ctxWithNoStock, 'x', false, recipe, [])
    expect(generationPlan.every((p) => p.source_image_url === null)).toBe(true)
    expect(generationPlan.every((p) => p.requires_source_resolution === true)).toBe(true)
  })

  it('有源图时 requires_source_resolution=false(worker 不该再去兜底)', () => {
    const { generationPlan } = selectClips(ctxWithNoStock, 'x', false, recipe, pool)
    expect(generationPlan.every((p) => p.requires_source_resolution === false)).toBe(true)
  })
})

// ── 库存配额:拆掉「库存视频独占 8 段,i2v 永不触发」那堵墙 ────────────────────
import { FACTORY_MAX_STOCK_SHARE } from './constants'

const vid = (id: string, tag: string) => ({
  id, scene_tag: tag, motion_type: null, track: 'b_generated' as const,
  usage_count: 0, last_used_at: null,
})
/** 模拟 CTS:库存视频足够填满所有段 */
const ctxRichStock = {
  clipStock: Array.from({ length: 17 }, (_, i) => vid(`v${i}`, `scene_${i}`)),
  blocklist: [], recentAngles: [], activeWinners: [],
  // 🔴 必带:CTS 真实为 true。漏了它 clipAllowed 会把所有非白名单 scene_tag 的 B 轨素材
  // 全滤掉,库存池变空 → 测出来的结论跟线上完全相反(昨天已踩过一次同样的坑)
  allowBTrackLandmarkAds: true,
  now: new Date('2026-07-26T00:00:00Z'),
} as never

describe('🔴 库存配额 —— 让抓来改好的图真能进成片', () => {
  const recipe = SHOT_RECIPES.find((r) => r.key === 'personal_story')!  // 8 段
  const pool = ['https://cdn/ai1.png', 'https://cdn/ai2.png', 'https://cdn/ai3.png']

  it('🔴 有改好的源图 → 库存不得独占,必须留出镜头走生成', () => {
    const { segments, generationPlan } = selectClips(ctxRichStock, 'x', false, recipe, pool)
    // 这正是此前的 bug:17 条库存把 8 段全填满 → generationPlan 为空 → i2v 永不触发
    expect(generationPlan.length).toBeGreaterThan(0)
    expect(segments).toHaveLength(recipe.shots.length) // 段数不变,只是来源变了
  })

  it('库存占比不超过上限(其余留给新生成)', () => {
    const { segments } = selectClips(ctxRichStock, 'x', false, recipe, pool)
    const fromStock = segments.filter((s) => (s.clip_ids ?? []).length > 0).length
    expect(fromStock).toBeLessThanOrEqual(Math.floor(recipe.shots.length * FACTORY_MAX_STOCK_SHARE))
  })

  it('🔴 没有改好的图 → 退回全库存(不为了新鲜感烧空转的钱)', () => {
    const { generationPlan } = selectClips(ctxRichStock, 'x', false, recipe, [])
    expect(generationPlan).toHaveLength(0)
  })

  it('🔴 价格广告的双保险:即便配额判断被改坏,requireRealFootage 分支仍不生成', () => {
    // 变异测试发现:把配额条件里的 !requireRealFootage 去掉,这组测试**仍全绿** ——
    // 因为 selectClips 里价格广告分支会直接 return 跳过该镜。那是第二道闸。
    // 这条用例专门钉那道闸:真料不足时宁可少几镜,也绝不掺 AI 生成背书真价。
    const scarce = {
      clipStock: [{ id: 'r0', scene_tag: 's0', motion_type: null, track: 'a_real' as const, usage_count: 0, last_used_at: null }],
      blocklist: [], recentAngles: [], activeWinners: [],
      allowBTrackLandmarkAds: true, now: new Date('2026-07-26T00:00:00Z'),
    } as never
    const { segments, generationPlan } = selectClips(scarce, 'x', true, recipe, pool)
    expect(generationPlan).toHaveLength(0)          // 一条都不生成
    expect(segments.length).toBeLessThan(recipe.shots.length) // 宁可少几镜
  })

  it('🔴 价格广告(要求全真拍)→ 配额不生效,绝不掺生成', () => {
    const realStock = {
      ...(ctxRichStock as unknown as Record<string, unknown>),
      clipStock: Array.from({ length: 17 }, (_, i) => ({ ...vid(`r${i}`, `s${i}`), track: 'a_real' as const })),
    } as never
    const { generationPlan } = selectClips(realStock, 'x', true, recipe, pool)
    expect(generationPlan).toHaveLength(0)
  })

  it('生成的镜头拿到的是改好的图(源图池里的),不是种子图', () => {
    const { generationPlan } = selectClips(ctxRichStock, 'x', false, recipe, pool)
    expect(generationPlan.every((p) => pool.includes(p.source_image_url!))).toBe(true)
  })
})
