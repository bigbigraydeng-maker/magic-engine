/**
 * 三个读取器（GA4 / CRM / 环境）的契约测试 —— 先写测试，实现后补。
 *
 * 本文件最终会挪到 src/lib/ads-tracking-preflight/__tests__/readers.test.ts，
 * 所以所有 import 都按「住在 __tests__ 里」来写。
 *
 * 假 Supabase 沿用仓库里 promo-plan-watch-items.test.ts 的写法：手写链式对象，
 * 每个方法返回链本身，最后一个被 await 的方法 resolve { data, error }（这里还有 count）。
 * 假库会记录读过哪张表、加了哪些过滤条件，供断言使用。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CrmFacts, EnvFacts, Ga4Facts } from '../types'
import { makeSupabasePropertyLoader, readGa4Facts, type Ga4ReadDeps } from '../ga4-reader'
import { readCrmFacts } from '../crm-reader'
import { REQUIRED_JOBS, readEnvFacts, type EnvReadDeps } from '../env-reader'
import { RETRY_DELAY_MS } from '../retry'

const NOW = new Date('2026-10-19T10:30:00.000Z')
const NOW_ISO = NOW.toISOString()
const SEVEN_DAYS_AGO_ISO = '2026-10-12T10:30:00.000Z'
const SECRET = 'SECRET_TOKEN_VALUE_123'

/** 测试里不真等：失败重试前的等待直接略过（要看等待的用例自己传记录器）。 */
const noSleep = async (): Promise<void> => undefined

// ─── 假 Supabase ────────────────────────────────────────────────────────────

type Filter = { op: 'eq' | 'neq' | 'gte'; column: string; value: unknown }

interface RecordedQuery {
  table: string
  select: string | null
  selectOptions: unknown
  filters: Filter[]
  order: { column: string; ascending: boolean } | null
  limit: number | null
}

interface FakeResult {
  data: unknown
  error: { message: string } | null
  count?: number | null
}

type Responder = (q: RecordedQuery) => FakeResult

interface FakeDb {
  queries: RecordedQuery[]
  supabase: SupabaseClient
}

/**
 * 唯一的「假库 → SupabaseClient」转换点。
 * 假库只实现本测试用到的链式方法；用一次类型断言把它交给 SupabaseClient 的位置。
 */
function makeFakeDb(respond: Responder): FakeDb {
  const queries: RecordedQuery[] = []
  const supabase = {
    from(table: string) {
      const q: RecordedQuery = {
        table,
        select: null,
        selectOptions: null,
        filters: [],
        order: null,
        limit: null,
      }
      queries.push(q)
      const finish = (): FakeResult => respond(q)
      const chain = {
        select(columns: string, options?: unknown) {
          q.select = columns
          q.selectOptions = options ?? null
          return chain
        },
        eq(column: string, value: unknown) {
          q.filters.push({ op: 'eq', column, value })
          return chain
        },
        neq(column: string, value: unknown) {
          q.filters.push({ op: 'neq', column, value })
          return chain
        },
        gte(column: string, value: unknown) {
          q.filters.push({ op: 'gte', column, value })
          return chain
        },
        order(column: string, options?: { ascending?: boolean }) {
          q.order = { column, ascending: options?.ascending ?? true }
          return chain
        },
        limit(n: number) {
          q.limit = n
          return Promise.resolve(finish())
        },
        maybeSingle() {
          return Promise.resolve(finish())
        },
        then(
          onFulfilled: (value: FakeResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(finish()).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
  return { queries, supabase: supabase as unknown as SupabaseClient }
}

const ok = (data: unknown, count?: number | null): FakeResult => ({ data, error: null, count: count ?? null })
const fail = (message: string): FakeResult => ({ data: null, error: { message }, count: null })

const findQuery = (db: FakeDb, table: string): RecordedQuery => {
  const q = db.queries.find(x => x.table === table)
  if (!q) throw new Error(`没有读到表：${table}`)
  return q
}

const filterValue = (q: RecordedQuery, column: string): unknown =>
  q.filters.find(f => f.column === column)?.value

// ─── MODULE 1: GA4 ──────────────────────────────────────────────────────────

interface Ga4DepsSpy {
  deps: Ga4ReadDeps
  loadCalls: string[]
  fetchCalls: { propertyId: string; clientId: string; eventNames: readonly string[]; periodDays: number }[]
}

function makeGa4Deps(over: Partial<Ga4ReadDeps> = {}): Ga4DepsSpy {
  const loadCalls: string[] = []
  const fetchCalls: Ga4DepsSpy['fetchCalls'] = []
  const deps: Ga4ReadDeps = {
    async loadPropertyId(clientId) {
      loadCalls.push(clientId)
      return over.loadPropertyId ? over.loadPropertyId(clientId) : '111'
    },
    async fetchEventCounts(propertyId, clientId, eventNames, periodDays) {
      fetchCalls.push({ propertyId, clientId, eventNames, periodDays })
      return over.fetchEventCounts
        ? over.fetchEventCounts(propertyId, clientId, eventNames, periodDays)
        : { generate_lead: 8 }
    },
    sleep: over.sleep ?? noSleep,
  }
  return { deps, loadCalls, fetchCalls }
}

describe('GA4 读取器', () => {
  it('读到属性编号和事件次数 → 绿，facts 形状正确，按 7 天窗口取数', async () => {
    const spy = makeGa4Deps()
    const eventNames = ['generate_lead']
    const { facts, errors } = await readGa4Facts({ clientId: 'c1', eventNames, now: NOW }, spy.deps)

    expect(facts).toEqual<Ga4Facts>({
      read: true,
      error: null,
      events_7d: { generate_lead: 8 },
      as_of: NOW_ISO,
    })
    expect(errors).toEqual([])
    expect(spy.fetchCalls).toEqual([
      { propertyId: '111', clientId: 'c1', eventNames, periodDays: 7 },
    ])
  })

  it('客户没连 GA4 属性 → 灰，文案提到 GA4，不去取事件', async () => {
    const spy = makeGa4Deps({ loadPropertyId: async () => null })
    const { facts, errors } = await readGa4Facts(
      { clientId: 'c1', eventNames: ['generate_lead'], now: NOW },
      spy.deps,
    )

    expect(facts.read).toBe(false)
    expect(facts.error).toContain('GA4')
    expect(facts.events_7d).toEqual({})
    expect(spy.fetchCalls).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBe(facts.error)
  })

  it('取事件返回 null（没有可用的 Google 授权）→ 灰，文案提到授权', async () => {
    const spy = makeGa4Deps({ fetchEventCounts: async () => null })
    const { facts, errors } = await readGa4Facts(
      { clientId: 'c1', eventNames: ['generate_lead'], now: NOW },
      spy.deps,
    )

    expect(facts.read).toBe(false)
    expect(facts.error).toContain('授权')
    expect(errors).toHaveLength(1)
  })

  it('取事件抛错且错误里带令牌 → 不 reject，令牌不出现在 facts / errors 里', async () => {
    const spy = makeGa4Deps({
      fetchEventCounts: async () => {
        throw new Error(`HTTP 403 access_token=${SECRET}`)
      },
    })
    const { facts, errors } = await readGa4Facts(
      { clientId: 'c1', eventNames: ['generate_lead'], now: NOW },
      spy.deps,
    )

    expect(facts.read).toBe(false)
    expect(JSON.stringify(facts)).not.toContain(SECRET)
    expect(JSON.stringify(errors)).not.toContain(SECRET)
  })

  it('读属性编号就抛错 → 同样优雅降级（read false）', async () => {
    const spy = makeGa4Deps({
      loadPropertyId: async () => {
        throw new Error('boom')
      },
    })
    const { facts } = await readGa4Facts(
      { clientId: 'c1', eventNames: ['generate_lead'], now: NOW },
      spy.deps,
    )

    expect(facts.read).toBe(false)
    expect(facts.events_7d).toEqual({})
  })
})

describe('GA4 属性加载器（读 client_connectors）', () => {
  it('按 client_id / anchor=ga4 / status=connected 过滤，返回 config.property_id', async () => {
    const db = makeFakeDb(() => ok({ config: { property_id: '111' } }))
    const load = makeSupabasePropertyLoader(db.supabase)

    await expect(load('c1')).resolves.toBe('111')

    const q = findQuery(db, 'client_connectors')
    expect(filterValue(q, 'client_id')).toBe('c1')
    expect(filterValue(q, 'anchor')).toBe('ga4')
    expect(filterValue(q, 'status')).toBe('connected')
  })

  it('没有行 → null', async () => {
    const db = makeFakeDb(() => ok(null))
    await expect(makeSupabasePropertyLoader(db.supabase)('c1')).resolves.toBeNull()
  })

  it('config 里没有 property_id → null', async () => {
    const db = makeFakeDb(() => ok({ config: {} }))
    await expect(makeSupabasePropertyLoader(db.supabase)('c1')).resolves.toBeNull()
  })

  it('数字型 property_id（123）→ 字符串 "123"', async () => {
    const db = makeFakeDb(() => ok({ config: { property_id: 123 } }))
    await expect(makeSupabasePropertyLoader(db.supabase)('c1')).resolves.toBe('123')
  })

  it('Supabase 报错 → loader reject，message 就是 Supabase 的 message', async () => {
    const db = makeFakeDb(() => fail('boom'))
    await expect(makeSupabasePropertyLoader(db.supabase)('c1')).rejects.toThrow('boom')
  })
})

// ─── MODULE 2: CRM ──────────────────────────────────────────────────────────

describe('CRM 读取器（读 contact_touchpoints）', () => {
  it('有线索 → 计数和最近时间都对，read true', async () => {
    const db = makeFakeDb(() => ok([{ occurred_at: '2026-10-19T05:00:00Z' }], 6))
    const { facts, errors } = await readCrmFacts(db.supabase, 'c1', NOW)

    expect(facts).toEqual<CrmFacts>({
      read: true,
      error: null,
      web_form_touchpoints_7d: 6,
      latest_web_form_at: '2026-10-19T05:00:00Z',
      as_of: NOW_ISO,
    })
    expect(errors).toEqual([])
  })

  it('空结果 → 0 条、最近时间为 null，read 仍为 true', async () => {
    const db = makeFakeDb(() => ok([], 0))
    const { facts } = await readCrmFacts(db.supabase, 'c1', NOW)

    expect(facts.read).toBe(true)
    expect(facts.web_form_touchpoints_7d).toBe(0)
    expect(facts.latest_web_form_at).toBeNull()
  })

  it('过滤条件：client_id、channel=web_form、occurred_at >= 7 天前', async () => {
    const db = makeFakeDb(() => ok([], 0))
    await readCrmFacts(db.supabase, 'c1', NOW)

    const q = findQuery(db, 'contact_touchpoints')
    expect(filterValue(q, 'client_id')).toBe('c1')
    expect(filterValue(q, 'channel')).toBe('web_form')
    expect(filterValue(q, 'occurred_at')).toBe(SEVEN_DAYS_AGO_ISO)
    expect(q.order).toEqual({ column: 'occurred_at', ascending: false })
    expect(q.limit).toBe(1)
  })

  it('Supabase 报错 → read false，error 带原因，计数 0', async () => {
    const db = makeFakeDb(() => fail('boom'))
    const { facts, errors } = await readCrmFacts(db.supabase, 'c1', NOW, noSleep)

    expect(facts.read).toBe(false)
    expect(facts.error).toContain('boom')
    expect(facts.web_form_touchpoints_7d).toBe(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('boom')
  })

  it('as_of 是 now 的 ISO', async () => {
    const db = makeFakeDb(() => ok([], 0))
    const { facts } = await readCrmFacts(db.supabase, 'c1', NOW)
    expect(facts.as_of).toBe(NOW_ISO)
  })
})

// ─── MODULE 3: 环境 ─────────────────────────────────────────────────────────

interface EnvDepsSpy {
  deps: EnvReadDeps
  preflightCalls: string[]
  tokenCalls: string[]
}

interface EnvDepsOverrides {
  capiPreflight?: EnvReadDeps['capiPreflight']
  resolveMetaToken?: EnvReadDeps['resolveMetaToken']
  env?: Record<string, string | undefined>
  sleep?: EnvReadDeps['sleep']
}

function makeEnvDeps(supabase: SupabaseClient, over: EnvDepsOverrides = {}): EnvDepsSpy {
  const preflightCalls: string[] = []
  const tokenCalls: string[] = []
  const deps: EnvReadDeps = {
    supabase,
    env: over.env ?? {},
    async capiPreflight(clientId) {
      preflightCalls.push(clientId)
      return over.capiPreflight
        ? over.capiPreflight(clientId)
        : { ok: true, detail: {} }
    },
    async resolveMetaToken(clientId) {
      tokenCalls.push(clientId)
      return over.resolveMetaToken ? over.resolveMetaToken(clientId) : null
    },
    sleep: over.sleep ?? noSleep,
  }
  return { deps, preflightCalls, tokenCalls }
}

/** 一个能同时服务 clients / me_conversion_writebacks / cron_run_logs 的假库。 */
interface EnvDbOptions {
  clientRow?: { domain: string | null } | null
  clientError?: string
  writebacks?: { status: string }[]
  writebacksError?: string
  cronRows?: Record<string, { status: string | null; finished_at: string | null; started_at: string | null } | null>
  cronError?: Record<string, string>
}

function makeEnvDb(opts: EnvDbOptions = {}): FakeDb {
  return makeFakeDb(q => {
    if (q.table === 'clients') {
      if (opts.clientError) return fail(opts.clientError)
      return ok(opts.clientRow ?? null)
    }
    if (q.table === 'me_conversion_writebacks') {
      if (opts.writebacksError) return fail(opts.writebacksError)
      return ok(opts.writebacks ?? [])
    }
    if (q.table === 'cron_run_logs') {
      const job = filterValue(q, 'job_name')
      if (typeof job === 'string' && opts.cronError && opts.cronError[job]) {
        return fail(opts.cronError[job])
      }
      const row = typeof job === 'string' ? opts.cronRows?.[job] ?? null : null
      // 真实的 limit(1) 返回数组，假库要跟真实形状一致
      return ok(row ? [row] : [])
    }
    return fail(`不该读这张表：${q.table}`)
  })
}

const PIXEL_ENV_KEY = 'META_PIXEL_ID_SHOP_EXAMPLE_TEST'

describe('环境读取器：整体', () => {
  it('四张表都读得到 → 完整 facts 形状正确', async () => {
    const db = makeEnvDb({
      clientRow: { domain: 'shop.example.test' },
      writebacks: [
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'in_doubt' },
        { status: 'failed' },
        { status: 'failed_permanent' },
        { status: 'queued' },
      ],
      cronRows: {
        'meta-leads-sync': { status: 'completed', finished_at: '2026-10-19T09:00:00Z', started_at: '2026-10-19T08:55:00Z' },
        'messenger-sync-hourly': { status: 'completed', finished_at: '2026-10-19T09:30:00Z', started_at: '2026-10-19T09:25:00Z' },
      },
    })
    const spy = makeEnvDeps(db.supabase, {
      env: { [PIXEL_ENV_KEY]: '1234567890' },
      capiPreflight: async () => ({
        ok: true,
        detail: { stage: 'token_ok', token_valid: true, pixel_visible: true },
      }),
      resolveMetaToken: async () => 'tok',
    })

    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    expect(facts).toEqual<EnvFacts>({
      capi_target: { status: 'configured', pixel_id: '1234567890' },
      capi_preflight: { ok: true, stage: 'token_ok', token_valid: true, pixel_visible: true },
      capi_events_7d: { confirmed: 2, in_doubt: 1, failed: 2 },
      meta_token_resolved: true,
      jobs: [
        { job: 'meta-leads-sync', max_age_hours: 3, last_finished_at: '2026-10-19T09:00:00Z', last_status: 'completed' },
        { job: 'messenger-sync-hourly', max_age_hours: 3, last_finished_at: '2026-10-19T09:30:00Z', last_status: 'completed' },
      ],
      as_of: NOW_ISO,
    })
    expect(errors).toEqual([])
  })
})

describe('环境读取器：capi_target', () => {
  it('域名映射到环境变量且值存在 → configured', async () => {
    const db = makeEnvDb({ clientRow: { domain: 'shop.example.test' } })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'configured', pixel_id: '1234567890' })
  })

  it('环境变量缺失 → not_configured', async () => {
    const db = makeEnvDb({ clientRow: { domain: 'shop.example.test' } })
    const spy = makeEnvDeps(db.supabase, { env: {} })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'not_configured', pixel_id: null })
  })

  it('环境变量为空串 → not_configured', async () => {
    const db = makeEnvDb({ clientRow: { domain: 'shop.example.test' } })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '' } })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'not_configured', pixel_id: null })
  })

  it('环境变量的值不是纯数字（比如把令牌填错了位置）→ unreadable，且不把这个值带出来', async () => {
    const db = makeEnvDb({ clientRow: { domain: 'shop.example.test' } })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: 'NOT_A_PIXEL_VALUE_XYZ' } })
    const result = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(result.facts.capi_target).toEqual({ status: 'unreadable', pixel_id: null })
    expect(JSON.stringify(result)).not.toContain('NOT_A_PIXEL_VALUE_XYZ')
  })

  it('客户行不存在 → unreadable', async () => {
    const db = makeEnvDb({ clientRow: null })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'unreadable', pixel_id: null })
  })

  it('domain 为 null → unreadable', async () => {
    const db = makeEnvDb({ clientRow: { domain: null } })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'unreadable', pixel_id: null })
  })

  it('读 clients 报错 → unreadable，并记一条 errors', async () => {
    const db = makeEnvDb({ clientError: 'boom' })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'unreadable', pixel_id: null })
    expect(errors.some(e => e.includes('boom'))).toBe(true)
  })
})

describe('环境读取器：库本身抛异常（不是返回 error）也不 reject', () => {
  it('任意一张表的查询直接抛错 → 只降级对应部分，其余照常，留一条已清洗的错误', async () => {
    const real = makeEnvDb({ clientRow: { domain: 'shop.example.test' }, writebacks: [{ status: 'confirmed' }] })
    const throwing = {
      from(table: string) {
        if (table === 'me_conversion_writebacks') throw new Error(`connection reset access_token=${SECRET}`)
        return real.supabase.from(table)
      },
    } as SupabaseClient
    const spy = makeEnvDeps(throwing, { env: { [PIXEL_ENV_KEY]: '1234567890' } })

    const result = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    expect(result.facts.capi_events_7d).toBeNull()
    expect(result.facts.capi_target).toEqual({ status: 'configured', pixel_id: '1234567890' })
    expect(result.errors.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})

describe('环境读取器：capi_preflight', () => {
  it('只保留 ok / stage / token_valid / pixel_visible，其余 detail 全部丢掉', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => ({
        ok: true,
        detail: {
          stage: 'token_ok',
          token_valid: true,
          pixel_visible: true,
          pixel_id: 'PIXEL_SHOULD_NOT_LEAK',
          token_scopes: ['ads_management', 'business_management'],
          graph_version: 'v21.0',
          errors: ['something'],
        },
      }),
    })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    expect(facts.capi_preflight).toEqual({
      ok: true,
      stage: 'token_ok',
      token_valid: true,
      pixel_visible: true,
    })
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain('PIXEL_SHOULD_NOT_LEAK')
    expect(serialized).not.toContain('ads_management')
    expect(serialized).not.toContain('business_management')
    expect(serialized).not.toContain('v21.0')
  })

  it('detail 里字段类型不对 → 对应字段为 null', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => ({
        ok: false,
        detail: { stage: 42, token_valid: 'yes', pixel_visible: null },
      }),
    })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_preflight).toEqual({
      ok: false,
      stage: null,
      token_valid: null,
      pixel_visible: null,
    })
  })

  it('capiPreflight 抛错 → capi_preflight 为 null，errors 记一条', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => {
        throw new Error('preflight boom')
      },
    })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_preflight).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('环境读取器：capi_events_7d', () => {
  it('按状态计数，未知状态忽略', async () => {
    const db = makeEnvDb({
      writebacks: [
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'confirmed' },
        { status: 'in_doubt' },
        { status: 'failed' },
        { status: 'failed_permanent' },
        { status: 'failed_permanent' },
        { status: 'queued' },
        { status: 'pending' },
      ],
    })
    const spy = makeEnvDeps(db.supabase)
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_events_7d).toEqual({ confirmed: 3, in_doubt: 1, failed: 3 })
  })

  it('读回传表报错 → capi_events_7d 为 null，errors 记一条', async () => {
    const db = makeEnvDb({ writebacksError: 'boom' })
    const spy = makeEnvDeps(db.supabase)
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_events_7d).toBeNull()
    expect(errors.some(e => e.includes('boom'))).toBe(true)
  })

  it('回传查询的过滤条件正确', async () => {
    const db = makeEnvDb({ writebacks: [] })
    const spy = makeEnvDeps(db.supabase)
    await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    const q = findQuery(db, 'me_conversion_writebacks')
    expect(filterValue(q, 'destination')).toBe('meta_capi')
    expect(filterValue(q, 'me_sale_outcomes.client_id')).toBe('c1')
    expect(filterValue(q, 'created_at')).toBe(SEVEN_DAYS_AGO_ISO)
  })
})

describe('环境读取器：meta_token_resolved', () => {
  it('解析到令牌 → true，令牌值不出现在结果里', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, { resolveMetaToken: async () => SECRET })
    const result = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    expect(result.facts.meta_token_resolved).toBe(true)
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('解析不到 → false', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, { resolveMetaToken: async () => null })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.meta_token_resolved).toBe(false)
  })

  it('解析器抛错 → false，errors 记一条', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, {
      resolveMetaToken: async () => {
        throw new Error('token boom')
      },
    })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.meta_token_resolved).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('环境读取器：jobs', () => {
  it('有行 → 映射 finished_at / status；无行 → 两个 null', async () => {
    const db = makeEnvDb({
      cronRows: {
        'meta-leads-sync': { status: 'completed', finished_at: '2026-10-19T09:00:00Z', started_at: '2026-10-19T08:55:00Z' },
        'messenger-sync-hourly': null,
      },
    })
    const spy = makeEnvDeps(db.supabase)
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    expect(facts.jobs).toEqual([
      { job: 'meta-leads-sync', max_age_hours: 3, last_finished_at: '2026-10-19T09:00:00Z', last_status: 'completed' },
      { job: 'messenger-sync-hourly', max_age_hours: 3, last_finished_at: null, last_status: null },
    ])
  })

  it('某个 job 读库报错 → 该 job 两个 null，errors 记一条，其他 job 不受影响', async () => {
    const db = makeEnvDb({
      cronRows: {
        'meta-leads-sync': { status: 'completed', finished_at: '2026-10-19T09:00:00Z', started_at: '2026-10-19T08:55:00Z' },
        'messenger-sync-hourly': null,
      },
      cronError: { 'messenger-sync-hourly': 'boom' },
    })
    const spy = makeEnvDeps(db.supabase)
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    expect(facts.jobs[0].last_status).toBe('completed')
    expect(facts.jobs[1]).toEqual({
      job: 'messenger-sync-hourly',
      max_age_hours: 3,
      last_finished_at: null,
      last_status: null,
    })
    expect(errors.some(e => e.includes('boom'))).toBe(true)
  })

  it('自定义 requiredJobs 覆盖默认列表，顺序按传入顺序', async () => {
    const db = makeEnvDb({
      cronRows: {
        'custom-a': { status: 'completed', finished_at: '2026-10-19T09:00:00Z', started_at: '2026-10-19T08:55:00Z' },
        'custom-b': { status: 'failed', finished_at: '2026-10-19T08:00:00Z', started_at: '2026-10-19T07:55:00Z' },
      },
    })
    const spy = makeEnvDeps(db.supabase)
    const requiredJobs = [
      { job: 'custom-b', max_age_hours: 1 },
      { job: 'custom-a', max_age_hours: 6 },
    ]
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW, requiredJobs }, spy.deps)

    expect(facts.jobs).toEqual([
      { job: 'custom-b', max_age_hours: 1, last_finished_at: '2026-10-19T08:00:00Z', last_status: 'failed' },
      { job: 'custom-a', max_age_hours: 6, last_finished_at: '2026-10-19T09:00:00Z', last_status: 'completed' },
    ])
  })

  it('cron_run_logs 查询的过滤条件正确（eq job_name、neq running、按 started_at 倒序、limit 1）', async () => {
    const db = makeEnvDb({
      cronRows: {
        'meta-leads-sync': null,
        'messenger-sync-hourly': null,
      },
    })
    const spy = makeEnvDeps(db.supabase)
    await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)

    const cronQueries = db.queries.filter(q => q.table === 'cron_run_logs')
    expect(cronQueries).toHaveLength(REQUIRED_JOBS.length)
    for (const q of cronQueries) {
      expect(q.filters.some(f => f.op === 'eq' && f.column === 'job_name')).toBe(true)
      expect(q.filters.some(f => f.op === 'neq' && f.column === 'status' && f.value === 'running')).toBe(true)
      expect(q.order).toEqual({ column: 'started_at', ascending: false })
      expect(q.limit).toBe(1)
    }
  })
})

describe('环境读取器：默认任务清单', () => {
  it('REQUIRED_JOBS 就是两个同步任务，各 3 小时', () => {
    expect(REQUIRED_JOBS).toEqual([
      { job: 'meta-leads-sync', max_age_hours: 3 },
      { job: 'messenger-sync-hourly', max_age_hours: 3 },
    ])
  })
})

// ─── 瞬时故障重试一次（审查整改）─────────────────────────────────────────────
// 读取器永不 reject，函数级的 retries: 2 救不了一次抖动；每个读取在读取器内部多试一次。

function sleepLog() {
  const sleeps: number[] = []
  return { sleeps, sleep: async (ms: number): Promise<void> => { sleeps.push(ms) } }
}

describe('GA4 读取器 · 瞬时故障重试一次', () => {
  it('读属性编号第一次抛错、第二次正常 → 读到事件次数，没有错误；中间等了一次', async () => {
    const log = sleepLog()
    let n = 0
    const spy = makeGa4Deps({
      sleep: log.sleep,
      loadPropertyId: async () => { n += 1; if (n === 1) throw new Error('socket hang up'); return '111' },
    })
    const { facts, errors } = await readGa4Facts({ clientId: 'c1', eventNames: ['generate_lead'], now: NOW }, spy.deps)
    expect(facts.read).toBe(true)
    expect(facts.events_7d).toEqual({ generate_lead: 8 })
    expect(errors).toEqual([])
    expect(log.sleeps).toEqual([RETRY_DELAY_MS])
  })

  it('取事件第一次抛错、第二次正常 → read 为 true', async () => {
    let n = 0
    const spy = makeGa4Deps({ fetchEventCounts: async () => { n += 1; if (n === 1) throw new Error('timeout'); return { generate_lead: 3 } } })
    const { facts } = await readGa4Facts({ clientId: 'c1', eventNames: ['generate_lead'], now: NOW }, spy.deps)
    expect(facts).toMatchObject({ read: true, events_7d: { generate_lead: 3 } })
    expect(spy.fetchCalls).toHaveLength(2)
  })

  it('取事件连着两次抛错 → read 为 false，只试两次，令牌不外泄，errors 只有一条', async () => {
    const spy = makeGa4Deps({ fetchEventCounts: async () => { throw new Error(`HTTP 503 access_token=${SECRET}`) } })
    const { facts, errors } = await readGa4Facts({ clientId: 'c1', eventNames: ['generate_lead'], now: NOW }, spy.deps)
    expect(facts.read).toBe(false)
    expect(spy.fetchCalls).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(JSON.stringify({ facts, errors })).not.toContain(SECRET)
  })

  it('没有可用的 Google 授权（返回 null）/ 没连 GA4（属性为 null）不是瞬时故障：不重试', async () => {
    const noAuth = makeGa4Deps({ fetchEventCounts: async () => null })
    await readGa4Facts({ clientId: 'c1', eventNames: ['generate_lead'], now: NOW }, noAuth.deps)
    expect(noAuth.fetchCalls).toHaveLength(1)

    const notConnected = makeGa4Deps({ loadPropertyId: async () => null })
    await readGa4Facts({ clientId: 'c1', eventNames: ['generate_lead'], now: NOW }, notConnected.deps)
    expect(notConnected.loadCalls).toHaveLength(1)
  })
})

describe('CRM 读取器 · 瞬时故障重试一次', () => {
  it('第一次查库报错、第二次正常 → read 为 true，没有错误；中间等了一次', async () => {
    const log = sleepLog()
    let n = 0
    const db = makeFakeDb(() => { n += 1; return n === 1 ? fail('connection reset') : ok([{ occurred_at: '2026-10-19T05:00:00Z' }], 4) })
    const { facts, errors } = await readCrmFacts(db.supabase, 'c1', NOW, log.sleep)
    expect(facts).toMatchObject({ read: true, web_form_touchpoints_7d: 4, latest_web_form_at: '2026-10-19T05:00:00Z' })
    expect(errors).toEqual([])
    expect(log.sleeps).toEqual([RETRY_DELAY_MS])
  })

  it('第一次查库直接抛错、第二次正常 → 照样读到', async () => {
    let n = 0
    const db = makeFakeDb(() => { n += 1; if (n === 1) throw new Error('socket hang up'); return ok([], 0) })
    const { facts } = await readCrmFacts(db.supabase, 'c1', NOW, noSleep)
    expect(facts.read).toBe(true)
  })

  it('连着两次报错 → read 为 false，errors 只记一条（不是每次尝试一条），一共只查两次', async () => {
    const db = makeFakeDb(() => fail('boom'))
    const { facts, errors } = await readCrmFacts(db.supabase, 'c1', NOW, noSleep)
    expect(facts.read).toBe(false)
    expect(errors).toHaveLength(1)
    expect(db.queries.filter(q => q.table === 'contact_touchpoints')).toHaveLength(2)
  })
})

describe('环境读取器 · 瞬时故障重试一次', () => {
  it('读 clients 第一次报错、第二次正常 → 回传目标读到，没有错误', async () => {
    let n = 0
    const real = makeEnvDb({ clientRow: { domain: 'shop.example.test' } })
    const flaky = { from(table: string) { if (table === 'clients') { n += 1; if (n === 1) throw new Error('reset') } return real.supabase.from(table) } } as SupabaseClient
    const spy = makeEnvDeps(flaky, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'configured', pixel_id: '1234567890' })
    expect(errors).toEqual([])
  })

  it('读 clients 返回 error 对象第一次、第二次正常 → 同样读到', async () => {
    let n = 0
    const db = makeFakeDb(q => {
      if (q.table === 'clients') { n += 1; return n === 1 ? fail('boom') : ok({ domain: 'shop.example.test' }) }
      if (q.table === 'me_conversion_writebacks') return ok([])
      return ok([])
    })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target.status).toBe('configured')
    expect(errors.some(e => e.includes('boom'))).toBe(false)
  })

  it('回传表和 cron_run_logs 第一次报错、第二次正常 → 照常读到', async () => {
    const seen: Record<string, number> = {}
    const db = makeFakeDb(q => {
      const key = q.table === 'cron_run_logs' ? `cron:${String(filterValue(q, 'job_name'))}` : q.table
      seen[key] = (seen[key] ?? 0) + 1
      if (seen[key] === 1) return fail('blip')
      if (q.table === 'clients') return ok({ domain: 'shop.example.test' })
      if (q.table === 'me_conversion_writebacks') return ok([{ status: 'confirmed' }])
      return ok([{ status: 'completed', finished_at: '2026-10-19T09:30:00Z', started_at: '2026-10-19T09:25:00Z' }])
    })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_events_7d).toEqual({ confirmed: 1, in_doubt: 0, failed: 0 })
    expect(facts.jobs.every(j => j.last_status === 'completed')).toBe(true)
    expect(errors).toEqual([])
  })

  it('capiPreflight / resolveMetaToken 第一次抛错、第二次正常 → 都读到，没有错误', async () => {
    const db = makeEnvDb()
    let pre = 0
    let tok = 0
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => { pre += 1; if (pre === 1) throw new Error('timeout'); return { ok: true, detail: { token_valid: true } } },
      resolveMetaToken: async () => { tok += 1; if (tok === 1) throw new Error('db blip'); return 'tok' },
    })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_preflight).toMatchObject({ ok: true, token_valid: true })
    expect(facts.meta_token_resolved).toBe(true)
    expect(errors).toEqual([])
    expect(spy.preflightCalls).toHaveLength(2)
    expect(spy.tokenCalls).toHaveLength(2)
  })

  it('连着两次失败 → 降级，而且每个读取只记一条错误', async () => {
    const db = makeEnvDb({ clientError: 'boom' })
    const spy = makeEnvDeps(db.supabase, { env: { [PIXEL_ENV_KEY]: '1234567890' } })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(facts.capi_target).toEqual({ status: 'unreadable', pixel_id: null })
    expect(errors.filter(e => e.includes('boom'))).toHaveLength(1)
    expect(db.queries.filter(q => q.table === 'clients')).toHaveLength(2)
  })

  // 🔴 第二轮审查整改：探活把网络层失败包成 ok:false 的返回值（不抛错），重试要看返回值的形状
  it('探活令牌那一步没拿到回应（返回 ok:false + token_error，没有 token_valid）→ 重试一次，第二次通过就算通过', async () => {
    const db = makeEnvDb()
    const calls: number[] = []
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => {
        calls.push(calls.length)
        return calls.length === 1
          ? { ok: false, detail: { pixel_id: '1', token_error: 'fetch failed' } }
          : { ok: true, detail: { token_valid: true, pixel_visible: true } }
      },
    })
    const { facts, errors } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(spy.preflightCalls).toHaveLength(2)
    expect(facts.capi_preflight).toMatchObject({ ok: true, token_valid: true, pixel_visible: true })
    expect(errors).toEqual([])
  })

  it('探活像素那一步没拿到回应（令牌已验证、只有 pixel_error）→ 同样重试一次', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => (spy_calls++ === 0
        ? { ok: false, detail: { token_valid: true, pixel_error: 'timeout' } }
        : { ok: true, detail: { token_valid: true, pixel_visible: true } }),
    })
    let spy_calls = 0
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(spy.preflightCalls).toHaveLength(2)
    expect(facts.capi_preflight?.ok).toBe(true)
  })

  it('连着两次没拿到回应 → 最终就是 ok:false（回执里是「探活没通过」），只试两次', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, { capiPreflight: async () => ({ ok: false, detail: { token_error: 'fetch failed' } }) })
    const { facts } = await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(spy.preflightCalls).toHaveLength(2)
    expect(facts.capi_preflight).toMatchObject({ ok: false, token_valid: null })
  })

  it('永久性的失败不重试：配置阶段的失败 / 令牌失效 / 看不到像素', async () => {
    for (const detail of [
      { stage: 'config', error: '没配回传令牌' },
      { token_valid: false, token_error: '令牌已失效' },
      { token_valid: true, pixel_visible: false, pixel_error: '这把令牌看不到该 pixel' },
    ]) {
      const db = makeEnvDb()
      const spy = makeEnvDeps(db.supabase, { capiPreflight: async () => ({ ok: false, detail }) })
      await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
      expect(spy.preflightCalls, JSON.stringify(detail)).toHaveLength(1)
    }
  })

  it('「没有令牌」「预检说失败」这类正常返回的结果不算瞬时故障：不重试', async () => {
    const db = makeEnvDb()
    const spy = makeEnvDeps(db.supabase, {
      capiPreflight: async () => ({ ok: false, detail: { stage: 'config' } }),
      resolveMetaToken: async () => null,
    })
    await readEnvFacts({ clientId: 'c1', now: NOW }, spy.deps)
    expect(spy.preflightCalls).toHaveLength(1)
    expect(spy.tokenCalls).toHaveLength(1)
  })
})
