/**
 * 生产 books-port 的查询形状测试。
 *
 * 为什么要测:主流程测试全用内存实现,所以真实 books-port 里
 * 「有 execution_item_id 就 update、没有就 insert 再回挂」这条分叉,
 * 以及 insert 的字段(status/dimension/fix_type/source/title 截断)、
 * 回挂时的 `.is('execution_item_id', null)`、工作日志的作者/日期,
 * 删掉哪一条主流程测试都不会红。这里直接盯真实实现发出的查询。
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
    return Promise.resolve(q.shift() ?? { data: null, error: null })
  }
  b.maybeSingle = () => settle()
  b.then = (resolve: (v: unknown) => unknown) => settle().then(resolve)
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => builder(table) } }))

import { createPromoteBooks } from './books-port'

beforeEach(() => {
  calls = []
  results = {}
})

const has = (table: string, method: string, ...args: unknown[]) =>
  calls.some((c) => c.table === table && c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

const callsOn = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method)

describe('completeExecutionItem', () => {
  it('有 existingItemId → 只 update execution_items,按 id + client_id 过滤,不 insert', async () => {
    results.execution_items = [{ data: null, error: null }]
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
    expect(callsOn('execution_items', 'insert')).toHaveLength(0)
    expect(callsOn('flywheel_actions', 'update')).toHaveLength(0)
  })

  it('没有 existingItemId → insert completed 执行事项,再回挂 flywheel_actions', async () => {
    results.execution_items = [{ data: { id: 'item-new' }, error: null }]
    results.flywheel_actions = [{ data: null, error: null }]
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
