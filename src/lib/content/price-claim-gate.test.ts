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
import { judgeOutgoingPost, resolveOutgoingImageSource, priceGateMessage } from './price-claim-gate'

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

  it('🔴 没价格 → 来源不明也放行，且**一次库都不查**（不许无条件拦截）', async () => {
    const q: RecordedQuery[] = []
    // 故意一张表都不建模：真去查了就会 throw，比断言 blocked=false 更锁得住
    const db = makeSupabase({}, q)
    const v = await judgeOutgoingPost(db, {
      clientId: CLIENT,
      caption: 'Come see our Auckland showroom, open 7 days',
      imageUrl: IMG,
    })
    expect(v).toMatchObject({ blocked: false, priceClaimed: false })
    expect(q).toHaveLength(0)
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
    const v = await judgeOutgoingPost(makeSupabase({}, q), {
      clientId: CLIENT,
      caption: '100% Kiwi owned and operated',
      imageUrl: IMG,
    })
    expect(v.blocked).toBe(false)
    expect(q).toHaveLength(0)
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
