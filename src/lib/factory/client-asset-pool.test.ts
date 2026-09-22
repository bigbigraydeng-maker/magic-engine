import { describe, it, expect } from 'vitest'
import { selectAssetUrls, loadRankableClientAssets, type AssetRow } from './client-asset-pool'

/**
 * 假 Supabase 链式查询——只记录被调用过哪些过滤方法，不模拟真实 PostgREST 的
 * NULL 三值逻辑（那正是 2026-09-13 那次事故的根源：`.not('col->>key','eq','video')`
 * 在生产库对着「键不存在」的行会把整行排除，纯内存 mock 测不出这个真实行为——
 * 这也是本文件开头注释早就写过的教训）。这里测两件事：① 查询链不再包含那个
 * 已经出过事的 DB 级过滤调用（防止有人手滑改回去）；② 拿到数据后的 JS 侧过滤
 * correctly 保留「没有 kind 键」的行、只排除真正 kind==='video' 的行。
 */
function fakeAssetQuery(rows: unknown[]) {
  const calls: { method: string; args: unknown[] }[] = []
  const builder: Record<string, (...args: unknown[]) => unknown> = {}
  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args })
    return builder
  }
  for (const m of ['select', 'eq', 'is', 'not', 'or']) builder[m] = chain(m)
  builder.limit = async (..._args: unknown[]) => ({ data: rows, error: null })
  return {
    from: () => builder,
    calls,
  }
}

describe('loadRankableClientAssets — 2026-09-13 生产事故回归测试', () => {
  it('查询链里不再有会静默排除「无 kind 键」照片行的 DB 级 not-eq 过滤', async () => {
    const fake = fakeAssetQuery([])
    await loadRankableClientAssets('client-1', fake as never, null, null)
    const badCall = fake.calls.find(
      (c) => c.method === 'not' && c.args[0] === 'vision_metadata->>kind',
    )
    expect(badCall, '这个过滤条件曾把 CTS 47 张已核实真实照片里的 46 张一起筛掉，不能再出现').toBeUndefined()
  })

  it('拿到数据后：没有 kind 键的照片行保留，kind==="video" 的行排除', async () => {
    const rows = [
      { id: '1', storage_url: 'a', original_filename: 'a.jpg', vision_metadata: { scene: 'wall' }, source: 'client_verified' },
      { id: '2', storage_url: 'b', original_filename: 'b.jpg', vision_metadata: null, source: 'client_verified' },
      { id: '3', storage_url: 'c', original_filename: 'c.mp4', vision_metadata: { kind: 'video' }, source: 'client_verified' },
    ]
    const fake = fakeAssetQuery(rows)
    const out = await loadRankableClientAssets('client-1', fake as never, null, null)
    expect(out.map((r) => r.id).sort()).toEqual(['1', '2'])
  })
})

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
