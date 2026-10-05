/**
 * 生产 store 的查询形状测试。
 *
 * 为什么要测:主流程的测试全用内存 store(自己又实现了一遍乐观写),所以真实 store 里的
 * `.eq('updated_at', …)` / `.eq('status','published')` / 平台过滤 / 缺品牌名失败关闭,
 * 删掉哪一条主流程测试都不会红。这里直接盯真实 store 发出的查询。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Call { table: string; method: string; args: unknown[] }
let calls: Call[]
let results: Record<string, Array<{ data: unknown; error: { message: string } | null }>>

function builder(table: string) {
  const b: Record<string, unknown> = {}
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table, method, args })
    return b
  }
  for (const m of ['select', 'eq', 'order', 'limit', 'update', 'gte', 'in']) b[m] = record(m)
  const settle = () => {
    const q = results[table] ?? []
    return Promise.resolve(q.shift() ?? { data: null, error: null })
  }
  b.maybeSingle = () => settle()
  b.then = (resolve: (v: unknown) => unknown) => settle().then(resolve)
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => builder(table) } }))

const resolveBound = vi.fn()
vi.mock('@/lib/flywheel/social-post-publish', () => ({ resolveBoundPublerAccount: (...a: unknown[]) => resolveBound(...a) }))

import { createSupabaseCrosspostStore } from './instagram-crosspost-store'

beforeEach(() => {
  calls = []
  results = {}
  resolveBound.mockReset()
})

const has = (table: string, method: string, ...args: unknown[]) =>
  calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

describe('listCandidates', () => {
  it('没有客户绑定 Instagram → 不查工单,直接空', async () => {
    results.client_connectors = [{ data: [], error: null }]
    expect(await createSupabaseCrosspostStore().listCandidates(50)).toEqual([])
    expect(calls.some((c) => c.table === 'content_work_orders')).toBe(false)
  })

  it('只读「已发布的 Facebook 工单」,按更新时间倒序,带上限', async () => {
    results.client_connectors = [{ data: [{ client_id: 'c1', config: { publer_account_ids: { Instagram: 'acct12345678' } } }, { client_id: 'c2', config: { publer_account_ids: { facebook: 'x' } } }], error: null }]
    results.content_work_orders = [{ data: [], error: null }]
    await createSupabaseCrosspostStore().listCandidates(50)
    expect(has('content_work_orders', 'in', 'client_id', ['c1'])).toBe(true)
    expect(calls.some((c) => c.table === 'content_work_orders' && c.method === 'gte' && c.args[0] === 'published_ref->>published_at')).toBe(true)
    expect(has('content_work_orders', 'eq', 'status', 'published')).toBe(true)
    expect(has('content_work_orders', 'eq', 'published_ref->>platform', 'facebook')).toBe(true)
    expect(has('content_work_orders', 'limit', 50)).toBe(true)
  })

  it('查询报错就抛(不当成「没有候选」)', async () => {
    results.client_connectors = [{ data: [{ client_id: 'c1', config: { publer_account_ids: { instagram: 'acct12345678' } } }], error: null }]
    results.content_work_orders = [{ data: null, error: { message: 'boom' } }]
    await expect(createSupabaseCrosspostStore().listCandidates(5)).rejects.toBeTruthy()
  })

  it('行里不是对象的 jsonb 字段一律退化成 {}(不把脏数据抛给主流程)', async () => {
    results.client_connectors = [{ data: [{ client_id: 'c', config: { publer_account_ids: { instagram: 'acct12345678' } } }], error: null }]
    results.content_work_orders = [{
      data: [{ id: 'a', client_id: 'c', master_brief_id: null, angle: null, brief: 'x', output: null, review_ref: [], published_ref: 5, updated_at: 't' }],
      error: null,
    }]
    const [c] = await createSupabaseCrosspostStore().listCandidates(1)
    expect(c.brief).toEqual({})
    expect(c.output).toEqual({})
    expect(c.review_ref).toEqual({})
    expect(c.published_ref).toEqual({})
  })
})

describe('writeOutput(乐观并发)', () => {
  it('必须同时带 id、status=published、updated_at=读到时的值,缺一个并发保护就没了', async () => {
    results.content_work_orders = [{ data: { updated_at: 'new' }, error: null }]
    const w = await createSupabaseCrosspostStore().writeOutput('wo-1', 'old', { a: 1 })
    expect(w).toEqual({ ok: true, updatedAt: 'new' })
    expect(has('content_work_orders', 'eq', 'id', 'wo-1')).toBe(true)
    expect(has('content_work_orders', 'eq', 'status', 'published')).toBe(true)
    expect(has('content_work_orders', 'eq', 'updated_at', 'old')).toBe(true)
  })

  it('没有行被更新(别人先改了)→ ok:false,不抛', async () => {
    results.content_work_orders = [{ data: null, error: null }]
    expect(await createSupabaseCrosspostStore().writeOutput('wo-1', 'old', {})).toEqual({ ok: false })
  })

  it('数据库报错 → 抛(不当成冲突)', async () => {
    results.content_work_orders = [{ data: null, error: { message: 'down' } }]
    await expect(createSupabaseCrosspostStore().writeOutput('wo-1', 'old', {})).rejects.toBeTruthy()
  })
})

describe('loadInstagramTarget', () => {
  const account = { id: 'acct12345678', provider: 'instagram' }

  it('连接器里没绑 Instagram → null,而且根本不去查品牌', async () => {
    resolveBound.mockResolvedValue(null)
    expect(await createSupabaseCrosspostStore().loadInstagramTarget('c1')).toBeNull()
    expect(resolveBound).toHaveBeenCalledWith('c1', 'instagram')
    expect(calls.some((c) => c.table === 'master_briefs')).toBe(false)
  })

  it('配了但客户没有品牌名 → 抛错(失败关闭,没法做防串客户核对)', async () => {
    resolveBound.mockResolvedValue(account)
    results.master_briefs = [{ data: null, error: null }]
    await expect(createSupabaseCrosspostStore().loadInstagramTarget('c1')).rejects.toThrow(/品牌/)
  })

  it('配齐 → 返回带品牌名与客户 id 的目标', async () => {
    resolveBound.mockResolvedValue(account)
    results.master_briefs = [{ data: { brand_name: 'Some Brand' }, error: null }]
    expect(await createSupabaseCrosspostStore().loadInstagramTarget('c1')).toEqual({
      platform: 'publer',
      publer_account_id: 'acct12345678',
      publer_provider: 'instagram',
      client_id: 'c1',
      expect_brand: 'Some Brand',
    })
  })
})
