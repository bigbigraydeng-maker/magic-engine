/**
 * 服务端价格事实闸的取数行为测试。
 *
 * 这里最容易出的错不是「判错」，是**查错了还看不出来**：
 * 查一张不存在的表、漏带 client_id、把「查询报错」和「没查到」混成同一个空结果 ——
 * 三种都会安静地返回空事实，而空事实恰好会拦下一切，测试照样绿。
 *
 * 所以假 supabase 按**表**建模、真的执行过滤条件，没建模的表直接 throw；
 * 并且每条断言都连带检查「这次查询带了哪些条件」。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOfferPriceFacts, judgePostPriceFacts } from './price-fact-gate'

type Row = Record<string, unknown>
interface RecordedQuery {
  table: string
  eq: Array<[string, unknown]>
}

/**
 * 按表建模的假 supabase：`.eq()` 真的过滤，`.maybeSingle()` 返回第一条或 null。
 * 没建模的表 throw —— 查错表必须炸，不能安静返回空。
 */
function makeSupabase(
  tables: Partial<Record<'clients', Row[]>>,
  queries: RecordedQuery[] = [],
  failOn?: 'clients',
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

const CLIENT = 'client-1'
const OTHER = 'client-2'

const OFFERS = {
  'alps-akl': {
    tour: 'Alpine Journeys — Swiss Alps Explorer (Auckland departure)',
    price_line: '8 Nights · From NZD $5,400 pp',
    single_supplement: 'NZD $650',
    tips: 'suggested NZD $12 per day',
    url: 'https://example.co.nz/tours/swiss-alps?ref=a',
  },
  'alps-chc': {
    tour: 'Alpine Journeys — Swiss Alps Explorer (Christchurch departure)',
    price_line: '7 Nights · From NZD $4,900 pp',
    single_supplement: 'NZD $650',
    tips: 'suggested NZD $12 per day',
    url: 'https://example.co.nz/tours/swiss-alps',
  },
  lakes: {
    tour: 'Alpine Journeys — Italian Lakes',
    price_line: '6 Nights · From NZD $3,200 pp',
    single_supplement: 'NZD $300',
    promo: '15% off',
  },
}

const rowWith = (id: string, offers: unknown): Row => ({
  id,
  factory_config: { render: { creatomate: { offers } } },
})

describe('loadOfferPriceFacts —— 事实从哪儿查出来的', () => {
  it('读 clients.factory_config.render.creatomate.offers，且恒带 id 条件', async () => {
    const q: RecordedQuery[] = []
    const db = makeSupabase({ clients: [rowWith(CLIENT, OFFERS)] }, q)
    const facts = await loadOfferPriceFacts(db, CLIENT)
    expect(facts).toHaveLength(3)
    expect(q.map((r) => r.table)).toEqual(['clients'])
    expect(q[0].eq).toEqual([['id', CLIENT]])
  })

  it('🔴 别的客户的行不算数 —— 恒带 id', async () => {
    const db = makeSupabase({
      clients: [rowWith(OTHER, OFFERS), rowWith(CLIENT, {})],
    })
    expect(await loadOfferPriceFacts(db, CLIENT)).toEqual([])
  })

  it('🔴 查询报错 ≠ 没有事实 —— 报错必须抛（fail-closed）', async () => {
    const db = makeSupabase({ clients: [rowWith(CLIENT, OFFERS)] }, [], 'clients')
    await expect(loadOfferPriceFacts(db, CLIENT)).rejects.toThrow(/client config read failed/)
  })

  it('没查到行 → []', async () => {
    const db = makeSupabase({ clients: [] })
    expect(await loadOfferPriceFacts(db, CLIENT)).toEqual([])
  })

  it('factory_config 为 null → []', async () => {
    const db = makeSupabase({ clients: [{ id: CLIENT, factory_config: null }] })
    expect(await loadOfferPriceFacts(db, CLIENT)).toEqual([])
  })

  it('offers 里非字符串字段被丢掉，但条目保留；不需要别的 creatomate 字段', async () => {
    const db = makeSupabase({
      clients: [
        {
          id: CLIENT,
          factory_config: {
            render: { creatomate: { offers: { 'alps-akl': { ...OFFERS['alps-akl'], n: 5 } } } },
          },
        },
      ],
    })
    const facts = await loadOfferPriceFacts(db, CLIENT)
    expect(facts).toHaveLength(1)
    expect(facts[0].key).toBe('alps-akl')
    expect(facts[0].claims.length).toBeGreaterThan(0)
  })
})

describe('judgePostPriceFacts —— 拦不拦', () => {
  it('价格写错 → 拦，且消息带「已拦下」', async () => {
    const db = makeSupabase({ clients: [rowWith(CLIENT, OFFERS)] })
    const facts = await loadOfferPriceFacts(db, CLIENT)
    const v = judgePostPriceFacts({
      text: 'Swiss Alps Explorer departing Auckland. NZD $4,400 per person.',
      offers: facts,
    })
    expect(v.blocked).toBe(true)
    expect(v.message).toContain('已拦下')
  })

  it('价格写对 → 放行，消息为空', async () => {
    const db = makeSupabase({ clients: [rowWith(CLIENT, OFFERS)] })
    const facts = await loadOfferPriceFacts(db, CLIENT)
    const v = judgePostPriceFacts({
      text: 'Swiss Alps Explorer departing Auckland. NZD $5,400 per person.',
      offers: facts,
    })
    expect(v.blocked).toBe(false)
    expect(v.message).toBe('')
  })

  it('文案里没价格 → 放行，消息为空', async () => {
    const db = makeSupabase({ clients: [rowWith(CLIENT, OFFERS)] })
    const facts = await loadOfferPriceFacts(db, CLIENT)
    const v = judgePostPriceFacts({
      text: 'Come see our Auckland showroom, open 7 days',
      offers: facts,
    })
    expect(v.blocked).toBe(false)
    expect(v.message).toBe('')
  })
})
