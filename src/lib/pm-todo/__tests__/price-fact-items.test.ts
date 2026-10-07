/**
 * 价格闸待办的取数行为测试。
 *
 * 这里最容易出的错不是「判错」，是**查错了还看不出来**：
 * 查一张不存在的表、漏带过滤条件、把「查询报错」和「没查到」混成同一个空结果 ——
 * 都会安静地返回空待办，测试照样绿。
 *
 * 所以假 supabase 按**表**建模、真的执行过滤条件，没建模的表直接 throw。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushPriceFactItems } from '../price-fact-items'
import type { ManualItem } from '../manual-item-types'

type Row = Record<string, unknown>

interface FakeOptions {
  socialPlans?: Row[]
  clients?: Row[]
  failOn?: 'social_plans' | 'clients'
  /** With failOn 'clients': only the lookup for this client id fails. */
  failClientId?: string
}

/**
 * 按表建模的假 supabase。
 * - `social_plans` 的 builder 可 await（resolve {data, error}），并真的执行 contains/gte。
 * - `clients` 的 builder 以 `.maybeSingle()` 收尾。
 * - 没建模的表 throw —— 查错表必须炸。
 */
function makeSupabase(opts: FakeOptions): SupabaseClient {
  const tables: Record<string, Row[]> = {
    social_plans: opts.socialPlans ?? [],
    clients: opts.clients ?? [],
  }

  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`测试没有给 ${table} 建模，说明代码查了意料之外的表`)
    const rows = tables[table]
    const filters: Array<[string, unknown]> = []
    let containsFilter: { col: string; val: Record<string, unknown> } | null = null
    let gteFilter: { col: string; val: string } | null = null

    const matched = () =>
      rows.filter((r) => {
        if (containsFilter) {
          const cell = r[containsFilter.col]
          if (typeof cell !== 'object' || cell === null) return false
          for (const [k, v] of Object.entries(containsFilter.val)) {
            if ((cell as Record<string, unknown>)[k] !== v) return false
          }
        }
        if (gteFilter) {
          const cell = r[gteFilter.col]
          if (typeof cell !== 'string' || cell < gteFilter.val) return false
        }
        return filters.every(([col, val]) => r[col] === val)
      })

    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.eq = (col: string, val: unknown) => {
      filters.push([col, val])
      return builder
    }
    builder.contains = (col: string, val: Record<string, unknown>) => {
      containsFilter = { col, val }
      return builder
    }
    builder.gte = (col: string, val: string) => {
      gteFilter = { col, val }
      return builder
    }
    builder.maybeSingle = async () =>
      opts.failOn === table && (!opts.failClientId || filters.some(([, v]) => v === opts.failClientId))
        ? { data: null, error: { message: 'boom' } }
        : { data: matched()[0] ?? null, error: null }
    builder.then = (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) =>
      Promise.resolve(
        opts.failOn === table
          ? { data: null, error: { message: 'boom' } }
          : { data: matched(), error: null },
      ).then(resolve)
    return builder
  }

  return { from } as unknown as SupabaseClient
}

const NOW = new Date('2026-10-08T01:00:00Z')
// 2026-10-08 in Pacific/Auckland (UTC+13 in October) → 2026-10-08.
const TODAY = '2026-10-08'
const FUTURE = '2026-10-10'
const PAST = '2026-10-01'

const CLIENT = 'client-alpine'
const CLIENT_NAME = 'Alpine Journeys'

const OFFERS = {
  'swiss-alps': {
    tour: 'Alpine Journeys — Swiss Alps Explorer (Auckland departure)',
    price_line: '8 Nights · From NZD $5,400 pp',
    single_supplement: 'NZD $650',
  },
}

function planRow(overrides: {
  id?: string
  client_id?: string
  created_at?: string
  bundles?: unknown[]
  published?: unknown[]
}): Row {
  return {
    id: overrides.id ?? 'plan-1',
    client_id: overrides.client_id ?? CLIENT,
    created_at: overrides.created_at ?? '2026-10-07T00:00:00Z',
    plan_data: {
      plan_kind: 'campaign_daily_v1',
      bundles: overrides.bundles ?? [],
      publish_meta: { published: overrides.published ?? [] },
    },
  }
}

function bundle(date: string, post: Record<string, unknown> | null): Row {
  return { date, post }
}

function clientRow(offers: unknown, id: string = CLIENT): Row {
  return {
    id,
    factory_config: { render: { creatomate: { offers } } },
  }
}

function nameOf(clientId: string): string {
  return clientId === CLIENT ? CLIENT_NAME : '未知客户'
}

describe('pushPriceFactItems —— 价格核对不过的帖子要摆到待办里', () => {
  it('价格正确 + 未来日期 → 不产生待办', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: '8 Nights · From NZD $5,400 pp',
              cta: 'Book now',
              cta_url: 'https://example.com/book',
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(0)
  })

  it('价格写错 → 恰好一条待办，kind 正确，what 带日期，href 指向每日计划', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: '8 Nights · From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: 'https://example.com/book',
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('price_fact_unverified')
    expect(items[0].what).toContain(FUTURE)
    expect(items[0].what).toContain('拦下')
    expect(items[0].href.endsWith('/daily-plan')).toBe(true)
  })

  it('客户没配价格资料 + 有价格的帖子 → 一条待办（没资料 = 拦）', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $5,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
      ],
      clients: [clientRow({})],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('price_fact_unverified')
  })

  it('过去日期的帖子（价格写错）→ 不产生待办', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle(PAST, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(0)
  })

  it('已经发过的日期（价格写错）→ 不产生待办', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
          published: [{ date: FUTURE }],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(0)
  })

  it('同一客户两条价格写错 → 只出一条待办，列出两个日期', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle('2026-10-10', {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
            bundle('2026-10-11', {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,500 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2026-10-10')
    expect(items[0].what).toContain('2026-10-11')
  })

  it('同一客户只算最新的一份计划（旧计划写错、新计划正确 → 不产生待办）', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          id: 'plan-new',
          created_at: '2026-10-07T00:00:00Z',
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $5,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
        planRow({
          id: 'plan-old',
          created_at: '2026-10-01T00:00:00Z',
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(0)
  })

  it('帖子里没有任何价格 → 不产生待办', async () => {
    const db = makeSupabase({
      socialPlans: [
        planRow({
          bundles: [
            bundle(FUTURE, {
              hook: 'Come see our showroom',
              body: 'Open 7 days a week',
              cta: 'Visit us',
              cta_url: null,
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS)],
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    expect(items).toHaveLength(0)
  })

  it('一个客户读资料报错 → 跳过该客户，另一个客户的待办照出', async () => {
    const OTHER = 'client-other'
    const db = makeSupabase({
      socialPlans: [
        planRow({
          id: 'plan-a',
          client_id: CLIENT,
          created_at: '2026-10-07T00:00:00Z',
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
        planRow({
          id: 'plan-b',
          client_id: OTHER,
          created_at: '2026-10-06T00:00:00Z',
          bundles: [
            bundle(FUTURE, {
              hook: 'Swiss Alps Explorer',
              body: 'From NZD $4,400 pp',
              cta: 'Book now',
              cta_url: null,
            }),
          ],
        }),
      ],
      clients: [clientRow(OFFERS), clientRow(OFFERS, OTHER)],
      failOn: 'clients',
      failClientId: CLIENT,
    })
    const items: ManualItem[] = []
    await pushPriceFactItems(db, items, NOW, nameOf)
    // CLIENT 读资料报错 → 跳过；OTHER 读得到资料、价格对不上 → 照出一条。
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe(OTHER)
  })

  it('social_plans 读取出错 → 直接 reject', async () => {
    const db = makeSupabase({ failOn: 'social_plans' })
    const items: ManualItem[] = []
    await expect(pushPriceFactItems(db, items, NOW, nameOf)).rejects.toThrow(
      'price-fact-items: social_plans read failed',
    )
  })
})
