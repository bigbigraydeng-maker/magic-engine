/**
 * 服务端价格闸的取数行为测试。
 *
 * 这里最容易出的错不是「判错」，是**查错了还看不出来**：
 * 查一张不存在的表、漏带 client_id、把「查询报错」和「没查到」混成同一个空结果 ——
 * 三种都会安静地返回 unknown，而 unknown 恰好是保守值，测试照样绿。
 *
 * 所以假 supabase 按**表**建模、真的执行过滤条件，没建模的表直接 throw；
 * 并且每条断言都连带检查「这次查询带了哪些条件」。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  judgeOutgoingPost,
  judgePriceClaimWithSource,
  resolveOutgoingImageSource,
  priceGateMessage,
  outgoingPriceGateMessage,
} from './price-claim-gate'

type Row = Record<string, unknown>
interface RecordedQuery {
  table: string
  eq: Array<[string, unknown]>
}

/**
 * 按表建模的假 supabase：`.eq()` 真的过滤，`.maybeSingle()` 返回第一条或 null。
 * 没建模的表 throw —— 查错表必须炸，不能安静返回空（那正是 bug 能活两个月的原因）。
 */
function makeSupabase(
  tables: Partial<Record<'client_assets' | 'visual_assets', Row[]>>,
  queries: RecordedQuery[] = [],
  failOn?: 'client_assets' | 'visual_assets',
): SupabaseClient {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`测试没有给 ${table} 建模，说明代码查了意料之外的表`)
    const record: RecordedQuery = { table, eq: [] }
    queries.push(record)

    const rows = () =>
      (tables[table as keyof typeof tables] ?? []).filter((r) =>
        record.eq.every(([col, val]) => r[col] === val),
      )

    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'limit', 'order', 'not']) {
      builder[m] = () => builder
    }
    builder.eq = (col: string, val: unknown) => {
      record.eq.push([col, val])
      return builder
    }
    builder.maybeSingle = async () =>
      failOn === table
        ? { data: null, error: { message: 'boom' } }
        : { data: rows()[0] ?? null, error: null }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

const IMG = 'https://cdn.example.com/a.jpg'
const CLIENT = 'client-1'

describe('resolveOutgoingImageSource —— 来源从哪儿查出来的', () => {
  it('素材库里有 → 用素材库的来源（真值只在这张表）', async () => {
    const q: RecordedQuery[] = []
    const db = makeSupabase(
      { client_assets: [{ client_id: CLIENT, storage_url: IMG, source: 'client_verified' }] },
      q,
    )
    expect(await resolveOutgoingImageSource(db, CLIENT, IMG)).toBe('client_verified')
    // 命中素材库就该收手，不必再去查配图槽
    expect(q.map((r) => r.table)).toEqual(['client_assets'])
    expect(q[0].eq).toEqual([
      ['client_id', CLIENT],
      ['storage_url', IMG],
    ])
  })

  it('素材库没有、配图槽是 AI 生成的 → ai_generated', async () => {
    const q: RecordedQuery[] = []
    const db = makeSupabase(
      {
        client_assets: [],
        visual_assets: [{ client_id: CLIENT, storage_url: IMG, provider: 'wavespeed' }],
      },
      q,
    )
    expect(await resolveOutgoingImageSource(db, CLIENT, IMG)).toBe('ai_generated')
    expect(q.map((r) => r.table)).toEqual(['client_assets', 'visual_assets'])
    expect(q[1].eq).toEqual([
      ['client_id', CLIENT],
      ['storage_url', IMG],
    ])
  })

  it('两张表都没有（外部链接）→ unknown', async () => {
    const db = makeSupabase({ client_assets: [], visual_assets: [] })
    expect(await resolveOutgoingImageSource(db, CLIENT, IMG)).toBe('unknown')
  })

  it('🔴 别的客户的「已确认」图不算数 —— 恒带 client_id', async () => {
    const db = makeSupabase({
      client_assets: [{ client_id: 'someone-else', storage_url: IMG, source: 'client_verified' }],
      visual_assets: [],
    })
    expect(await resolveOutgoingImageSource(db, CLIENT, IMG)).toBe('unknown')
  })

  it('🔴 查询报错 ≠ 这张图没来源 —— 报错也走 unknown（保守，不误放行）', async () => {
    const db = makeSupabase(
      { client_assets: [{ client_id: CLIENT, storage_url: IMG, source: 'client_verified' }] },
      [],
      'client_assets',
    )
    expect(await resolveOutgoingImageSource(db, CLIENT, IMG)).toBe('unknown')
  })

  it('配图槽说是素材库来的、素材库却查不到 → unknown（不猜）', async () => {
    const db = makeSupabase({
      client_assets: [],
      visual_assets: [{ client_id: CLIENT, storage_url: IMG, provider: 'client_library' }],
    })
    expect(await resolveOutgoingImageSource(db, CLIENT, IMG)).toBe('unknown')
  })
})

describe('judgeOutgoingPost —— 拦不拦', () => {
  const libraryWith = (source: string) =>
    makeSupabase({ client_assets: [{ client_id: CLIENT, storage_url: IMG, source }] })

  it('有价格 + 来源不明 → 拦', async () => {
    const v = await judgeOutgoingPost(libraryWith('unknown'), {
      clientId: CLIENT,
      caption: 'Spring sale $99 per person',
      imageUrl: IMG,
    })
    expect(v).toMatchObject({ blocked: true, priceClaimed: true, source: 'unknown' })
  })

  it('有价格 + 已确认实拍 → 放行', async () => {
    const v = await judgeOutgoingPost(libraryWith('client_verified'), {
      clientId: CLIENT,
      caption: 'Spring sale $99 per person',
      imageUrl: IMG,
    })
    expect(v.blocked).toBe(false)
  })

  it('有价格 + 我们自己拍的 → 放行', async () => {
    const v = await judgeOutgoingPost(libraryWith('fde_shot'), {
      clientId: CLIENT,
      caption: 'From $199',
      imageUrl: IMG,
    })
    expect(v.blocked).toBe(false)
  })

  it('🔴 没价格 + 不是海报 → 来源不明也放行，只查一次素材库看是不是海报（不许无条件拦截）', async () => {
    const q: RecordedQuery[] = []
    // 只建模素材库：查配图槽就会 throw
    const db = makeSupabase({ client_assets: [{ client_id: CLIENT, storage_url: IMG, source: 'unknown' }] }, q)
    const v = await judgeOutgoingPost(db, {
      clientId: CLIENT,
      caption: 'Come see our Auckland showroom, open 7 days',
      imageUrl: IMG,
    })
    expect(v).toMatchObject({ blocked: false, priceClaimed: false })
    expect(q.map((r) => r.table)).toEqual(['client_assets'])
  })

  it('没配图 → 不适用本闸（没有画面可对不上）', async () => {
    const q: RecordedQuery[] = []
    const db = makeSupabase({}, q)
    const v = await judgeOutgoingPost(db, {
      clientId: CLIENT,
      caption: 'Spring sale $99',
      imageUrl: null,
    })
    expect(v.blocked).toBe(false)
    expect(v.priceClaimed).toBe(true)
    expect(q).toHaveLength(0)
  })

  it('「100% Kiwi owned」不是价格 —— 正常文案不该被这道闸挡住', async () => {
    const q: RecordedQuery[] = []
    const v = await judgeOutgoingPost(makeSupabase({ client_assets: [] }, q), {
      clientId: CLIENT,
      caption: '100% Kiwi owned and operated',
      imageUrl: IMG,
    })
    expect(v.blocked).toBe(false)
    expect(q.map((r) => r.table)).toEqual(['client_assets'])
  })
})

describe('judgeOutgoingPost —— AI 海报新规矩（快速发帖那条路）', () => {
  const PARENT = 'a1b2c3d4-0000-4000-8000-000000000001'
  const posterRow = (signed: boolean) => ({
    id: 'poster-1',
    client_id: CLIENT,
    storage_url: IMG,
    source: 'ai_generated',
    verified_by: signed ? 'fde@me.test' : null,
    verified_at: signed ? '2026-11-15T01:00:00.000Z' : null,
    vision_metadata: { poster: {
      recipe_id: 'tour_poster_v1', recipe_version: 1, source_asset_id: PARENT, has_price: true,
      text_lines: ['X', 'From $6,999'], cost_usd: 0.038, provider_request_id: null, created_at: '2026-11-15T00:00:00.000Z',
    } },
  })
  const parentRow = (source: string, archived_at: string | null = null) =>
    ({ id: PARENT, client_id: CLIENT, storage_url: 'https://cdn.example.com/parent.jpg', source, archived_at })
  const UNPRICED = 'Discover China this spring'

  it('未签海报 + 文案无价 → 拦（价格藏在图里也算报价），说明走海报那套', async () => {
    const db = makeSupabase({ client_assets: [posterRow(false), parentRow('client_verified')] })
    const v = await judgeOutgoingPost(db, { clientId: CLIENT, caption: UNPRICED, imageUrl: IMG })
    expect(v).toMatchObject({ blocked: true, priceClaimed: true, poster: true, source: 'ai_generated' })
    expect(outgoingPriceGateMessage(v)).toContain('已对原图，确认')
  })

  it('签字 + 原图已确认 → 放行（文案有价也放）', async () => {
    const q: RecordedQuery[] = []
    const db = makeSupabase({ client_assets: [posterRow(true), parentRow('client_verified')] }, q)
    const v = await judgeOutgoingPost(db, { clientId: CLIENT, caption: 'From $6,999 pp', imageUrl: IMG })
    expect(v).toMatchObject({ blocked: false, poster: true })
    // 原图回查恒带 client_id
    expect(q[1].eq).toEqual([['client_id', CLIENT], ['id', PARENT]])
  })

  it('签字但原图被降级 / 归档 / 是别的客户的 → 拦', async () => {
    for (const parent of [
      parentRow('client_provided'),
      parentRow('client_verified', '2026-11-10T00:00:00.000Z'),
      { ...parentRow('client_verified'), client_id: 'someone-else' },
    ]) {
      const db = makeSupabase({ client_assets: [posterRow(true), parent] })
      const v = await judgeOutgoingPost(db, { clientId: CLIENT, caption: UNPRICED, imageUrl: IMG })
      expect(v.blocked).toBe(true)
    }
  })

  it('凡是海报都要签字：未签、图里也没价、文案也没价 → 照样拦', async () => {
    const row = { ...posterRow(false), vision_metadata: { poster: { ...posterRow(false).vision_metadata.poster, has_price: false } } }
    const v = await judgeOutgoingPost(makeSupabase({ client_assets: [row, parentRow('client_verified')] }), { clientId: CLIENT, caption: UNPRICED, imageUrl: IMG })
    expect(v).toMatchObject({ blocked: true, priceClaimed: false, poster: true, posterSigned: false })
    expect(outgoingPriceGateMessage(v)).toContain('还没有团队成员对过原图签字')
    const signed = { ...row, verified_by: 'fde@me.test', verified_at: '2026-11-15T01:00:00.000Z' }
    const ok = await judgeOutgoingPost(makeSupabase({ client_assets: [signed, parentRow('client_provided')] }), { clientId: CLIENT, caption: UNPRICED, imageUrl: IMG })
    expect(ok.blocked).toBe(false) // signed, no price anywhere → parent source does not matter
  })

  it('🔴 查素材库报错 → 拦（文案没价也拦，不猜）', async () => {
    const db = makeSupabase({ client_assets: [posterRow(true)] }, [], 'client_assets')
    const v = await judgeOutgoingPost(db, { clientId: CLIENT, caption: UNPRICED, imageUrl: IMG })
    expect(v).toMatchObject({ blocked: true, lookupFailed: true })
    expect(outgoingPriceGateMessage(v)).toContain('核对不了')
  })

  it('网址带 ?… / #… 也认得出是那张海报', async () => {
    const q: RecordedQuery[] = []
    const db = makeSupabase({ client_assets: [posterRow(false), parentRow('client_verified')] }, q)
    const v = await judgeOutgoingPost(db, { clientId: CLIENT, caption: UNPRICED, imageUrl: `${IMG}?width=800#top` })
    expect(v).toMatchObject({ blocked: true, poster: true })
    expect(q[0].eq).toEqual([['client_id', CLIENT], ['storage_url', IMG]])
  })

  it('🔴 地址在 /posters/ 下但素材库查不到那一行 → 拦', async () => {
    const orphan = 'https://x.supabase.co/storage/v1/object/public/visual-assets/client-1/posters/image-v1-1.jpg'
    const v = await judgeOutgoingPost(makeSupabase({ client_assets: [] }), { clientId: CLIENT, caption: UNPRICED, imageUrl: orphan })
    expect(v).toMatchObject({ blocked: true, lookupFailed: true })
  })

  it('非海报 AI 图行为不变：文案有价 → 拦；文案无价 → 放', async () => {
    const plain = { client_id: CLIENT, storage_url: IMG, source: 'ai_generated', verified_by: 'x', verified_at: '2026-11-15T00:00:00.000Z', vision_metadata: null }
    const priced = await judgeOutgoingPost(makeSupabase({ client_assets: [plain] }), { clientId: CLIENT, caption: 'From $99', imageUrl: IMG })
    expect(priced).toMatchObject({ blocked: true, source: 'ai_generated' })
    expect('poster' in priced).toBe(false)
    expect(outgoingPriceGateMessage(priced)).toBe(priceGateMessage('ai_generated'))
    const unpriced = await judgeOutgoingPost(makeSupabase({ client_assets: [plain] }), { clientId: CLIENT, caption: UNPRICED, imageUrl: IMG })
    expect(unpriced.blocked).toBe(false)
  })
})

describe('judgePriceClaimWithSource —— 已知来源时的纯判定', () => {
  const PRICE_CAPTION = 'Tour from NZD $2,699 per person'
  const NO_PRICE_CAPTION = 'Discover Shanghai this March'

  it('有价格 + 图库来源 → 拦', () => {
    const v = judgePriceClaimWithSource({ caption: PRICE_CAPTION, source: 'stock' })
    expect(v).toMatchObject({ blocked: true, priceClaimed: true, source: 'stock' })
  })

  it('有价格 + 已确认实拍 → 放行', () => {
    const v = judgePriceClaimWithSource({ caption: PRICE_CAPTION, source: 'client_verified' })
    expect(v.blocked).toBe(false)
  })

  it('有价格 + 我们自己拍的 → 放行', () => {
    const v = judgePriceClaimWithSource({ caption: PRICE_CAPTION, source: 'fde_shot' })
    expect(v.blocked).toBe(false)
  })

  it('有价格 + 来源为 null → 按来源不明拦下', () => {
    const v = judgePriceClaimWithSource({ caption: PRICE_CAPTION, source: null })
    expect(v).toMatchObject({ blocked: true, priceClaimed: true, source: 'unknown' })
  })

  it('没价格 → 图库来源也放行', () => {
    const v = judgePriceClaimWithSource({ caption: NO_PRICE_CAPTION, source: 'stock' })
    expect(v).toMatchObject({ blocked: false, priceClaimed: false })
  })
  it('图里报了价（imagePriceClaim）+ 文案没价 → 按报了价判，AI 图拦下', () => {
    const v = judgePriceClaimWithSource({ caption: NO_PRICE_CAPTION, source: 'ai_generated', imagePriceClaim: true })
    expect(v).toMatchObject({ blocked: true, priceClaimed: true, source: 'ai_generated' })
  })

  it('backsRealPrice 覆盖只按 source 的判定（签过字的海报）', () => {
    const v = judgePriceClaimWithSource({ caption: PRICE_CAPTION, source: 'ai_generated', backsRealPrice: true })
    expect(v.blocked).toBe(false)
    const w = judgePriceClaimWithSource({ caption: PRICE_CAPTION, source: 'client_verified', backsRealPrice: false })
    expect(w.blocked).toBe(true)
  })

  it('不传新参数时与旧行为一致', () => {
    expect(judgePriceClaimWithSource({ caption: NO_PRICE_CAPTION, source: 'ai_generated', imagePriceClaim: false }))
      .toMatchObject({ blocked: false, priceClaimed: false })
  })
})

describe('priceGateMessage —— 拦下来必须说清怎么解开', () => {
  it('带上具体来源 + 两条出路', () => {
    const msg = priceGateMessage('stock')
    expect(msg).toContain('图库 / 网上抓的')
    expect(msg).toContain('去掉')
    expect(msg).toContain('素材库')
  })
})
