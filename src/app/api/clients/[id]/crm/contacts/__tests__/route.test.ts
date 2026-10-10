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
    then: (resolve: (v: unknown) => unknown) => {
      if (table === 'contacts') {
        // count 查询（head）只回 count；取页查询回行。
        if (rec.countHead) return resolve({ data: null, count: CONTACTS.length, error: null })
        return resolve({ data: CONTACTS, count: null, error: null })
      }
      if (table === 'client_pipeline_stages') return resolve({ data: STAGES, error: null })
      if (table === 'contact_touchpoints') return resolve({ data: STALE_TOUCHES, error: null })
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
  recorded = []
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
    expect(bob?.nextAction).toMatchObject({ list: expect.any(String), line: expect.any(String) })
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

  it('聊过一轮断了（Stan）+ AI 判高意向 → 抬进 hot；判低意向 → 留在 cold，位置跟没摘要时一样', async () => {
    type Sec = { key: string; total: number; items: Array<Record<string, unknown>> | null }
    const findStan = (body: Record<string, unknown>, key: string) =>
      (body.sections as Sec[]).find((s) => s.key === key)?.items?.find((r) => r.contactId === 'a3')

    BRIEF_ROWS.conversations = [{ id: 'c3', contact_id: 'a3' }]
    BRIEF_ROWS.conversation_briefs = [
      { conversation_id: 'c3', intent_level: 'high', next_action: '打给 Stan', generated_at: '2026-10-01T00:00:00.000Z' },
    ]
    const high = await get('cts', '?view=priority&open=hot,cold')
    const stanHigh = findStan(high.body, 'hot')
    expect(stanHigh).toBeTruthy()
    expect(stanHigh?.intent).toBe('high')
    expect((stanHigh?.nextAction as { list: string; line: string; aiSuggestion: string | null }).list).toBe('hot')
    expect((stanHigh?.nextAction as { line: string }).line).toContain('AI 读完对话判他意向高')
    expect((stanHigh?.nextAction as { aiSuggestion: string | null }).aiSuggestion).toBe('打给 Stan')
    expect(findStan(high.body, 'cold')).toBeUndefined()

    BRIEF_ROWS.conversation_briefs = [
      { conversation_id: 'c3', intent_level: 'low', next_action: '打给 Stan', generated_at: '2026-10-01T00:00:00.000Z' },
    ]
    const low = await get('cts', '?view=priority&open=hot,cold')
    const stanLow = findStan(low.body, 'cold')
    expect(stanLow).toBeTruthy()
    expect(stanLow?.intent).toBe('low')
    expect((stanLow?.nextAction as { list: string }).list).toBe('cold')
    expect(findStan(low.body, 'hot')).toBeUndefined()

    // 没摘要：跟低意向落同一张名单 —— 意向只往上提，不往下压。
    BRIEF_ROWS.conversations = []
    BRIEF_ROWS.conversation_briefs = []
    const none = await get('cts', '?view=priority&open=hot,cold')
    expect(findStan(none.body, 'cold')).toBeTruthy()
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
