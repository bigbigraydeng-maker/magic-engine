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
    snooze_until: null,
    stage: 'quoted',
    first_seen_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'a2',
    display_name: 'Sue',
    primary_phone: '+6421000002',
    primary_email: 'sue@example.com',
    do_not_contact: false,
    // 未来 5 天：推迟中；segmentContact 认这个字段就会给 excluded。
    // 老代码没把它喂给 model，Sue 会以默认无联系分段出现。
    snooze_until: '2099-01-01T00:00:00.000Z',
    stage: null,
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
  /** `.order(col, opts)` 每次调用 —— 2026-09-28 加，钉住分页排序列（见下方 describe）。 */
  orders: Array<[string, { ascending?: boolean } | undefined]>
}

let recorded: Recorded[]

/**
 * 假 builder。链式方法都返回自己，`then` 让它可 await。
 *
 * 返回什么行由 `table` 决定 —— 够测路由的组装逻辑，不模拟过滤。
 */
function fakeDb(table: string) {
  const rec: Recorded = { table, eqs: [], ins: [], ors: [], countHead: false, range: null, orders: [] }
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
    order: (col: string, opts?: { ascending?: boolean }) => {
      rec.orders.push([col, opts])
      return builder
    },
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

  /**
   * 🔴 2026-09-28 · PM 当场撞到的真实事故：`contacts.id` 是 UUID，按它排等于按
   * 随机字符串排——第 1 页选出来的 20 个人跟「谁最近有动静」没有任何关系，
   * 当晚刚建档的 WhatsApp 测试联系人在 1026 人里怎么翻都翻不到。改成按
   * `first_seen_at` 倒序：不是真正的「按最后一次接触排」（那需要跨渠道触点
   * 聚合，记了台账），但至少让刚进来的人能被看见。
   *
   * 钉的是「排的是哪一列、朝哪个方向」——不是随便一个 `.order()` 调用就算过，
   * 按 `id` 升序、按 `first_seen_at` 升序都会让这条测试露出来。
   */
  it('分页查询按 first_seen_at 倒序，不是按 id（UUID 排等于随机排）', async () => {
    await get('client-a', '?page=1&perPage=20')
    const contactsQuery = recorded.find((r) => r.table === 'contacts' && !r.countHead)
    expect(contactsQuery?.orders).toContainEqual(['first_seen_at', { ascending: false }])
    expect(contactsQuery?.orders.map((o) => o[0])).not.toContain('id')
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

describe('GET contacts — 分段跟今天页共用形状（WP3 R3）', () => {
  it('snooze_until 未来时间 → 该人的 segment=excluded；老 bug 里这条会显示原分段', async () => {
    const { status, body } = await get('cts')
    expect(status).toBe(200)
    const list = (body.contacts ?? body.items) as Array<Record<string, unknown>>
    const sue = list.find((r) => r.contactId === 'a2')
    expect(sue).toBeTruthy()
    expect(sue?.segment).toBe('excluded')
  })

  it('snooze_until=null → 分段照常走 segmentContact，不因新字段影响非推迟客人', async () => {
    const { status, body } = await get('cts')
    expect(status).toBe(200)
    const list = (body.contacts ?? body.items) as Array<Record<string, unknown>>
    const bob = list.find((r) => r.contactId === 'a1')
    expect(bob).toBeTruthy()
    expect(bob?.segment).not.toBe('excluded')
  })

  /**
   * 🔴 2026-09-28 CRM 重整 B2（子牙复审查出）：`segmentContact()` 早就算出了
   * `suggestedChannel`/`reason`，`responseRowFor()` 之前没往响应行里塞。
   * 「全部客人」换用 PersonDrawer 之后靠这个字段决定给哪几个按钮——缺了它会
   * 兜底成 'phone'，对一个只有私信、没有电话的客人也会渲染电话话术的按钮。
   */
  it('响应行带 suggestedChannel 和 reason，不是 undefined', async () => {
    const { status, body } = await get('cts')
    expect(status).toBe(200)
    const list = (body.contacts ?? body.items) as Array<Record<string, unknown>>
    const bob = list.find((r) => r.contactId === 'a1')
    expect(bob?.suggestedChannel).toBeDefined()
    expect(typeof bob?.reason).toBe('string')
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

describe('GET contacts — view=priority（WP3 R5 接线）', () => {
  it('?view=priority → 新形状 {view, focus, columns, sections}，四段顺序固定', async () => {
    const { status, body } = await get('cts', '?view=priority')
    expect(status).toBe(200)
    expect(body.view).toBe('priority')
    expect(body).toHaveProperty('focus')
    expect(body).toHaveProperty('columns')
    expect((body.sections as Array<{ key: string }>).map((s) => s.key)).toEqual([
      'waiting',
      'acted',
      'queued',
      'off_list',
    ])
  })

  it('不带 view → 形状不变（老调用方不受影响）', async () => {
    const { body } = await get('cts')
    expect(body.view).toBeUndefined()
    expect(body).toHaveProperty('contacts')
    expect(body).toHaveProperty('totalContacts')
  })

  it('每段带 total；推迟中的 Sue 落 off_list，没触点的 Bob 落 acted', async () => {
    const { body } = await get('cts', '?view=priority')
    const byKey = Object.fromEntries(
      (body.sections as Array<{ key: string; total: number }>).map((s) => [s.key, s]),
    )
    expect(byKey.off_list.total).toBe(1)
    expect(byKey.acted.total).toBe(1)
    expect(byKey.waiting.total).toBe(0)
  })

  it('默认前两段展开（items 是数组）、后两段收起（items=null）', async () => {
    const { body } = await get('cts', '?view=priority')
    const byKey = Object.fromEntries(
      (body.sections as Array<{ key: string; items: unknown[] | null }>).map((s) => [s.key, s]),
    )
    expect(Array.isArray(byKey.waiting.items)).toBe(true)
    expect(Array.isArray(byKey.acted.items)).toBe(true)
    expect(byKey.queued.items).toBeNull()
    expect(byKey.off_list.items).toBeNull()
  })

  it('?open=off_list → 只有 off_list 展开，默认展开的两段被显式收起', async () => {
    const { body } = await get('cts', '?view=priority&open=off_list')
    const byKey = Object.fromEntries(
      (body.sections as Array<{ key: string; open: boolean; items: unknown[] | null }>).map((s) => [s.key, s]),
    )
    expect(byKey.off_list.open).toBe(true)
    expect(Array.isArray(byKey.off_list.items)).toBe(true)
    expect(byKey.waiting.open).toBe(false)
    expect(byKey.waiting.items).toBeNull()
  })

  it('?contact=a2 → focus 报出 Sue 落在 off_list 第 1 页（直达链接不再落空）', async () => {
    const { body } = await get('cts', '?view=priority&contact=a2')
    expect(body.focus).toMatchObject({ found: true, section: 'off_list', page: 1 })
  })

  it('?contact=ghost → focus.found=false，不 500', async () => {
    const { status, body } = await get('cts', '?view=priority&contact=ghost')
    expect(status).toBe(200)
    expect(body.focus).toMatchObject({ found: false })
  })

  it('?view=junk → 400', async () => {
    const { status, body } = await get('cts', '?view=junk')
    expect(status).toBe(400)
    expect(String(body.error)).toContain('view')
  })

  it('?open=nope → 400，错误提到那个段名', async () => {
    const { status, body } = await get('cts', '?view=priority&open=nope')
    expect(status).toBe(400)
    expect(String(body.error)).toContain('nope')
  })

  it('?p_waiting=0 → 400', async () => {
    const { status } = await get('cts', '?view=priority&p_waiting=0')
    expect(status).toBe(400)
  })

  it('client_id 收口：view=priority 也只按 URL 里那个客户查', async () => {
    await get('client-y', '?view=priority')
    const contactQ = recorded.find((r) => r.table === 'contacts')
    expect(contactQ?.eqs).toContainEqual(['client_id', 'client-y'])
  })

  it('?view=priority&stage=quoted → stage 筛选仍落在 SQL（不是内存里过）', async () => {
    await get('cts', '?view=priority&stage=quoted')
    const contactQ = recorded.find((r) => r.table === 'contacts')
    expect(contactQ?.ins).toContainEqual(['stage', ['quoted']])
  })
})
