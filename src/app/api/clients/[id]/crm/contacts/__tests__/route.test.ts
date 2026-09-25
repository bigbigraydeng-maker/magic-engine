/**
 * 「全部客人」列表接口 —— 分页 / 阶段筛选 / 关键词搜索。
 *
 * 最要紧的一条是**向后兼容**：老调用方（all/page.tsx）一个参数都不带，
 * 必须拿到跟以前一模一样的形状 `{ totalContacts, columns, contacts }`。
 * 新形状只在参数出现时生效 —— 判据是「参数出现过」，不是「值非默认」，
 * 所以 `?page=1&perPage=100` 也要走新形状。
 *
 * 假库只做两件事：记录查询链（好断言 .eq / .in / .or 被怎么调），
 * 按调用顺序吐罐头行。不需要真的实现 PostgREST。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, user: { email: 'roman@example.com' } })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from '../route'

type Row = Record<string, unknown>

const CONTACTS: Row[] = [
  {
    id: 'a1',
    display_name: 'Bob',
    primary_phone: '+6421000001',
    primary_email: 'bob@example.com',
    do_not_contact: false,
    stage: 'quoted',
    first_seen_at: '2026-01-01T00:00:00.000Z',
  },
]

const STAGES: Row[] = [
  { stage_key: 'quoted', label: '已报价', marketing_action: 'nurture', is_terminal: false },
]

/** 一次查询链上记下来的东西。 */
interface Recorded {
  table: string
  eqs: Array<[string, unknown]>
  ins: Array<[string, unknown[]]>
  ors: string[]
  countHead: boolean
  range: [number, number] | null
}

let recorded: Recorded[]

/**
 * 假 builder。链式方法都返回自己，`then` 让它可 await。
 *
 * 返回什么行由 `table` 决定 —— 够测路由的组装逻辑，不模拟过滤。
 */
function fakeDb(table: string) {
  const rec: Recorded = { table, eqs: [], ins: [], ors: [], countHead: false, range: null }
  recorded.push(rec)

  const builder: Record<string, unknown> = {
    select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) rec.countHead = true
      return builder
    },
    eq: (col: string, val: unknown) => {
      rec.eqs.push([col, val])
      return builder
    },
    in: (col: string, vals: unknown[]) => {
      rec.ins.push([col, vals])
      return builder
    },
    or: (expr: string) => {
      rec.ors.push(expr)
      return builder
    },
    order: () => builder,
    range: (from: number, to: number) => {
      rec.range = [from, to]
      return builder
    },
    then: (resolve: (v: unknown) => unknown) => {
      if (table === 'contacts') {
        // count 查询（head）只回 count；取页查询回行。
        if (rec.countHead) return resolve({ data: null, count: CONTACTS.length, error: null })
        return resolve({ data: CONTACTS, count: null, error: null })
      }
      if (table === 'client_pipeline_stages') return resolve({ data: STAGES, error: null })
      return resolve({ data: [], error: null })
    },
  }
  return builder
}

async function get(clientId: string, qs = '') {
  const req = new NextRequest(`http://localhost/api/clients/${clientId}/crm/contacts${qs}`)
  const res = await GET(req, { params: { id: clientId } })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  recorded = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(fakeDb)
})

describe('GET contacts — 向后兼容', () => {
  it('不带参数 → 老形状（totalContacts / contacts，没有 items / total）', async () => {
    const { status, body } = await get('client-a')
    expect(status).toBe(200)
    expect(body).toHaveProperty('totalContacts')
    expect(body).toHaveProperty('contacts')
    expect(body).not.toHaveProperty('items')
    expect(body).not.toHaveProperty('total')
  })
})

describe('GET contacts — 分页形状', () => {
  it('?page=1&perPage=100 → 新形状（total / page / perPage / items / columns）', async () => {
    const { status, body } = await get('client-a', '?page=1&perPage=100')
    expect(status).toBe(200)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('page', 1)
    expect(body).toHaveProperty('perPage', 100)
    expect(body).toHaveProperty('items')
    expect(body).toHaveProperty('columns')
    expect(body).not.toHaveProperty('totalContacts')
    expect(body).not.toHaveProperty('contacts')
  })

  it('?perPage=10000 → clamp 到 500', async () => {
    const { status, body } = await get('client-a', '?perPage=10000')
    expect(status).toBe(200)
    expect(body.perPage).toBe(500)
  })
})

describe('GET contacts — 参数校验', () => {
  it('?perPage=0 → 400，错误提到 perPage', async () => {
    const { status, body } = await get('client-a', '?perPage=0')
    expect(status).toBe(400)
    expect(body.error).toMatch(/page\/perPage/)
  })

  it('?q=Bob,evil → 400，错误提到非法字符', async () => {
    const { status, body } = await get('client-a', '?q=Bob,evil')
    expect(status).toBe(400)
    expect(body.error).toMatch(/invalid characters/)
  })
})

describe('GET contacts — 筛选落到 SQL', () => {
  it('?stage=quoted&stage=deposit_paid → .in 收到两个值', async () => {
    await get('client-a', '?stage=quoted&stage=deposit_paid')
    const contactQueries = recorded.filter((r) => r.table === 'contacts')
    expect(contactQueries.length).toBeGreaterThan(0)
    for (const q of contactQueries) {
      expect(q.ins).toEqual(expect.arrayContaining([['stage', ['quoted', 'deposit_paid']]]))
    }
  })

  it('client_id 收口：URL 是 client-y，SQL 也按 client-y 过滤', async () => {
    await get('client-y', '?page=1')
    const contactQueries = recorded.filter((r) => r.table === 'contacts')
    expect(contactQueries.length).toBeGreaterThan(0)
    for (const q of contactQueries) {
      expect(q.eqs).toEqual(expect.arrayContaining([['client_id', 'client-y']]))
    }
  })
})
