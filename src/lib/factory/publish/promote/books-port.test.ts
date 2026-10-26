/**
 * 生产 books-port 的查询形状测试。
 *
 * 为什么要测:主流程测试全用内存实现,所以真实 books-port 里
 * 「有 execution_item_id 就 update、没有就 insert 再回挂」这条分叉,
 * 以及 insert 的字段(status/dimension/fix_type/source/title 截断)、
 * 回挂时的 `.is('execution_item_id', null)`、工作日志的作者/日期,
 * 删掉哪一条主流程测试都不会红。这里直接盯真实实现发出的查询。
 *
 * 另外:两条 update 都带 `.select('id')` 并检查命中行数,
 * 零行视为失败(否则「更新了 0 行」会被静默吞掉)。
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
  for (const m of ['select', 'eq', 'is', 'update', 'insert']) b[m] = record(m)
  const settle = () => {
    const q = results[table] ?? []
    return Promise.resolve(q.shift() ?? { data: [{ id: 'x' }], error: null })
  }
  b.maybeSingle = () => settle()
  b.then = (resolve: (v: unknown) => unknown) => settle().then(resolve)
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => builder(table) } }))

import { createPromoteBooks } from './books-port'
import { projectPublishedReelExecutionItem, writeThreeBooks } from '../publish-worker'

beforeEach(() => {
  calls = []
  results = {}
})

const has = (table: string, method: string, ...args: unknown[]) =>
  calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

const callsOn = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method)

describe('shared published Reel projection', () => {
  it('initial publish uses the same completed projection and links its returned id once', async () => {
    results.execution_items = [{ data: { id: 'item-shared' }, error: null }]
    await writeThreeBooks('order-1', {
      platform: 'facebook', post_id: 'post-1', permalink: 'https://example.test/reel/1', published_at: '2026-10-19T00:00:00Z',
    }, 'c1', 'angle')
    expect(callsOn('execution_items', 'insert')).toHaveLength(1)
    expect(callsOn('execution_items', 'insert')[0].args[0]).toMatchObject({
      client_id: 'c1', status: 'completed', dimension: 'social', fix_type: 'me_auto', source: 'proactive_signal',
      description: '工厂自动发布 Reel「angle」→ meta_graph(https://example.test/reel/1)',
    })
    expect(callsOn('flywheel_actions', 'insert')).toHaveLength(1)
    expect(callsOn('flywheel_actions', 'insert')[0].args[0]).toMatchObject({ execution_item_id: 'item-shared', client_id: 'c1' })
    expect(callsOn('fde_work_logs', 'insert')).toHaveLength(1)
  })

  it('the projection itself only writes the board, with no duplicate traffic or work log', async () => {
    results.execution_items = [{ data: { id: 'item-shared' }, error: null }]
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      await expect(projectPublishedReelExecutionItem({ clientId: 'c1', existingItemId: null, title: 't', description: 'd' })).resolves.toBe('item-shared')
      expect(new Set(calls.map(call => call.table))).toEqual(new Set(['execution_items']))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore() }
  })

  it('an initial projection failure still records traffic and the work log without an invented item id', async () => {
    results.execution_items = [{ data: null, error: { message: 'projection unavailable' } }]
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await writeThreeBooks('order-1', { platform: 'facebook', post_id: 'post-1', published_at: '2026-10-19T00:00:00Z' }, 'c1', 'angle')
      expect(callsOn('flywheel_actions', 'insert')[0].args[0]).toMatchObject({ execution_item_id: null })
      expect(callsOn('fde_work_logs', 'insert')).toHaveLength(1)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('projection unavailable'))
    } finally { logSpy.mockRestore() }
  })
})

describe('completeExecutionItem', () => {
  it('有 existingItemId → 只 update execution_items,按 id + client_id 过滤,不 insert', async () => {
    results.execution_items = [{ data: [{ id: 'item-1' }], error: null }]
    await createPromoteBooks().completeExecutionItem({
      clientId: 'c1',
      rowId: 'a1',
      existingItemId: 'item-1',
      title: 't',
      description: 'd',
    })
    const updates = callsOn('execution_items', 'update')
    expect(updates).toHaveLength(1)
    const patch = updates[0].args[0] as Record<string, unknown>
    expect(patch.status).toBe('completed')
    expect(typeof patch.completed_at).toBe('string')
    expect(typeof patch.updated_at).toBe('string')
    expect(has('execution_items', 'eq', 'id', 'item-1')).toBe(true)
    expect(has('execution_items', 'eq', 'client_id', 'c1')).toBe(true)
    expect(has('execution_items', 'select', 'id')).toBe(true)
    expect(callsOn('execution_items', 'insert')).toHaveLength(0)
    expect(callsOn('flywheel_actions', 'update')).toHaveLength(0)
  })

  it('有 existingItemId 但 update 命中 0 行 → 抛「执行事项更新没有命中任何行」', async () => {
    results.execution_items = [{ data: [], error: null }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: 'item-1',
        title: 't',
        description: 'd',
      }),
    ).rejects.toThrow('执行事项更新没有命中任何行')
    expect(callsOn('execution_items', 'insert')).toHaveLength(0)
    expect(callsOn('flywheel_actions', 'update')).toHaveLength(0)
  })

  it('没有 existingItemId → insert completed 执行事项,再回挂 flywheel_actions', async () => {
    results.execution_items = [{ data: { id: 'item-new' }, error: null }]
    results.flywheel_actions = [{ data: [{ id: 'a1' }], error: null }]
    const longTitle = 'x'.repeat(250)
    await createPromoteBooks().completeExecutionItem({
      clientId: 'c1',
      rowId: 'a1',
      existingItemId: null,
      title: longTitle,
      description: 'desc',
    })

    const inserts = callsOn('execution_items', 'insert')
    expect(inserts).toHaveLength(1)
    const row = inserts[0].args[0] as Record<string, unknown>
    expect(row.status).toBe('completed')
    expect(row.dimension).toBe('social')
    expect(row.fix_type).toBe('me_auto')
    expect(row.source).toBe('proactive_signal')
    expect(row.client_id).toBe('c1')
    expect(row.description).toBe('desc')
    expect(typeof row.title).toBe('string')
    expect((row.title as string).length).toBe(200)
    expect(row.title).toBe('x'.repeat(200))

    const links = callsOn('flywheel_actions', 'update')
    expect(links).toHaveLength(1)
    expect(links[0].args[0]).toEqual({ execution_item_id: 'item-new' })
    expect(has('flywheel_actions', 'eq', 'id', 'a1')).toBe(true)
    expect(has('flywheel_actions', 'eq', 'client_id', 'c1')).toBe(true)
    expect(has('flywheel_actions', 'is', 'execution_item_id', null)).toBe(true)
    expect(has('flywheel_actions', 'select', 'id')).toBe(true)
  })

  it('回挂 flywheel_actions 命中 0 行 → 抛「执行事项回挂流量记录没有命中任何行」', async () => {
    results.execution_items = [{ data: { id: 'item-new' }, error: null }]
    results.flywheel_actions = [{ data: [], error: null }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: null,
        title: 't',
        description: 'd',
      }),
    ).rejects.toThrow('执行事项回挂流量记录没有命中任何行')
  })

  it('insert 没返回 id → 抛', async () => {
    results.execution_items = [{ data: null, error: null }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: null,
        title: 't',
        description: 'd',
      }),
    ).rejects.toBeTruthy()
    expect(callsOn('flywheel_actions', 'update')).toHaveLength(0)
  })

  it('update 报错 → 抛', async () => {
    results.execution_items = [{ data: null, error: { message: 'down' } }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: 'item-1',
        title: 't',
        description: 'd',
      }),
    ).rejects.toBeTruthy()
  })

  it('update 报错是普通对象 → 原样抛出该对象', async () => {
    const boom = { message: 'boom' }
    results.execution_items = [{ data: null, error: boom }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: 'item-1',
        title: 't',
        description: 'd',
      }),
    ).rejects.toBe(boom)
  })

  it('insert 报错 → 抛', async () => {
    results.execution_items = [{ data: null, error: { message: 'down' } }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: null,
        title: 't',
        description: 'd',
      }),
    ).rejects.toBeTruthy()
    expect(callsOn('flywheel_actions', 'update')).toHaveLength(0)
  })

  it('回挂 flywheel_actions 报错 → 抛', async () => {
    results.execution_items = [{ data: { id: 'item-new' }, error: null }]
    results.flywheel_actions = [{ data: null, error: { message: 'down' } }]
    await expect(
      createPromoteBooks().completeExecutionItem({
        clientId: 'c1',
        rowId: 'a1',
        existingItemId: null,
        title: 't',
        description: 'd',
      }),
    ).rejects.toBeTruthy()
  })
})

describe('writeWorkLog', () => {
  it('插入 fde_work_logs,作者固定、summary 原样、log_date 为 YYYY-MM-DD', async () => {
    results.fde_work_logs = [{ data: null, error: null }]
    await createPromoteBooks().writeWorkLog({ clientId: 'c1', summary: '已公开' })
    const inserts = callsOn('fde_work_logs', 'insert')
    expect(inserts).toHaveLength(1)
    const row = inserts[0].args[0] as Record<string, unknown>
    expect(row.client_id).toBe('c1')
    expect(row.summary).toBe('已公开')
    expect(row.author_email).toBe('factory@magicengine.com.au')
    expect(typeof row.log_date).toBe('string')
    expect(row.log_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('数据库报错 → 抛', async () => {
    results.fde_work_logs = [{ data: null, error: { message: 'down' } }]
    await expect(
      createPromoteBooks().writeWorkLog({ clientId: 'c1', summary: '已公开' }),
    ).rejects.toBeTruthy()
  })
})
