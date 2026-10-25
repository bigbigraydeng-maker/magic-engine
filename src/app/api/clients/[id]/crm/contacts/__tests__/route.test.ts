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

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from '../route'
import { resetBriefCacheForTests } from '@/lib/crm/brief-lookup'

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

/**
 * Stan：我们打过、他回过、然后我们又说了一句就断了（最后一条是我们的）→ `stale_conversation`。
 * 专门用来测「聊过一轮断了 + AI 判高意向 → 抬进 hot；低意向 → 留在 cold」这条接口路径——
 * 第一版拿 Bob 测，而 Bob 没触点本来就在 hot，任何意向都测不出抬升（魏征 2026-10-10 复审）。
 */
const STALE_CONTACT: Row = {
  id: 'a3',
  display_name: 'Stan',
  primary_phone: '+6421000003',
  primary_email: 'stan@example.com',
  do_not_contact: false,
  snooze_until: null,
  stage: null,
  first_seen_at: '2026-07-01T00:00:00.000Z',
}
const STALE_TOUCHES: Row[] = [
  { id: 't1', contact_id: 'a3', channel: 'messenger', direction: 'inbound', occurred_at: '2026-07-30T00:00:00.000Z', summary: 'hi', raw: null, metadata: null, source: 'messenger' },
  { id: 't2', contact_id: 'a3', channel: 'phone', direction: 'outbound', occurred_at: '2026-08-01T00:00:00.000Z', summary: '聊上了', raw: null, metadata: { outcome: 'spoke' }, source: 'me_manual' },
]
CONTACTS.push(STALE_CONTACT)

const STAGES: Row[] = [
  { stage_key: 'quoted', label: '已报价', marketing_action: 'nurture', is_terminal: false },
]

/** AI 摘要相关两张表的罐头行；默认空，个别测试按需填。 */
const BRIEF_ROWS: Record<string, Row[]> = { conversations: [], conversation_briefs: [] }

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
/** 排序扫描（不带 contact_id 的 .in）用的触点；默认就是 STALE_TOUCHES。 */
let scanRows: Row[] | null = null
/** 数据库函数的假返回；null = 函数还没装（报错，路由要退回老路径）。 */
let rpcRows: Array<{ id: string; total: number }> | null = null
let rpcCalls: Array<Record<string, unknown>> = []
/** `clients.leads_config` 的假返回（view=priority 用它认「自己人」邮箱域名）。 */
let clientsLeadsConfig: unknown = null

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
    // brief-lookup 用 `.not('contact_id', 'is', null)` 过滤没挂人的对话；假库少了它整条查询会抛，
    // 被 brief-lookup 吞成空 Map —— 意向永远是 null，测的就不是真路径。
    not: () => builder,
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
    maybeSingle: () =>
      Promise.resolve(table === 'clients' ? { data: { leads_config: clientsLeadsConfig }, error: null } : { data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      if (table === 'contacts') {
        // count 查询（head）只回 count；取页查询回行。
        if (rec.countHead) return resolve({ data: null, count: CONTACTS.length, error: null })
        return resolve({ data: CONTACTS, count: null, error: null })
      }
      if (table === 'client_pipeline_stages') return resolve({ data: STAGES, error: null })
      if (table === 'contact_touchpoints') {
        // 排序用的「最新触点」扫描没有 .in('contact_id', …)；取页用的有。
        const isScan = !rec.ins.some(([col]) => col === 'contact_id')
        return resolve({ data: isScan && scanRows !== null ? scanRows : STALE_TOUCHES, error: null })
      }
      if (table === 'conversations' || table === 'conversation_briefs') {
        return resolve({ data: BRIEF_ROWS[table] ?? [], error: null })
      }
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
  resetBriefCacheForTests()
  recorded = []
  scanRows = null
  clientsLeadsConfig = null
  rpcRows = null
  rpcCalls = []
  ;(supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (_name: string, args: Record<string, unknown>) => {
    rpcCalls.push(args)
    if (rpcRows === null) return { data: null, error: { message: 'function crm_contacts_page_by_latest_touch does not exist' } }
    return { data: rpcRows, error: null }
  })
  BRIEF_ROWS.conversations = []
  BRIEF_ROWS.conversation_briefs = []
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
  it('排序：先按真实触点时间扫（occurred_at 倒序），不再按 first_seen_at 或 id 分页', async () => {
    await get('client-a', '?page=1&perPage=20')
    const scan = recorded.find((r) => r.table === 'contact_touchpoints' && !r.ins.some(([c]) => c === 'contact_id'))
    expect(scan?.orders).toContainEqual(['occurred_at', { ascending: false }])
    // 取全客户 id 那条只为拿 id 和首次进线时间，用 id 排序保证 range 翻页稳定
    const idQuery = recorded.find((r) => r.table === 'contacts' && !r.countHead && !r.ins.some(([c]) => c === 'id'))
    expect(idQuery?.orders).toContainEqual(['id', { ascending: true }])
  })

  /**
   * PM 2026-10-14：今天有新互动的老客人要自动排到最上面。老写法按 first_seen_at 分页，
   * 老客人今天来了新消息也沉在后面。这里让 a1（最早进线）有最新的触点，它必须排第一。
   */
  it('今天有新互动的老客人排最前（不是按进线时间）', async () => {
    scanRows = [
      { contact_id: 'a1', occurred_at: '2026-10-14T01:00:00.000Z' },
      { contact_id: 'a3', occurred_at: '2026-08-01T00:00:00.000Z' },
    ]
    const { body } = await get('client-a', '?page=1&perPage=100')
    const order = (body.items as Array<{ contactId: string }>).map((r) => r.contactId)
    expect(order[0]).toBe('a1')
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a3'))
    expect(order.indexOf('a3')).toBeLessThan(order.indexOf('a2'))
  })

  /** 默认打开页面（没有筛选）走快路径：不取全客户 id，总数用 count，前几位从最新触点翻出来。 */
  it('没有筛选且触点够凑一页 → 不取全客户 id 列表，总数用 count', async () => {
    scanRows = [{ contact_id: 'a1', occurred_at: '2026-10-14T01:00:00.000Z' }]
    const { body } = await get('client-a', '?page=1&perPage=1')
    const fullIdList = recorded.filter((r) => r.table === 'contacts' && !r.countHead && !r.ins.some(([c]) => c === 'id'))
    expect(fullIdList).toHaveLength(0)
    expect(recorded.some((r) => r.table === 'contacts' && r.countHead)).toBe(true)
    expect(body.total).toBe(3)
  })

  it('有筛选时仍走完整路径（先取符合筛选的 id 再排）', async () => {
    scanRows = [{ contact_id: 'a1', occurred_at: '2026-10-14T01:00:00.000Z' }]
    await get('client-a', '?page=1&perPage=1&stage=quoted')
    const fullIdList = recorded.filter((r) => r.table === 'contacts' && !r.countHead && !r.ins.some(([c]) => c === 'id'))
    expect(fullIdList.length).toBeGreaterThan(0)
  })

  describe('数据库函数路径', () => {
    it('函数可用 → 用它返回的 id 顺序和总数，不再取全客户 id 列表也不扫触点', async () => {
      rpcRows = [{ id: 'a3', total: 3 }, { id: 'a1', total: 3 }]
      const { body } = await get('client-a', '?page=1&perPage=2')
      expect((body.items as Array<{ contactId: string }>).map((r) => r.contactId)).toEqual(['a3', 'a1'])
      expect(body.total).toBe(3)
      const fullIdList = recorded.filter((r) => r.table === 'contacts' && !r.countHead && !r.ins.some(([c]) => c === 'id'))
      expect(fullIdList).toHaveLength(0)
      const scan = recorded.filter((r) => r.table === 'contact_touchpoints' && !r.ins.some(([c]) => c === 'contact_id'))
      expect(scan).toHaveLength(0)
    })

    it('把筛选、搜索和翻页逐项交给函数', async () => {
      rpcRows = [{ id: 'a1', total: 2 }]
      await get('client-a', '?page=2&perPage=1&stage=quoted&q=Bob')
      expect(rpcCalls[0]).toMatchObject({
        p_client_id: 'client-a',
        p_stages: ['quoted'],
        p_q: 'Bob',
        p_limit: 1,
        p_offset: 1,
      })
    })

    it('没有筛选时 p_stages / p_q 是 null（不是空数组或空串）', async () => {
      rpcRows = [{ id: 'a1', total: 3 }]
      await get('client-a', '?page=1&perPage=100')
      expect(rpcCalls[0]).toMatchObject({ p_stages: null, p_q: null, p_in_ids: null, p_not_in_ids: null })
    })

    it('响应带 Server-Timing：各步耗时（只有步骤名和毫秒数）', async () => {
      rpcRows = [{ id: 'a1', total: 3 }]
      const req = new NextRequest('http://localhost/api/clients/client-a/crm/contacts?page=1&perPage=100')
      const res = await GET(req, { params: { id: 'client-a' } })
      const h = res.headers.get('Server-Timing') ?? ''
      for (const step of ['gate', 'rpc_stages', 'page_rows', 'page_ready', 'touches_briefs', 'assemble', 'total']) {
        expect(h).toContain(`${step};dur=`)
      }
      expect(h).not.toMatch(/a1|client-a|@/)
    })

    it('函数给出这一页的 id 后，取触点和取资料同时开始（触点查询先发出，不排在资料之后）', async () => {
      rpcRows = [{ id: 'a1', total: 3 }, { id: 'a3', total: 3 }]
      await get('client-a', '?page=1&perPage=2')
      const touchIdx = recorded.findIndex((r) => r.table === 'contact_touchpoints' && r.ins.some(([c]) => c === 'contact_id'))
      const rowsIdx = recorded.findIndex((r) => r.table === 'contacts' && r.ins.some(([c]) => c === 'id'))
      expect(touchIdx).toBeGreaterThanOrEqual(0)
      expect(rowsIdx).toBeGreaterThanOrEqual(0)
      expect(touchIdx).toBeLessThan(rowsIdx)
      // 只读这一页的触点一次，不重复读
      expect(recorded.filter((r) => r.table === 'contact_touchpoints' && r.ins.some(([c]) => c === 'contact_id'))).toHaveLength(1)
    })

    it('函数还没装上（报错）→ 退回老路径，页面照样 200 且按触点排序', async () => {
      rpcRows = null
      scanRows = [{ contact_id: 'a1', occurred_at: '2026-10-14T01:00:00.000Z' }]
      const { status, body } = await get('client-a', '?page=1&perPage=100')
      expect(status).toBe(200)
      expect((body.items as Array<{ contactId: string }>)[0].contactId).toBe('a1')
    })

    it('翻过头时拿总数的那次调用出错 → 退回老路径，不悄悄报 0', async () => {
      let n = 0
      ;(supabaseAdmin.rpc as ReturnType<typeof vi.fn>).mockImplementation(async (_name: string, args: Record<string, unknown>) => {
        rpcCalls.push(args)
        n += 1
        return n === 1 ? { data: [], error: null } : { data: null, error: { message: 'boom' } }
      })
      const { status, body } = await get('client-a', '?page=2&perPage=1')
      expect(status).toBe(200)
      expect(body.total).toBe(3) // 老路径的真实总数，不是 0
    })

    it('翻过头（这一页没有人）→ 再问一次第一页拿总数', async () => {
      rpcRows = []
      const { body } = await get('client-a', '?page=9&perPage=100')
      expect(body.items).toEqual([])
      expect(rpcCalls).toHaveLength(2)
      expect(rpcCalls[1]).toMatchObject({ p_limit: 1, p_offset: 0 })
    })
  })

  it('total 是符合筛选的全部人数，不受翻页影响', async () => {
    const { body } = await get('client-a', '?page=2&perPage=1')
    expect(body.total).toBe(3)
    expect(body.items).toHaveLength(1)
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
    expect(bob?.nextAction).toMatchObject({ list: expect.any(String), line: expect.any(String) })
  })
})

describe('GET contacts — 筛选落到 SQL', () => {
  it('?stage=quoted&stage=deposit_paid → .in 收到两个值', async () => {
    await get('client-a', '?stage=quoted&stage=deposit_paid')
    // 取「符合筛选的全部人」的那条查询带筛选；按 id 取当前页的那条不需要（id 已经是筛过的）。
    const filterQueries = recorded.filter((r) => r.table === 'contacts' && !r.ins.some(([c]) => c === 'id'))
    expect(filterQueries.length).toBeGreaterThan(0)
    for (const q of filterQueries) {
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
  it('自己人（own_email_domains 里的邮箱域名）不进 hot / cold 任何一张名单；别人照常', async () => {
    clientsLeadsConfig = { own_email_domains: ['example.com'] }
    const { body } = await get('cts', '?view=priority&open=hot,cold')
    const names = (body.sections as Array<{ items: Array<{ name: string }> | null }>).flatMap((s) => (s.items ?? []).map((i) => i.name))
    expect(names).not.toContain('Bob')
    expect(names).not.toContain('Sue')
  })

  it('没登记自己人域名时，同一批人照常出现（只有登记过的域名才会被排掉）', async () => {
    clientsLeadsConfig = { own_email_domains: ['other.example'] }
    const { body } = await get('cts', '?view=priority&open=hot,cold')
    const names = (body.sections as Array<{ items: Array<{ name: string }> | null }>).flatMap((s) => (s.items ?? []).map((i) => i.name))
    expect(names).toContain('Bob')
    expect(names).toContain('Sue')
  })

  it('?view=priority → 新形状 {view, focus, columns, sections}，两张名单顺序固定 hot / cold', async () => {
    const { status, body } = await get('cts', '?view=priority')
    expect(status).toBe(200)
    expect(body.view).toBe('priority')
    expect(body).toHaveProperty('focus')
    expect(body).toHaveProperty('columns')
    expect((body.sections as Array<{ key: string }>).map((s) => s.key)).toEqual(['hot', 'cold'])
  })

  it('不带 view → 形状不变（老调用方不受影响）', async () => {
    const { body } = await get('cts')
    expect(body.view).toBeUndefined()
    expect(body).toHaveProperty('contacts')
    expect(body).toHaveProperty('totalContacts')
  })

  it('每段带 total；推迟中的 Sue 落 cold，没触点的 Bob 落 hot', async () => {
    const { body } = await get('cts', '?view=priority')
    const byKey = Object.fromEntries(
      (body.sections as Array<{ key: string; total: number }>).map((s) => [s.key, s]),
    )
    // Sue（推迟中）+ Stan（聊过一轮断了、没摘要）
    expect(byKey.cold.total).toBe(2)
    expect(byKey.hot.total).toBe(1)
  })

  it('默认 hot 展开（items 是数组）、cold 收起（items=null）', async () => {
    const { body } = await get('cts', '?view=priority')
    const byKey = Object.fromEntries(
      (body.sections as Array<{ key: string; items: unknown[] | null }>).map((s) => [s.key, s]),
    )
    expect(Array.isArray(byKey.hot.items)).toBe(true)
    expect(byKey.cold.items).toBeNull()
  })

  it('?open=cold → 只有 cold 展开，默认展开的 hot 被显式收起', async () => {
    const { body } = await get('cts', '?view=priority&open=cold')
    const byKey = Object.fromEntries(
      (body.sections as Array<{ key: string; open: boolean; items: unknown[] | null }>).map((s) => [s.key, s]),
    )
    expect(byKey.cold.open).toBe(true)
    expect(Array.isArray(byKey.cold.items)).toBe(true)
    expect(byKey.hot.open).toBe(false)
    expect(byKey.hot.items).toBeNull()
  })

  it('?contact=a2 → focus 报出 Sue 落在 cold 第 1 页（直达链接不再落空）', async () => {
    const { body } = await get('cts', '?view=priority&contact=a2')
    expect(body.focus).toMatchObject({ found: true, section: 'cold', page: 1 })
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

  it('?p_hot=0 → 400', async () => {
    const { status } = await get('cts', '?view=priority&p_hot=0')
    expect(status).toBe(400)
  })

  it('🔴 AI 意向不动人：聊过一轮断了（Stan）不管判高判低都留在 cold，只把意向带出来给抽屉当小字', async () => {
    type Sec = { key: string; total: number; items: Array<Record<string, unknown>> | null }
    const findStan = (body: Record<string, unknown>, key: string) =>
      (body.sections as Sec[]).find((s) => s.key === key)?.items?.find((r) => r.contactId === 'a3')

    BRIEF_ROWS.conversations = [{ id: 'c3', contact_id: 'a3' }]
    for (const level of ['high', 'medium', 'low', 'unknown'] as const) {
      BRIEF_ROWS.conversation_briefs = [
        { conversation_id: 'c3', intent_level: level, next_action: '打给 Stan', generated_at: '2026-10-01T00:00:00.000Z' },
      ]
      const { body } = await get('cts', '?view=priority&open=hot,cold')
      const stan = findStan(body, 'cold')
      expect(stan, `intent=${level} 时 Stan 应在 cold`).toBeTruthy()
      expect(findStan(body, 'hot')).toBeUndefined()
      expect(stan?.intent).toBe(level)
      const na = stan?.nextAction as { list: string; line: string; aiSuggestion: string | null; intentBoost: boolean }
      expect(na.list).toBe('cold')
      expect(na.intentBoost).toBe(false)
      // 名单那一行不许替未校准的 AI 背书（PM 2026-10-10）。
      expect(na.line).not.toContain('意向')
      expect(na.aiSuggestion).toBe('打给 Stan')
    }

    // 没摘要：同一张名单，intent 为 null。
    BRIEF_ROWS.conversations = []
    BRIEF_ROWS.conversation_briefs = []
    const none = await get('cts', '?view=priority&open=hot,cold')
    expect(findStan(none.body, 'cold')?.intent).toBeNull()
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

/**
 * ?kind=retail|trade（2026-09-28 WP-B3）。
 *
 * 独立的 fixture + 假库，不跟上面共用 CONTACTS——那份数组的长度被别的测试
 * 直接拿来断言 total，往里加同行/员工联系人会把那些测试一起带红。
 *
 * 判据跟 `crm/today/route.ts` 同一份 `contactKindOf`/`readDomainRules`：
 * trade_domains 命中算同行，own_email_domains 命中算员工，都不命中算终端客户。
 */
describe('GET contacts — kind 筛选（WP-B3）', () => {
  const KIND_CONTACTS: Row[] = [
    {
      id: 'r1',
      display_name: 'Retail Rita',
      primary_phone: null,
      primary_email: 'rita@gmail.com',
      do_not_contact: false,
      snooze_until: null,
      stage: null,
      first_seen_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't1',
      display_name: 'Trade Tom',
      primary_phone: null,
      primary_email: 'tom@hot.co.nz',
      do_not_contact: false,
      snooze_until: null,
      stage: null,
      first_seen_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 's1',
      display_name: 'Staff Sam',
      primary_phone: null,
      primary_email: 'sam@ctstours.co.nz',
      do_not_contact: false,
      snooze_until: null,
      stage: null,
      first_seen_at: '2026-01-01T00:00:00.000Z',
    },
  ]
  let kindIdentities: Row[] = [
    { contact_id: 'r1', value: 'rita@gmail.com' },
    { contact_id: 't1', value: 'tom@hot.co.nz' },
    { contact_id: 's1', value: 'sam@ctstours.co.nz' },
  ]
  const LEADS_CONFIG = { own_email_domains: ['ctstours.co.nz'], trade_domains: ['hot.co.nz'] }

  function kindFakeDb(table: string) {
    const rec: Recorded = { table, eqs: [], ins: [], ors: [], countHead: false, range: null, orders: [] }
    recorded.push(rec)
    const notIns: Array<[string, string, string]> = []
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
      not: (col: string, op: string, val: string) => {
        notIns.push([col, op, val])
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
      range: () => builder,
      maybeSingle: () => Promise.resolve({ data: { leads_config: LEADS_CONFIG }, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'contacts') {
          let rows = KIND_CONTACTS
          const inFilter = rec.ins.find(([c]) => c === 'id')
          if (inFilter) {
            const wanted = inFilter[1] as string[]
            rows = rows.filter((r) => wanted.includes(r.id as string))
          }
          const notInEntry = notIns.find(([c]) => c === 'id')
          if (notInEntry) {
            const excluded = notInEntry[2].replace(/^\(|\)$/g, '').split(',').filter(Boolean)
            rows = rows.filter((r) => !excluded.includes(r.id as string))
          }
          if (rec.countHead) return resolve({ data: null, count: rows.length, error: null })
          return resolve({ data: rows, count: null, error: null })
        }
        if (table === 'client_pipeline_stages') return resolve({ data: [], error: null })
        if (table === 'contact_identities') return resolve({ data: kindIdentities, error: null })
        return resolve({ data: [], error: null })
      },
    }
    return builder
  }

  beforeEach(() => {
    recorded = []
    kindIdentities = [
      { contact_id: 'r1', value: 'rita@gmail.com' },
      { contact_id: 't1', value: 'tom@hot.co.nz' },
      { contact_id: 's1', value: 'sam@ctstours.co.nz' },
    ]
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(kindFakeDb)
  })

  it('?kind=trade → 只回同行那一个人', async () => {
    const { status, body } = await get('client-a', '?page=1&perPage=100&kind=trade')
    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect((body.items as Array<{ name: string }>).map((r) => r.name)).toEqual(['Trade Tom'])
  })

  it('?kind=retail → 排掉同行和员工，只剩终端客户', async () => {
    const { status, body } = await get('client-a', '?page=1&perPage=100&kind=retail')
    expect(status).toBe(200)
    expect(body.total).toBe(1)
    expect((body.items as Array<{ name: string }>).map((r) => r.name)).toEqual(['Retail Rita'])
  })

  it('不传 kind → 三个人都在，老行为逐字不变（不因为加了这功能就悄悄把员工筛掉）', async () => {
    const { status, body } = await get('client-a', '?page=1&perPage=100')
    expect(status).toBe(200)
    expect(body.total).toBe(3)
  })

  /**
   * 🔴 魏征 2026-09-28 复审查出：`loadTradeAndStaffIds` 的两条分页查询原来漏配
   * `.order(...)`——`range()` 分页没有确定顺序时页之间可能漏行/重复行，同行
   * 或身份超过 1000 条（一页）就会算错「谁是同行」。钉住两条都配了 order。
   */
  it('算同行/员工用的两条查询都配了 order（range 分页没有确定顺序会漏行/重复行）', async () => {
    await get('client-a', '?kind=trade')
    const identitiesQ = recorded.find((r) => r.table === 'contact_identities')
    const contactsLiteQ = recorded.filter((r) => r.table === 'contacts')
    expect(identitiesQ?.orders).toContainEqual(['contact_id', { ascending: true }])
    // 三条 contacts 查询（轻量 id+email、count、分页取行）里至少有一条按 id 排——
    // 只要那条轻量查询配了就够，不用逐条都断言。
    expect(contactsLiteQ.some((r) => r.orders.some(([col]) => col === 'id'))).toBe(true)
  })

  it('?kind=bad-value → 400', async () => {
    const { status, body } = await get('client-a', '?kind=bad-value')
    expect(status).toBe(400)
    expect(body.error).toMatch(/invalid kind/)
  })

  it('这个客户一个同行都没有 → ?kind=trade 直接回空列表，不报错', async () => {
    // 独立的最小假库：contacts 表（不管是轻量身份查询还是主查询）只有一个
    // 终端客户，primary_email 和身份表都不命中任何 trade_domains。
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const builder: Record<string, unknown> = {
        select: (_c?: string, opts?: { count?: string; head?: boolean }) => {
          ;(builder as { _head?: boolean })._head = opts?.head
          return builder
        },
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        // `.or(...)`：找同行/员工时按域名收窄用的（2026-10-26 起只捞可能命中的行）。
        or: () => builder,
        order: () => builder,
        range: () => builder,
        maybeSingle: () => Promise.resolve({ data: { leads_config: LEADS_CONFIG }, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (table === 'contacts') {
            const rows = [
              {
                id: 'r1',
                display_name: 'Retail Rita',
                primary_phone: null,
                primary_email: 'rita@gmail.com',
                do_not_contact: false,
                snooze_until: null,
                stage: null,
                first_seen_at: '2026-01-01T00:00:00.000Z',
              },
            ]
            if ((builder as { _head?: boolean })._head) return resolve({ data: null, count: rows.length, error: null })
            return resolve({ data: rows, count: null, error: null })
          }
          if (table === 'contact_identities') return resolve({ data: [{ contact_id: 'r1', value: 'rita@gmail.com' }], error: null })
          return resolve({ data: [], error: null })
        },
      }
      return builder
    })

    const { status, body } = await get('client-a', '?kind=trade')
    expect(status).toBe(200)
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })
})

describe('GET contacts — ?ids= 只取指定的客人', () => {
  const ID_A = 'a1a1a1a1-0000-4000-8000-000000000001'

  it('只按这几个编号取人和触点，按客户收口，不走排序扫描也不调数据库函数', async () => {
    const { status, body } = await get('c-1', `?ids=${ID_A}`)
    expect(status).toBe(200)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.viewerEmail).toBe('roman@example.com')

    const contactsQ = recorded.find((r) => r.table === 'contacts')
    expect(contactsQ?.eqs).toContainEqual(['client_id', 'c-1'])
    expect(contactsQ?.ins).toContainEqual(['id', [ID_A]])
    const touchQ = recorded.filter((r) => r.table === 'contact_touchpoints')
    expect(touchQ).toHaveLength(1)
    expect(touchQ[0].ins).toContainEqual(['contact_id', [ID_A]])
    expect(touchQ[0].eqs).toContainEqual(['client_id', 'c-1'])
    expect(rpcCalls).toHaveLength(0)
  })

  it('编号不是 uuid、为空或超过 20 个 → 400', async () => {
    expect((await get('c-1', '?ids=not-a-uuid')).status).toBe(400)
    expect((await get('c-1', '?ids=')).status).toBe(400)
    const many = Array.from({ length: 21 }, (_, i) => `a1a1a1a1-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',')
    expect((await get('c-1', `?ids=${many}`)).status).toBe(400)
  })
})
