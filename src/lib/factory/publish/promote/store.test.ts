/**
 * 生产 store 的查询形状测试。
 *
 * 为什么要测:主流程的测试全用内存 store,所以真实 store 里的
 * `.is('payload->>promote_rev', null)` / `.eq('payload->>promote_rev', rev)` /
 * `.eq('updated_at', …)` / `.eq('status','published')` / 平台过滤,
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
  for (const m of ['select', 'eq', 'is', 'update']) b[m] = record(m)
  const settle = () => {
    const q = results[table] ?? []
    return Promise.resolve(q.shift() ?? { data: null, error: null })
  }
  b.maybeSingle = () => settle()
  b.then = (resolve: (v: unknown) => unknown) => settle().then(resolve)
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => builder(table) } }))

import { createSupabasePromoteStore } from './store'
import { TRAFFIC_ACTION_TYPE } from './types'

beforeEach(() => {
  calls = []
  results = {}
})

const has = (table: string, method: string, ...args: unknown[]) =>
  calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

describe('loadOrder', () => {
  it('按 id 查工单,jsonb 字段非对象时退化成 {}', async () => {
    results.content_work_orders = [{
      data: {
        id: 'wo-1',
        client_id: 'c1',
        status: 'published',
        master_brief_id: null,
        brief: 'x',
        output: null,
        review_ref: [],
        published_ref: 5,
        updated_at: 't',
      },
      error: null,
    }]
    const o = await createSupabasePromoteStore().loadOrder('wo-1')
    expect(o).not.toBeNull()
    expect(o?.id).toBe('wo-1')
    expect(o?.master_brief_id).toBeNull()
    expect(o?.brief).toEqual({})
    expect(o?.output).toEqual({})
    expect(o?.review_ref).toEqual({})
    expect(o?.published_ref).toEqual({})
    expect(has('content_work_orders', 'eq', 'id', 'wo-1')).toBe(true)
  })

  it('没有行 → null', async () => {
    results.content_work_orders = [{ data: null, error: null }]
    expect(await createSupabasePromoteStore().loadOrder('missing')).toBeNull()
  })

  it('查询报错就抛(不当成「没有工单」)', async () => {
    results.content_work_orders = [{ data: null, error: { message: 'boom' } }]
    await expect(createSupabasePromoteStore().loadOrder('wo-1')).rejects.toBeTruthy()
  })
})

describe('loadTrafficRows', () => {
  it('按 client_id + action_type + payload->>work_order_id 过滤', async () => {
    results.flywheel_actions = [{ data: [], error: null }]
    await createSupabasePromoteStore().loadTrafficRows('wo-1', 'c1')
    expect(has('flywheel_actions', 'eq', 'client_id', 'c1')).toBe(true)
    expect(has('flywheel_actions', 'eq', 'action_type', TRAFFIC_ACTION_TYPE)).toBe(true)
    expect(has('flywheel_actions', 'eq', 'payload->>work_order_id', 'wo-1')).toBe(true)
  })

  it('payload 非对象时退化成 {}', async () => {
    results.flywheel_actions = [{
      data: [{ id: 'a', client_id: 'c1', payload: 'x' }],
      error: null,
    }]
    const rows = await createSupabasePromoteStore().loadTrafficRows('wo-1', 'c1')
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toEqual({})
  })

  it('查询报错就抛', async () => {
    results.flywheel_actions = [{ data: null, error: { message: 'down' } }]
    await expect(createSupabasePromoteStore().loadTrafficRows('wo-1', 'c1')).rejects.toBeTruthy()
  })
})

describe('loadTrafficRow', () => {
  it('按 id + client_id 查单行', async () => {
    results.flywheel_actions = [{ data: { id: 'a', client_id: 'c1', payload: { k: 1 } }, error: null }]
    const r = await createSupabasePromoteStore().loadTrafficRow('a', 'c1')
    expect(r?.payload).toEqual({ k: 1 })
    expect(has('flywheel_actions', 'eq', 'id', 'a')).toBe(true)
    expect(has('flywheel_actions', 'eq', 'client_id', 'c1')).toBe(true)
  })

  it('没有行 → null', async () => {
    results.flywheel_actions = [{ data: null, error: null }]
    expect(await createSupabasePromoteStore().loadTrafficRow('a', 'c1')).toBeNull()
  })

  it('查询报错就抛', async () => {
    results.flywheel_actions = [{ data: null, error: { message: 'down' } }]
    await expect(createSupabasePromoteStore().loadTrafficRow('a', 'c1')).rejects.toBeTruthy()
  })
})

describe('casPayload(乐观并发)', () => {
  it('expectedRev=null → 用 .is(payload->>promote_rev, null)', async () => {
    results.flywheel_actions = [{ data: [{ id: 'a' }], error: null }]
    const ok = await createSupabasePromoteStore().casPayload('a', 'c1', null, { promote_rev: 'r1' })
    expect(ok).toBe(true)
    expect(has('flywheel_actions', 'eq', 'id', 'a')).toBe(true)
    expect(has('flywheel_actions', 'eq', 'client_id', 'c1')).toBe(true)
    expect(has('flywheel_actions', 'is', 'payload->>promote_rev', null)).toBe(true)
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'payload->>promote_rev')).toBe(false)
  })

  it('expectedRev 有值 → 用 .eq(payload->>promote_rev, rev)', async () => {
    results.flywheel_actions = [{ data: [{ id: 'a' }], error: null }]
    const ok = await createSupabasePromoteStore().casPayload('a', 'c1', 'rev1', { promote_rev: 'r2' })
    expect(ok).toBe(true)
    expect(has('flywheel_actions', 'eq', 'payload->>promote_rev', 'rev1')).toBe(true)
    expect(calls.some((c) => c.method === 'is' && c.args[0] === 'payload->>promote_rev')).toBe(false)
  })

  it('命中 1 行 → true', async () => {
    results.flywheel_actions = [{ data: [{ id: 'a' }], error: null }]
    expect(await createSupabasePromoteStore().casPayload('a', 'c1', 'rev1', {})).toBe(true)
  })

  it('命中 0 行(别人先改了)→ false,不抛', async () => {
    results.flywheel_actions = [{ data: [], error: null }]
    expect(await createSupabasePromoteStore().casPayload('a', 'c1', 'rev1', {})).toBe(false)
  })

  it('命中 2 行(不该发生)→ false', async () => {
    results.flywheel_actions = [{ data: [{ id: 'a' }, { id: 'b' }], error: null }]
    expect(await createSupabasePromoteStore().casPayload('a', 'c1', 'rev1', {})).toBe(false)
  })

  it('数据库报错 → 抛(不当成冲突)', async () => {
    results.flywheel_actions = [{ data: null, error: { message: 'down' } }]
    await expect(createSupabasePromoteStore().casPayload('a', 'c1', 'rev1', {})).rejects.toBeTruthy()
  })
})

describe('writeOrderPublishedRef(乐观并发)', () => {
  it('必须同时带 id、updated_at=读到时的值、status=published', async () => {
    results.content_work_orders = [{ data: [{ id: 'wo-1' }], error: null }]
    const ok = await createSupabasePromoteStore().writeOrderPublishedRef('wo-1', 'old', { platform: 'facebook' })
    expect(ok).toBe(true)
    expect(has('content_work_orders', 'eq', 'id', 'wo-1')).toBe(true)
    expect(has('content_work_orders', 'eq', 'updated_at', 'old')).toBe(true)
    expect(has('content_work_orders', 'eq', 'status', 'published')).toBe(true)
  })

  it('命中 0 行(别人先改了)→ false,不抛', async () => {
    results.content_work_orders = [{ data: [], error: null }]
    expect(await createSupabasePromoteStore().writeOrderPublishedRef('wo-1', 'old', {})).toBe(false)
  })

  it('命中 2 行(不该发生)→ false', async () => {
    results.content_work_orders = [{ data: [{ id: 'a' }, { id: 'b' }], error: null }]
    expect(await createSupabasePromoteStore().writeOrderPublishedRef('wo-1', 'old', {})).toBe(false)
  })

  it('数据库报错 → 抛(不当成冲突)', async () => {
    results.content_work_orders = [{ data: null, error: { message: 'down' } }]
    await expect(createSupabasePromoteStore().writeOrderPublishedRef('wo-1', 'old', {})).rejects.toBeTruthy()
  })
})
