/**
 * 预算门读库读线上（只读）：库里的日预算上限（账户级 + 客户级）+ Meta 现读的「在投」日预算合计。
 * 假库 + 假 fetch，不碰真网络。
 *
 * 为什么要有它：预算门以前拿 client-config.ts 里写死的「计划日预算 / 官方日上限」互相比，
 * 数字一过期就假绿（2026-10-21 事故：写死 NZ$101 / NZ$110，库里上限 NZ$150、在投合计 NZ$134）。
 * 现在上限读库、在投预算读 Meta，写死的数字只剩「跟库对一对」的作用。
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { readBudgetFacts } from '../budget-reader'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const ACCOUNT = 'act_1111111111'
const OTHER_ACCOUNT = 'act_2222222222'
const CLIENT = 'client-1'
const TOKEN = 'SECRET_TOKEN_VALUE_123'
const noSleep = async (): Promise<void> => {}

type CapRow = { daily_budget_cap_cents: unknown }
type AccountRow = CapRow & { ad_account_id: string }
type World = {
  /** { raw } = 库没报错、但返回的内容原样就是 raw（用来模拟读回来的形状不对） */
  accounts?: AccountRow[] | 'error' | { raw: unknown }
  /** ad_strategy_configs 那一行；'multiple' = 配置行有多条（maybeSingle 报错） */
  client?: CapRow | null | 'error' | 'multiple'
  /** clients.meta_ad_account_id（老客户没有登记行时的回落）；'error' = 读失败 */
  legacy?: string | null | 'error'
}

function fakeDb(world: World) {
  const queries: { table: string; filters: [string, string][] }[] = []
  const db = {
    from(table: string) {
      const q = { table, filters: [] as [string, string][] }
      queries.push(q)
      const finish = () => {
        if (table === 'client_meta_ad_accounts') {
          if (world.accounts === 'error') return { data: null, error: { message: `读 ${table} 失败` } }
          if (world.accounts !== undefined && !Array.isArray(world.accounts)) return { data: world.accounts.raw, error: null }
          return { data: world.accounts ?? [], error: null }
        }
        if (table === 'clients') {
          if (world.legacy === 'error') return { data: null, error: { message: `读 ${table} 失败` } }
          return { data: { meta_ad_account_id: world.legacy ?? null }, error: null }
        }
        if (world.client === 'error') return { data: null, error: { message: `读 ${table} 失败` } }
        if (world.client === 'multiple') return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
        return { data: world.client ?? null, error: null }
      }
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { q.filters.push([col, String(val)]); return chain },
        maybeSingle: async () => finish(),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(finish()).then(ok, bad),
      }
      return chain
    },
  }
  // 假库只实现被测代码真会调用的链式方法（select / eq / maybeSingle / 直接 await）。已跑：下面每条用例的查询都对着它走过一遍，
  // 写方法根本不存在，被测代码一旦调用就是 TypeError（证伪路径），不会静默通过。
  return { supabase: db as unknown as SupabaseClient, queries }
}

type Json = Record<string, unknown>
type GraphRoute = (url: URL) => { status?: number; body: unknown }

function fakeFetcher(routes: Record<string, GraphRoute> = {}) {
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

const listRoute = (rows: Json[], extra: Json = {}): GraphRoute => () => ({ body: { data: rows, ...extra } })

const ACTIVE_ABO_CAMPAIGNS: Json[] = [
  { id: '5001', effective_status: 'ACTIVE', daily_budget: null, lifetime_budget: '0' },
  { id: '5002', effective_status: 'ACTIVE' },
]
const ACTIVE_ADSETS: Json[] = [
  { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '7500', lifetime_budget: '0' },
  { id: '6002', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '2500', lifetime_budget: '0' },
  { id: '6003', campaign_id: '5002', effective_status: 'ACTIVE', daily_budget: '3400', lifetime_budget: '0' },
]
const BOTH_CAPPED: World = {
  accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }],
  client: { daily_budget_cap_cents: 15000 },
}

function read(over: { db?: World; routes?: Record<string, GraphRoute>; token?: string | null } = {}) {
  const db = fakeDb(over.db ?? BOTH_CAPPED)
  const net = fakeFetcher({
    [`${ACCOUNT}/campaigns`]: listRoute(ACTIVE_ABO_CAMPAIGNS),
    [`${ACCOUNT}/adsets`]: listRoute(ACTIVE_ADSETS),
    ...over.routes,
  })
  const result = readBudgetFacts({
    supabase: db.supabase, clientId: CLIENT, adAccountId: ACCOUNT,
    token: over.token === undefined ? TOKEN : over.token,
    fetcher: net.fetcher, now: NOW, sleep: noSleep,
  })
  return { result, db, net }
}

describe('readBudgetFacts · 读到了', () => {
  it('库里的账户级 + 客户级上限，加上 Meta 现读的在投广告组日预算合计', async () => {
    const { result } = read()
    const { facts, errors } = await result
    expect(errors).toEqual([])
    expect(facts).toEqual({
      read: true, error: null, as_of: NOW.toISOString(),
      account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 1,
      live_daily_budget_cents: 13400, live_lifetime_budget_count: 0, live_entity_count: 3,
    })
  })

  it('库里没设的上限 = null（不是 0）；只设客户级也读得出；没有客户级配置行 = 客户级没设', async () => {
    const { facts } = await read({
      db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: null }], client: { daily_budget_cap_cents: 20000 } },
    }).result
    expect(facts).toMatchObject({ read: true, account_cap_cents: null, client_cap_cents: 20000 })
    const noClientRow = await read({ db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }], client: null } }).result
    expect(noClientRow.facts).toMatchObject({ read: true, account_cap_cents: 15000, client_cap_cents: null })
  })

  it('客户有多个登记账户：只取这个账户自己那一行的上限；登记账户数如实带回（多账户下客户总上限顶替不了账户上限）', async () => {
    const { facts } = await read({
      db: {
        accounts: [
          { ad_account_id: OTHER_ACCOUNT, daily_budget_cap_cents: 99999 },
          { ad_account_id: ACCOUNT, daily_budget_cap_cents: null },
        ],
        client: { daily_budget_cap_cents: 30000 },
      },
    }).result
    expect(facts).toMatchObject({ read: true, account_cap_cents: null, client_cap_cents: 30000, registered_account_count: 2 })
  })

  it('只发 GET、令牌只进 Authorization 头；库查询带客户编号；Meta 只要「在投」状态的系列 / 广告组（状态集合复用共享的 DELIVERING_STATUSES）', async () => {
    const { result, db, net } = read()
    await result
    expect(net.calls.every(c => (c.init?.method ?? 'GET') === 'GET')).toBe(true)
    expect(net.calls.every(c => (c.init?.headers as Record<string, string>).Authorization === `Bearer ${TOKEN}`)).toBe(true)
    expect(net.calls.some(c => c.url.toString().includes(TOKEN))).toBe(false)
    expect(net.calls.map(c => c.url.pathname.replace(/^\/v\d+\.\d+\//, '')).sort()).toEqual([`${ACCOUNT}/adsets`, `${ACCOUNT}/campaigns`])
    for (const c of net.calls) {
      const filtering = JSON.parse(c.url.searchParams.get('filtering') ?? '[]') as { field: string; operator: string; value: string[] }[]
      expect(filtering).toEqual([{ field: 'effective_status', operator: 'IN', value: [...DELIVERING_STATUSES] }])
    }
    // 🔴 要哪些字段是写死的常量（不是可配置项）：路径白名单只管路径，字段不能变成外部可传的东西
    const fieldsByPath = Object.fromEntries(net.calls.map(c => [c.url.pathname.replace(/^\/v\d+\.\d+\//, ''), c.url.searchParams.get('fields')]))
    expect(fieldsByPath).toEqual({
      [`${ACCOUNT}/campaigns`]: 'id,effective_status,daily_budget,lifetime_budget',
      [`${ACCOUNT}/adsets`]: 'id,campaign_id,effective_status,daily_budget,lifetime_budget',
    })
    expect(db.queries.find(q => q.table === 'client_meta_ad_accounts')?.filters).toEqual([['client_id', CLIENT]])
    expect(db.queries.find(q => q.table === 'ad_strategy_configs')?.filters).toEqual([['client_id', CLIENT]])
  })

  it('系列级预算（成组预算）：在投系列有日预算就算系列的，它下面的广告组不重复算', async () => {
    const { facts } = await read({
      routes: {
        [`${ACCOUNT}/campaigns`]: listRoute([
          { id: '5001', effective_status: 'ACTIVE', daily_budget: '20000', lifetime_budget: '0' },
          { id: '5002', effective_status: 'ACTIVE', daily_budget: null },
        ]),
        [`${ACCOUNT}/adsets`]: listRoute([
          { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '9999' },
          { id: '6003', campaign_id: '5002', effective_status: 'ACTIVE', daily_budget: '3400' },
        ]),
      },
    }).result
    expect(facts).toMatchObject({ read: true, live_daily_budget_cents: 23400, live_entity_count: 2 })
  })

  it('已暂停的系列 / 广告组即使被一并返回（过滤没生效）也不计入；没有任何在投的 = 0，是读到的 0', async () => {
    const mixed = await read({
      routes: {
        [`${ACCOUNT}/campaigns`]: listRoute([{ id: '5001', effective_status: 'PAUSED', daily_budget: '8100' }, { id: '5002', effective_status: 'ACTIVE' }]),
        [`${ACCOUNT}/adsets`]: listRoute([
          { id: '6001', campaign_id: '5002', effective_status: 'CAMPAIGN_PAUSED', daily_budget: '7500' },
          { id: '6003', campaign_id: '5002', effective_status: 'ACTIVE', daily_budget: '3400' },
        ]),
      },
    }).result
    expect(mixed.facts).toMatchObject({ read: true, live_daily_budget_cents: 3400, live_entity_count: 1 })
    const none = await read({ routes: { [`${ACCOUNT}/campaigns`]: listRoute([]), [`${ACCOUNT}/adsets`]: listRoute([]) } }).result
    expect(none.facts).toMatchObject({ read: true, live_daily_budget_cents: 0, live_entity_count: 0 })
  })

  it('「在投」的判据跟信封 / 诊断共用 DELIVERING_STATUSES：IN_PROCESS、WITH_ISSUES、PENDING_BILLING_INFO 的广告组都计入（宁可偏保守）', async () => {
    const { facts } = await read({
      routes: {
        [`${ACCOUNT}/adsets`]: listRoute([
          { id: '6001', campaign_id: '5002', effective_status: 'IN_PROCESS', daily_budget: '1000' },
          { id: '6002', campaign_id: '5002', effective_status: 'WITH_ISSUES', daily_budget: '2000' },
          { id: '6003', campaign_id: '5002', effective_status: 'PENDING_BILLING_INFO', daily_budget: '3000' },
          { id: '6004', campaign_id: '5002', effective_status: 'DISAPPROVED', daily_budget: '9000' },
        ]),
      },
    }).result
    expect(facts).toMatchObject({ read: true, live_daily_budget_cents: 6000, live_entity_count: 3 })
  })

  it('在投但用终身预算的（日预算折不出来）单独计数，不并进日预算合计；"0" 不算终身预算；终身预算的成组系列也算一个，它下面的广告组不重复', async () => {
    const adsets = await read({
      routes: {
        [`${ACCOUNT}/adsets`]: listRoute([
          { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '7500', lifetime_budget: '0' },
          { id: '6002', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '0', lifetime_budget: '90000' },
        ]),
      },
    }).result
    expect(adsets.facts).toMatchObject({ read: true, live_daily_budget_cents: 7500, live_lifetime_budget_count: 1, live_entity_count: 1 })
    const cboLifetime = await read({
      routes: {
        [`${ACCOUNT}/campaigns`]: listRoute([{ id: '5001', effective_status: 'ACTIVE', daily_budget: '0', lifetime_budget: '500000' }]),
        [`${ACCOUNT}/adsets`]: listRoute([{ id: '6001', campaign_id: '5001', effective_status: 'ACTIVE' }]),
      },
    }).result
    expect(cboLifetime.facts).toMatchObject({ read: true, live_daily_budget_cents: 0, live_lifetime_budget_count: 1, live_entity_count: 0 })
  })
})

describe('readBudgetFacts · 读不到就是读不到（绝不当成 0 或当成没设）', () => {
  it('库·账户级读失败 / 账户没登记在这个客户名下 / 客户级读失败 → read=false，写明原因', async () => {
    const accountError = await read({ db: { accounts: 'error', client: { daily_budget_cap_cents: 15000 } } }).result
    expect(accountError.facts.read).toBe(false)
    expect(accountError.facts.error).toContain('client_meta_ad_accounts')
    expect(accountError.errors.length).toBeGreaterThan(0)

    const noRows = await read({ db: { accounts: [], client: { daily_budget_cap_cents: 15000 } } }).result
    expect(noRows.facts.read).toBe(false)
    expect(noRows.facts.error).toContain('没登记')

    const onlyOthers = await read({ db: { accounts: [{ ad_account_id: OTHER_ACCOUNT, daily_budget_cap_cents: 15000 }], client: { daily_budget_cap_cents: 15000 } } }).result
    expect(onlyOthers.facts.read).toBe(false)
    expect(onlyOthers.facts.error).toContain('没登记')
    expect(onlyOthers.facts).toMatchObject({ account_cap_cents: null, registered_account_count: null })

    const clientError = await read({ db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }], client: 'error' } }).result
    expect(clientError.facts.read).toBe(false)
    expect(clientError.facts.error).toContain('ad_strategy_configs')
  })

  it('库读失败时上限一律 null（不拿读到一半的数去判）；Meta 照读，在投合计仍然给出', async () => {
    const accountError = await read({ db: { accounts: 'error', client: { daily_budget_cap_cents: 15000 } } }).result
    expect(accountError.facts).toMatchObject({ read: false, account_cap_cents: null, client_cap_cents: null, registered_account_count: null, live_daily_budget_cents: 13400 })
    const clientError = await read({ db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }], client: 'error' } }).result
    expect(clientError.facts).toMatchObject({ read: false, account_cap_cents: null, client_cap_cents: null, live_daily_budget_cents: 13400 })
  })

  it('没有令牌 → Meta 那半边读不了：一个请求都不发，在投合计 = null（不是 0），库里的上限照读', async () => {
    const { result, net } = read({ token: null })
    const { facts } = await result
    expect(net.calls).toHaveLength(0)
    expect(facts).toMatchObject({ read: false, account_cap_cents: 15000, client_cap_cents: 15000, live_daily_budget_cents: null })
    expect(facts.error).toContain('令牌')
  })

  it('Meta 读失败（400）→ read=false，在投合计 null；报错里回显的令牌被抹掉', async () => {
    const failing = await read({
      routes: { [`${ACCOUNT}/adsets`]: () => ({ status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } }) },
    }).result
    expect(failing.facts).toMatchObject({ read: false, live_daily_budget_cents: null })
    expect(JSON.stringify(failing)).not.toContain(TOKEN)
  })

  it('列表有下一页（读不全）/ 响应没有 data 数组 → read=false，不当成「没有在投的」', async () => {
    const paged = await read({ routes: { [`${ACCOUNT}/adsets`]: listRoute(ACTIVE_ADSETS, { paging: { next: 'https://graph.example.test/next' } }) } }).result
    expect(paged.facts).toMatchObject({ read: false, live_daily_budget_cents: null })
    const noData = await read({ routes: { [`${ACCOUNT}/campaigns`]: () => ({ body: { weird: true } }) } }).result
    expect(noData.facts).toMatchObject({ read: false, live_daily_budget_cents: null })
  })

  it('在投的行里日预算 / 终身预算乱码（不是整数）、状态缺失、在投广告组一个预算都没读到 → 整份读不到，不悄悄漏算', async () => {
    for (const bad of [
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: 'abc' },
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '12.5' },
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '-100' },
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', lifetime_budget: 'x' },
      // 一个字段乱码、另一个字段是好的：不能因为「另一个读到了」就放过乱码的那个
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: 'abc', lifetime_budget: '90000' },
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE', daily_budget: '7500', lifetime_budget: 'x' },
      { id: '6001', campaign_id: '5001', daily_budget: '7500' },
      { id: '6001', campaign_id: '5001', effective_status: 'ACTIVE' },
    ] as Json[]) {
      const { facts } = await read({ routes: { [`${ACCOUNT}/adsets`]: listRoute([bad]) } }).result
      expect(facts, JSON.stringify(bad)).toMatchObject({ read: false, live_daily_budget_cents: null })
    }
  })

  it('在投系列自己的预算乱码、而它旗下广告组的预算是好的 → 仍然整份读不到（不能当成「这个系列没有预算」把广告组算进来）', async () => {
    for (const badCampaign of [
      { id: '5001', effective_status: 'ACTIVE', daily_budget: 'abc' },
      { id: '5001', effective_status: 'ACTIVE', daily_budget: '20000', lifetime_budget: 'x' },
    ] as Json[]) {
      const { facts } = await read({ routes: { [`${ACCOUNT}/campaigns`]: listRoute([badCampaign]) } }).result
      expect(facts, JSON.stringify(badCampaign)).toMatchObject({ read: false, live_daily_budget_cents: null })
    }
  })

  it('🔴 库里的上限不是正整数（0 / 负数 / 小数 / 乱码）= 配置无效，读不到——不当作「没设」，更不当作 0（信封里这种配置会被拒）', async () => {
    for (const bad of [0, -5, 1.5, 'x', '0', '-3', '12.5', {}, true]) {
      const account = await read({ db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: bad }], client: { daily_budget_cap_cents: 15000 } } }).result
      expect(account.facts, `账户级 ${JSON.stringify(bad)}`).toMatchObject({ read: false, account_cap_cents: null, client_cap_cents: null })
      expect(account.facts.error, `账户级 ${JSON.stringify(bad)}`).toContain('配置无效')
      const client = await read({ db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }], client: { daily_budget_cap_cents: bad } } }).result
      expect(client.facts, `客户级 ${JSON.stringify(bad)}`).toMatchObject({ read: false, account_cap_cents: null, client_cap_cents: null })
      expect(client.facts.error, `客户级 ${JSON.stringify(bad)}`).toContain('配置无效')
    }
  })

  it('客户级配置行有多条（maybeSingle 报错）→ 读不到，不当作「没设」', async () => {
    const { facts } = await read({ db: { accounts: [{ ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }], client: 'multiple' } }).result
    expect(facts).toMatchObject({ read: false, client_cap_cents: null })
    expect(facts.error).toContain('ad_strategy_configs')
  })

  it('账户编号带不带 act_ 前缀都认（登记表里两种写法都见过）；对不上才是「没登记」', async () => {
    for (const registered of ['1111111111', 'act_1111111111', 'ACT_1111111111', ' act_1111111111 ']) {
      const { facts } = await read({ db: { accounts: [{ ad_account_id: registered, daily_budget_cap_cents: 15000 }], client: { daily_budget_cap_cents: 15000 } } }).result
      expect(facts, registered).toMatchObject({ read: true, account_cap_cents: 15000, registered_account_count: 1 })
    }
    const other = await read({ db: { accounts: [{ ad_account_id: '2222222222', daily_budget_cap_cents: 15000 }], client: { daily_budget_cap_cents: 15000 } } }).result
    expect(other.facts.read).toBe(false)
    expect(other.facts.error).toContain('没登记')
  })

  it('老客户登记表里一行都没有：回落到 clients.meta_ad_account_id（账户级上限 = 客户级上限，单账户），跟信封一致；对不上 / 没有 / 读失败 → 读不到', async () => {
    const hit = await read({ db: { accounts: [], legacy: 'act_1111111111', client: { daily_budget_cap_cents: 15000 } } }).result
    expect(hit.facts).toMatchObject({ read: true, account_cap_cents: 15000, client_cap_cents: 15000, registered_account_count: 1 })
    const hitNoPrefix = await read({ db: { accounts: [], legacy: '1111111111', client: { daily_budget_cap_cents: 15000 } } }).result
    expect(hitNoPrefix.facts).toMatchObject({ read: true, account_cap_cents: 15000, registered_account_count: 1 })
    // 回落时客户级上限没设 → 账户级也是没设（null），由判灯判成「没设」
    const noClientCap = await read({ db: { accounts: [], legacy: 'act_1111111111', client: null } }).result
    expect(noClientCap.facts).toMatchObject({ read: true, account_cap_cents: null, client_cap_cents: null })

    for (const legacy of ['act_9999999999', null] as const) {
      const miss = await read({ db: { accounts: [], legacy, client: { daily_budget_cap_cents: 15000 } } }).result
      expect(miss.facts.read, String(legacy)).toBe(false)
      expect(miss.facts.error, String(legacy)).toContain('没登记')
    }
    const failed = await read({ db: { accounts: [], legacy: 'error', client: { daily_budget_cap_cents: 15000 } } }).result
    expect(failed.facts.read).toBe(false)
    expect(failed.facts.error).toContain('clients')
  })

  it('🔴 登记表读回来的不是列表 / 列表里有看不懂的行 = 读坏了，读不到——绝不当成「一行都没有」去回落老字段（回落只认读成功的空列表）', async () => {
    const good = { ad_account_id: ACCOUNT, daily_budget_cap_cents: 15000 }
    for (const raw of [null, {}, 'oops', 42, [null], ['oops'], [good, 42]]) {
      const label = JSON.stringify(raw)
      const { result, db } = read({ db: { accounts: { raw }, legacy: 'act_1111111111', client: { daily_budget_cap_cents: 15000 } } })
      const { facts } = await result
      expect(facts, label).toMatchObject({ read: false, account_cap_cents: null, client_cap_cents: null })
      expect(facts.error, label).toContain('client_meta_ad_accounts')
      expect(db.queries.some(q => q.table === 'clients'), label).toBe(false)
    }
    // 对照：真的是空列表才回落（读成功、确实一行都没有）
    const empty = await read({ db: { accounts: { raw: [] }, legacy: 'act_1111111111', client: { daily_budget_cap_cents: 15000 } } }).result
    expect(empty.facts).toMatchObject({ read: true, account_cap_cents: 15000, registered_account_count: 1 })
  })

  it('登记表里有别的账户的行时，不再回落到老字段（只有一行都没有才回落）', async () => {
    const { result, db } = read({ db: { accounts: [{ ad_account_id: OTHER_ACCOUNT, daily_budget_cap_cents: 15000 }], legacy: 'act_1111111111', client: { daily_budget_cap_cents: 15000 } } })
    const { facts } = await result
    expect(facts.read).toBe(false)
    expect(db.queries.some(q => q.table === 'clients')).toBe(false)
  })

  it('系列列表有下一页、广告组列表没有 → 同样读不到（两个列表各自判分页，不能只判一个）', async () => {
    const paged = await read({ routes: { [`${ACCOUNT}/campaigns`]: listRoute(ACTIVE_ABO_CAMPAIGNS, { paging: { next: 'https://graph.example.test/next' } }) } }).result
    expect(paged.facts).toMatchObject({ read: false, live_daily_budget_cents: null })
  })

  it('广告账户编号格式不对 → 直接读不到，库和 Meta 一个请求都不发', async () => {
    const db = fakeDb(BOTH_CAPPED)
    const net = fakeFetcher()
    const { facts } = await readBudgetFacts({
      supabase: db.supabase, clientId: CLIENT, adAccountId: 'not-an-account', token: TOKEN, fetcher: net.fetcher, now: NOW, sleep: noSleep,
    })
    expect(facts.read).toBe(false)
    expect(net.calls).toHaveLength(0)
    expect(db.queries).toHaveLength(0)
  })
})
