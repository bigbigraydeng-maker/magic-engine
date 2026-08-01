/**
 * 「我的客人」读接口 —— 重点是**越权**。
 *
 * 这一页给外部登录的中介用。库里所有客户的人躺在同一张表里，只靠每条查询后面
 * 那个 .eq('client_id', clientId) 分开。所以这里的假数据库是**真的会按条件过滤**的
 * （不是记录一下调用就返回固定行）：任何一条查询漏掉 client_id，隔壁中介的客人
 * 就会出现在返回体里，测试当场变红。
 *
 * 变异验证（2026-08-01 实跑）：
 *   把 contacts 查询的 .eq('client_id', clientId) 删掉 → 本文件 3 个用例变红
 *   （「只返回自己客户的人」「不串到别人的人」「totalPeople」）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const access = vi.hoisted(() => ({
  result: { ok: true, user: { email: 'roman@example.com' }, allowedClientId: 'client-a' } as unknown,
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => access.result),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from '../route'

type Row = Record<string, unknown>

/**
 * 会真正执行 .eq() 过滤的假 supabase。少一个 eq = 多返回一批行 —— 这正是我们要抓的。
 */
function fakeDb(tables: Record<string, Row[]>) {
  return (table: string) => {
    const filters: Array<[string, unknown]> = []
    const run = (from: number, to: number) => {
      const rows = (tables[table] ?? []).filter((r) =>
        filters.every(([col, val]) => r[col] === val),
      )
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    }
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return builder
      },
      order: () => builder,
      range: (from: number, to: number) => run(from, to),
      // 行业查询走 maybeSingle（不翻页）—— 它决定这一页适不适用于这个客户。
      maybeSingle: () => {
        const rows = (tables[table] ?? []).filter((r) =>
          filters.every(([col, val]) => r[col] === val),
        )
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      },
    }
    return builder
  }
}

const LISTING_A = { id: 'l-a', client_id: 'client-a', address_line: '30 Kiteroa Road', suburb: 'Rothesay Bay', status: 'live' }
const LISTING_B = { id: 'l-b', client_id: 'client-b', address_line: '999 Stranger St', suburb: 'Elsewhere', status: 'live' }

const DATA = {
  // 地产客户 —— 这一页对它适用。
  clients: [
    { id: 'client-a', industry: 'real_estate' },
    { id: 'client-b', industry: 'real_estate' },
  ],
  contacts: [
    // 自己人：挂在自己的房子上，有广告名。
    { id: 'a1', client_id: 'client-a', display_name: '张先生', stage: null, listing_id: 'l-a', attr_ad_name: '30 Kiteroa - Reel A', attr_platform: 'meta' },
    // 自己人：没挂房子，也没有任何归因。
    { id: 'a2', client_id: 'client-a', display_name: '李小姐', stage: 'contacted', listing_id: null, attr_ad_name: null, attr_platform: null },
    // 自己人：挂着**别的客户**的房子 id（脏数据）—— 绝不能因此显示别人的房子。
    { id: 'a3', client_id: 'client-a', display_name: '王女士', stage: null, listing_id: 'l-b', attr_ad_name: null, attr_platform: null },
    // 隔壁中介的客人：一个字都不该出现在返回体里。
    { id: 'b1', client_id: 'client-b', display_name: '隔壁老王', stage: null, listing_id: 'l-b', attr_ad_name: null, attr_platform: null },
  ],
  contact_touchpoints: [
    { contact_id: 'a1', client_id: 'client-a', channel: 'meta_lead_form', occurred_at: '2026-07-20T00:00:00Z', summary: '填了表单', attr_ad_name: null },
    { contact_id: 'a1', client_id: 'client-a', channel: 'messenger', occurred_at: '2026-07-30T00:00:00Z', summary: '问了单价', attr_ad_name: null },
    { contact_id: 'a2', client_id: 'client-a', channel: 'messenger', occurred_at: '2026-07-10T00:00:00Z', summary: null, attr_ad_name: null },
    { contact_id: 'b1', client_id: 'client-b', channel: 'messenger', occurred_at: '2026-07-31T00:00:00Z', summary: '隔壁的私信内容', attr_ad_name: null },
  ],
  listings: [LISTING_A, LISTING_B],
  client_pipeline_stages: [
    { client_id: 'client-a', stage_key: 'new', label: '新线索' },
    { client_id: 'client-a', stage_key: 'contacted', label: '已联系' },
    { client_id: 'client-a', stage_key: 'qualified', label: '真买家' },
    { client_id: 'client-b', stage_key: 'qualified', label: '隔壁的档' },
  ],
  conversations: [
    { id: 'cv1', client_id: 'client-a', contact_id: 'a1' },
    { id: 'cv2', client_id: 'client-b', contact_id: 'b1' },
  ],
  conversation_briefs: [
    { conversation_id: 'cv1', client_id: 'client-a', summary: '他问了单价和车位', intent_level: 'high' },
    { conversation_id: 'cv2', client_id: 'client-b', summary: '隔壁的简报', intent_level: 'high' },
  ],
} satisfies Record<string, Row[]>

async function call(clientId = 'client-a') {
  const res = await GET(new NextRequest(`http://localhost/api/clients/${clientId}/contacts`), {
    params: { id: clientId },
  })
  return { status: res.status, body: await res.json() }
}

interface Person {
  contactId: string
  name: string
  source: { text: string; confidence: string } | null
  lastTouchText: string | null
  aiSummary: string | null
  stageLabel: string | null
  suggestion: { toStage: string; label: string } | null
}
interface Group {
  listingId: string | null
  title: string
  people: Person[]
}

beforeEach(() => {
  access.result = { ok: true, user: { email: 'roman@example.com' }, allowedClientId: 'client-a' }
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(fakeDb(DATA))
})

describe('GET /api/clients/[id]/contacts — 隔离', () => {
  it('只返回自己客户的人', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    const ids = (body.groups as Group[]).flatMap((g) => g.people.map((p) => p.contactId))
    expect(ids.sort()).toEqual(['a1', 'a2', 'a3'])
    expect(body.totalPeople).toBe(3)
  })

  it('返回体里一个字都不该出现隔壁客户的人和内容', async () => {
    const { body } = await call()
    const dump = JSON.stringify(body)
    expect(dump).not.toContain('隔壁老王')
    expect(dump).not.toContain('隔壁的私信内容')
    expect(dump).not.toContain('隔壁的简报')
    expect(dump).not.toContain('隔壁的档')
    expect(dump).not.toContain('b1')
  })

  it('挂着别人房子 id 的人 → 归到「还没挂到房子上」，绝不显示别人的地址', async () => {
    const { body } = await call()
    const dump = JSON.stringify(body)
    expect(dump).not.toContain('999 Stranger St')
    const noListing = (body.groups as Group[]).find((g) => g.listingId === null)
    expect(noListing?.people.map((p) => p.contactId).sort()).toEqual(['a2', 'a3'])
  })

  it('没通过鉴权就原样把状态码抛回去，不落任何数据', async () => {
    access.result = { ok: false, status: 403, error: 'Forbidden' }
    const { status, body } = await call()
    expect(status).toBe(403)
    expect(body.groups).toBeUndefined()
  })
})

describe('GET /api/clients/[id]/contacts — 读模型', () => {
  it('按房子分组，房子在前、没挂房子的垫底', async () => {
    const { body } = await call()
    const groups = body.groups as Group[]
    expect(groups.map((g) => g.title)).toEqual(['30 Kiteroa Road', '还没挂到房子上的客人'])
  })

  it('有广告名就显示广告名；什么都没有就留空', async () => {
    const { body } = await call()
    const people = (body.groups as Group[]).flatMap((g) => g.people)
    expect(people.find((p) => p.contactId === 'a1')?.source).toEqual({
      text: '30 Kiteroa - Reel A',
      confidence: 'ad',
    })
    // a2 没有任何归因，只有一条私信触点 → 只能说「从 Facebook 私信找上门」
    expect(people.find((p) => p.contactId === 'a2')?.source).toEqual({
      text: 'Facebook 私信',
      confidence: 'entry',
    })
    // a3 一条触点都没有 → 留空
    expect(people.find((p) => p.contactId === 'a3')?.source).toBeNull()
  })

  it('最后一次往来取最晚那条的原话', async () => {
    const { body } = await call()
    const a1 = (body.groups as Group[]).flatMap((g) => g.people).find((p) => p.contactId === 'a1')
    expect(a1?.lastTouchText).toBe('问了单价')
  })

  it('简报挂到人身上，高意向 + 没标过 → 给出建议', async () => {
    const { body } = await call()
    const a1 = (body.groups as Group[]).flatMap((g) => g.people).find((p) => p.contactId === 'a1')
    expect(a1?.aiSummary).toBe('他问了单价和车位')
    expect(a1?.suggestion).toEqual({
      toStage: 'qualified',
      label: '真买家',
      why: expect.any(String),
    })
  })

  it('已经标过的人显示他现在那一档，且不再给建议', async () => {
    const { body } = await call()
    const a2 = (body.groups as Group[]).flatMap((g) => g.people).find((p) => p.contactId === 'a2')
    expect(a2?.stageLabel).toBe('已联系')
    expect(a2?.suggestion).toBeNull()
  })

  it('档位列表只给这个客户自己配的', async () => {
    const { body } = await call()
    expect((body.stages as Array<{ stageKey: string }>).map((s) => s.stageKey)).toEqual([
      'new',
      'contacted',
      'qualified',
    ])
  })
})

// ── 这一页适不适用（2026-08-02 PM 反馈）─────────────────────────────────────
//
// 整页围绕「按房子分组」建的。PM 在**旅游**客户 CTS 身上打开它，看到「按房子
// 分开列」+ 一大坨没分组的人 —— 文案在说房子、客户根本没有房子。
describe('这一页适不适用于这个客户', () => {
  const call = (clientId: string) =>
    GET(new NextRequest('http://localhost:3001/x'), { params: { id: clientId } })

  it('地产客户 → 适用', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(fakeDb(DATA))
    const body = await (await call('client-a')).json()
    expect(body.applicable).toBe(true)
  })

  it('🔴 旅游客户、0 套房 → 不适用（CTS 就是这个）', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(
      fakeDb({ ...DATA, clients: [{ id: 'client-a', industry: 'travel' }], listings: [] }),
    )
    const body = await (await call('client-a')).json()
    expect(body.applicable).toBe(false)
    expect(body.hasListings).toBe(false)
  })

  it('行业没填对、但确实录了房子 → 仍然适用（别因为配置漏填就锁掉在用的人）', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(
      fakeDb({ ...DATA, clients: [{ id: 'client-a', industry: 'other' }] }),
    )
    const body = await (await call('client-a')).json()
    expect(body.applicable).toBe(true)
    expect(body.hasListings).toBe(true)
  })

  it('地产客户但还没录房子 → 适用，只是页头不提「按房子分开列」', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(
      fakeDb({ ...DATA, listings: [] }),
    )
    const body = await (await call('client-a')).json()
    expect(body.applicable).toBe(true)
    expect(body.hasListings).toBe(false)
  })
})
