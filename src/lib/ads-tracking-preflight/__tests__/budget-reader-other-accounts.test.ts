/**
 * 预算门 · 其它登记账户（只读库里的快照）：接进 readBudgetFacts 之后的行为。
 *
 * 为什么要有它：开投前检查以前只核对一个广告账户；客户登记了多个账户时，其它账户（含被隐藏的）里开着的预算
 * 一旦账户付清就会继续花钱。现在 readBudgetFacts 会顺带读其它账户的在投预算，但这一项读不成功只让这一项为 null，
 * 绝不连累整份预算事实（read / errors 不受影响）。
 *
 * 假库是内存表（五张表都认），假 fetch 只回两个列表；不碰真网络。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readBudgetFacts } from '../budget-reader'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const ACCOUNT = 'act_1111111111'
const OTHER = 'act_2222222222'
const CLIENT = 'client-1'
const TOKEN = 'SECRET_TOKEN_VALUE_123'
const noSleep = async (): Promise<void> => {}

type Row = Record<string, unknown>
type TableName =
  | 'client_meta_ad_accounts'
  | 'ad_strategy_configs'
  | 'clients'
  | 'ad_snapshot_captures'
  | 'ad_entity_snapshots'

type World = {
  tables?: Partial<Record<TableName, Row[]>>
  /** 这些表读的时候直接报错（模拟库读失败） */
  errors?: Partial<Record<TableName, string>>
}

type Filter = { kind: 'eq' | 'in' | 'gte'; col: string; value: unknown }

function matches(row: Row, filters: readonly Filter[]): boolean {
  for (const f of filters) {
    const v = row[f.col]
    if (f.kind === 'eq') {
      // 本文件里的行都属于同一个客户，行里没写 client_id 就当它属于被查的那个客户
      if (f.col === 'client_id' && v === undefined) continue
      if (v !== f.value) return false
    } else if (f.kind === 'in') {
      if (!Array.isArray(f.value) || !f.value.includes(v)) return false
    } else {
      // gte：只对字符串（时间戳）比较，跟真库的 ISO 字符串排序一致
      if (typeof v !== 'string' || typeof f.value !== 'string' || v < f.value) return false
    }
  }
  return true
}

function fakeDb(world: World) {
  const calls: string[] = []
  const tables = world.tables ?? {}
  const errors = world.errors ?? {}

  const db = {
    from(table: string) {
      calls.push(table)
      const filters: Filter[] = []
      let orderCol: string | null = null
      let orderAsc = true
      let limitN: number | null = null
      let rangeFrom: number | null = null
      let rangeTo: number | null = null

      const finish = (): { data: unknown; error: { message: string } | null } => {
        const err = errors[table as TableName]
        if (err) return { data: null, error: { message: err } }
        const all = tables[table as TableName] ?? []
        let rows = all.filter(r => matches(r, filters))
        if (orderCol !== null) {
          const col = orderCol
          const asc = orderAsc
          rows = [...rows].sort((a, b) => {
            const av = a[col]
            const bv = b[col]
            if (typeof av === 'string' && typeof bv === 'string') return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : av > bv ? -1 : av < bv ? 1 : 0
            return 0
          })
        }
        if (rangeFrom !== null && rangeTo !== null) rows = rows.slice(rangeFrom, rangeTo + 1)
        else if (limitN !== null) rows = rows.slice(0, limitN)
        return { data: rows, error: null }
      }

      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          filters.push({ kind: 'eq', col, value })
          return chain
        },
        in: (col: string, value: unknown) => {
          filters.push({ kind: 'in', col, value })
          return chain
        },
        gte: (col: string, value: unknown) => {
          filters.push({ kind: 'gte', col, value })
          return chain
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          orderAsc = opts?.ascending !== false
          return chain
        },
        limit: (n: number) => {
          limitN = n
          return chain
        },
        range: (from: number, to: number) => {
          rangeFrom = from
          rangeTo = to
          return chain
        },
        maybeSingle: async () => {
          const out = finish()
          if (out.error) return out
          const rows = Array.isArray(out.data) ? out.data : []
          return { data: rows[0] ?? null, error: null }
        },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(finish()).then(ok, bad),
      }
      return chain
    },
  }
  return { supabase: db as unknown as SupabaseClient, calls }
}

type GraphRoute = (url: URL) => { status?: number; body: unknown }

function fakeFetcher(routes: Record<string, GraphRoute>) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, '')
    const route = routes[path]
    const out = route ? route(url) : { status: 404, body: { error: { message: `unexpected ${path}`, code: 100 } } }
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 })
  })
  return { fetcher, calls }
}

const listRoute = (rows: Row[]): GraphRoute => () => ({ body: { data: rows } })

/** 这个账户自己在投的广告组：日预算 13400（跟现有测试的合计一致）。 */
const MINE_ROUTES: Record<string, GraphRoute> = {
  [`${ACCOUNT}/campaigns`]: listRoute([]),
  [`${ACCOUNT}/adsets`]: listRoute([
    { id: '6001', campaign_id: '5002', effective_status: 'ACTIVE', daily_budget: '13400', lifetime_budget: '0' },
  ]),
}

const REGISTRY_ONE: Row[] = [
  { ad_account_id: ACCOUNT, label: 'Official', hidden_from_ad_health: false, daily_budget_cap_cents: 15000 },
]
const REGISTRY_TWO: Row[] = [
  { ad_account_id: ACCOUNT, label: 'Official', hidden_from_ad_health: false, daily_budget_cap_cents: 15000 },
  { ad_account_id: OTHER, label: 'Old main', hidden_from_ad_health: true, daily_budget_cap_cents: null },
]
const CLIENT_CONFIG: Row[] = [{ daily_budget_cap_cents: 15000 }]

/**
 * 其它账户：欠费（account_status 3），两个在投系列，系列级日预算 4000 + 6000，系列 7001 下还有一个没写预算的广告组（钱在系列那一层，不重复算）。
 * 同一份行既当「抓全记录」（账户 / 系列 / 广告组三个层级都有、都抓全）用，也当「快照行」用。
 */
function otherAccountSnapshots(capturedAt: string): Row[] {
  const base = {
    client_id: CLIENT,
    ad_account_id: OTHER,
    effective_status: 'ACTIVE',
    capture_reason: 'scheduled',
    account_status: 3,
    currency: 'NZD',
    captured_at: capturedAt,
    complete: true,
    skipped_shared: false,
  }
  return [
    { ...base, level: 'account', entity_id: OTHER, campaign_id: null, effective_status: null, daily_budget_minor: null, lifetime_budget_minor: null },
    { ...base, level: 'campaign', entity_id: '7001', campaign_id: null, daily_budget_minor: 4000, lifetime_budget_minor: 0 },
    { ...base, level: 'campaign', entity_id: '7002', campaign_id: null, daily_budget_minor: 6000, lifetime_budget_minor: 0 },
    { ...base, level: 'adset', entity_id: '8001', campaign_id: '7001', daily_budget_minor: null, lifetime_budget_minor: null },
  ]
}

function read(over: { world?: World; routes?: Record<string, GraphRoute> } = {}) {
  const db = fakeDb(over.world ?? {})
  const net = fakeFetcher({ ...MINE_ROUTES, ...over.routes })
  const result = readBudgetFacts({
    supabase: db.supabase,
    clientId: CLIENT,
    adAccountId: ACCOUNT,
    token: TOKEN,
    fetcher: net.fetcher,
    now: NOW,
    sleep: noSleep,
  })
  return { result, db, net }
}

describe('readBudgetFacts · 其它登记账户', () => {
  it('只有一个登记账户：没有「其它」，快照表一次都不读', async () => {
    const { result, db } = read({
      world: { tables: { client_meta_ad_accounts: REGISTRY_ONE, ad_strategy_configs: CLIENT_CONFIG } },
    })
    const { facts } = await result
    expect(facts.read).toBe(true)
    expect(facts.registered_account_count).toBe(1)
    expect(facts.other_accounts).toEqual([])
    expect(facts.other_accounts_error).toBeNull()
    expect(db.calls).not.toContain('ad_snapshot_captures')
  })

  it('两个账户、另一个欠费但里面有两个在投系列：如实带回它的在投预算，不连累本账户', async () => {
    const capturedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const { result } = read({
      world: {
        tables: {
          client_meta_ad_accounts: REGISTRY_TWO,
          ad_strategy_configs: CLIENT_CONFIG,
          ad_snapshot_captures: otherAccountSnapshots(capturedAt),
          ad_entity_snapshots: otherAccountSnapshots(capturedAt),
        },
      },
    })
    const { facts, errors } = await result
    expect(errors).toEqual([])
    expect(facts.read).toBe(true)
    expect(facts.registered_account_count).toBe(2)
    expect(facts.live_daily_budget_cents).toBe(13400)
    expect(facts.other_accounts_error).toBeNull()
    expect(facts.other_accounts).toHaveLength(1)
    expect(facts.other_accounts?.[0]).toMatchObject({
      tail: '2222',
      label: 'Old main',
      hidden: true,
      account_status: 3,
      open_campaign_count: 2,
      live_daily_budget_cents: 10000,
    })
  })

  it('两个账户但快照超过 12 小时：其它账户这一项为 null 并写明原因，整份预算事实照读', async () => {
    const staleAt = new Date(NOW.getTime() - 13 * 60 * 60 * 1000).toISOString()
    const { result } = read({
      world: {
        tables: {
          client_meta_ad_accounts: REGISTRY_TWO,
          ad_strategy_configs: CLIENT_CONFIG,
          ad_snapshot_captures: otherAccountSnapshots(staleAt),
          ad_entity_snapshots: otherAccountSnapshots(staleAt),
        },
      },
    })
    const { facts, errors } = await result
    expect(facts.read).toBe(true)
    expect(errors).toEqual([])
    expect(facts.other_accounts).toBeNull()
    expect(facts.other_accounts_error).toContain('12 小时')
  })

  it('登记表本身读失败：整份读不到，其它账户这一项也是 null（上限都没读到，没资格谈其它账户），快照表不读', async () => {
    const { result, db } = read({
      world: {
        tables: { client_meta_ad_accounts: REGISTRY_TWO, ad_strategy_configs: CLIENT_CONFIG },
        errors: { client_meta_ad_accounts: 'boom' },
      },
    })
    const { facts } = await result
    expect(facts.read).toBe(false)
    expect(facts.other_accounts).toBeNull()
    expect(facts.other_accounts_error).toBeNull()
    expect(db.calls).not.toContain('ad_snapshot_captures')
  })

  it('Meta 现读失败（500）但快照是好的：整份读不到、在投合计 null，其它账户照样带回（两半互不连累）', async () => {
    const capturedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const { result } = read({
      world: {
        tables: {
          client_meta_ad_accounts: REGISTRY_TWO,
          ad_strategy_configs: CLIENT_CONFIG,
          ad_snapshot_captures: otherAccountSnapshots(capturedAt),
          ad_entity_snapshots: otherAccountSnapshots(capturedAt),
        },
      },
      routes: {
        [`${ACCOUNT}/campaigns`]: () => ({ status: 500, body: { error: { message: 'server error', code: 1 } } }),
      },
    })
    const { facts } = await result
    expect(facts.read).toBe(false)
    expect(facts.live_daily_budget_cents).toBeNull()
    expect(facts.other_accounts).toHaveLength(1)
    expect(facts.other_accounts?.[0]).toMatchObject({ tail: '2222', live_daily_budget_cents: 10000 })
  })

  it('令牌不会出现在结果里', async () => {
    const capturedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const { result } = read({
      world: {
        tables: {
          client_meta_ad_accounts: REGISTRY_TWO,
          ad_strategy_configs: CLIENT_CONFIG,
          ad_snapshot_captures: otherAccountSnapshots(capturedAt),
          ad_entity_snapshots: otherAccountSnapshots(capturedAt),
        },
      },
    })
    const out = await result
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })
})
