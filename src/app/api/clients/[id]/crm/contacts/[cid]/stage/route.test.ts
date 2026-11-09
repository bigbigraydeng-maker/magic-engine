/**
 * 改状态接口的**归属校验**。
 *
 * 「我的客人」那一页每一次点击都打到这里。它是外部登录的中介唯一能写库的入口，
 * 所以这里钉死一件事：URL 上带个别人的 contact id，必须 404 且**一行都不许写**。
 * 光靠 requirePaidClientAccess 不够 —— 它只回答「这个人能不能碰 client-a」，
 * 回答不了「这个 contact 是不是 client-a 的」。
 *
 * 变异验证（2026-08-01 实跑）：
 *   把 contacts 查询里的 .eq('client_id', clientId) 删掉
 *   → 「改不动别的客户的人」「越权时不写库」「越权时不留审计」3 个用例变红
 *     （返回 200、update 与 insert 都被调用）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({
    ok: true,
    user: { email: 'roman@example.com' },
    allowedClientId: 'client-a',
  })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { PATCH } from './route'

type Row = Record<string, unknown>

const CONTACTS: Row[] = [
  { id: 'a1', client_id: 'client-a', stage: 'new' },
  // 隔壁中介的客人。
  { id: 'b1', client_id: 'client-b', stage: 'new' },
  // 刚导入、还没人标过阶段。
  { id: 'a2', client_id: 'client-a', stage: null },
]

const STAGES: Row[] = [
  { client_id: 'client-a', stage_key: 'qualified' },
  { client_id: 'client-b', stage_key: 'qualified' },
]

let updates: Array<{ patch: Row; filters: Array<[string, unknown]> }>
let inserts: Row[]

/** 会真正按 .eq() 过滤的假库。少一个 eq = 能读到（并改到）别人的行。 */
function fakeDb(table: string) {
  const filters: Array<[string, unknown]> = []
  const rowsOf = (): Row[] => {
    const src = table === 'contacts' ? CONTACTS : table === 'client_pipeline_stages' ? STAGES : []
    return src.filter((r) => filters.every(([c, v]) => r[c] === v))
  }
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val])
      return builder
    },
    maybeSingle: async () => ({ data: rowsOf()[0] ?? null, error: null }),
    update: (patch: Row) => {
      updates.push({ patch, filters })
      return builder
    },
    // 变更记录现在**先写、并取回 id**：它不再只是审计，`today` 路由靠它的
    // `from_stage` 判断「这个人今天早上本来在不在名单上」；写失败要让整个请求
    // 失败，改库失败要拿这个 id 把它定点删掉（见路由里的说明）。
    // 所以桩要还一条 `.select().single()` 的链，不能只 await。
    insert: (row: Row) => {
      inserts.push(row)
      return {
        select: () => ({ single: async () => ({ data: { id: 'evt-1' }, error: null }) }),
        then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
      }
    },
    // update(...).eq(...).eq(...) 最后被 await
    then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
  }
  return builder
}

async function patch(clientId: string, cid: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/clients/${clientId}/crm/contacts/${cid}/stage`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  const res = await PATCH(req, { params: { id: clientId, cid } })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  updates = []
  inserts = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(fakeDb)
})

describe('PATCH stage — 归属校验', () => {
  it('改不动别的客户的人', async () => {
    const { status, body } = await patch('client-a', 'b1', { toStage: 'qualified' })
    expect(status).toBe(404)
    expect(body.error).toBe('联系人不存在')
  })

  it('越权时一行都不写', async () => {
    await patch('client-a', 'b1', { toStage: 'qualified' })
    expect(updates).toHaveLength(0)
  })

  it('越权时也不留审计（不能靠审计表反推别人有没有这个人）', async () => {
    await patch('client-a', 'b1', { toStage: 'qualified' })
    expect(inserts).toHaveLength(0)
  })

  it('自己的人改得动，并且 update 语句本身也带着 client_id', async () => {
    const { status, body } = await patch('client-a', 'a1', { toStage: 'qualified' })
    expect(status).toBe(200)
    expect(body).toEqual({ stage: 'qualified', changed: true })
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toEqual(
      expect.arrayContaining([
        ['id', 'a1'],
        ['client_id', 'client-a'],
      ]),
    )
  })

  it('改完留一条审计，记着从哪一档到哪一档、谁改的', async () => {
    await patch('client-a', 'a1', { toStage: 'qualified', note: '打过电话了' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      client_id: 'client-a',
      contact_id: 'a1',
      from_stage: 'new',
      to_stage: 'qualified',
      changed_by: 'roman@example.com',
      note: '打过电话了',
    })
  })
})

describe('PATCH stage — 合法值', () => {
  it('不是这个客户配的档 → 400，不写库', async () => {
    const { status, body } = await patch('client-a', 'a1', { toStage: '随便写一个' })
    expect(status).toBe(400)
    expect(body.error).toBe('这个阶段不存在')
    expect(updates).toHaveLength(0)
  })

  it('缺 toStage → 400', async () => {
    const { status } = await patch('client-a', 'a1', {})
    expect(status).toBe(400)
  })
})

describe('PATCH stage — expectedFromStage 并发保护（2026-09-28）', () => {
  it('不传 → 老行为，照常改', async () => {
    const { status, body } = await patch('client-a', 'a1', { toStage: 'qualified' })
    expect(status).toBe(200)
    expect(body).toEqual({ stage: 'qualified', changed: true })
  })

  it('🔴 传了、跟库里现在的不一致 → 409，带上 actualStage，不写库', async () => {
    const { status, body } = await patch('client-a', 'a1', { toStage: 'qualified', expectedFromStage: 'contacted' })
    expect(status).toBe(409)
    expect(body.actualStage).toBe('new')
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })

  it('传了、跟库里一致 → 照常改', async () => {
    const { status } = await patch('client-a', 'a1', { toStage: 'qualified', expectedFromStage: 'new' })
    expect(status).toBe(200)
  })

  /**
   * 🔴 魏征 2026-09-28 复审 B2 实现时查出：路由层曾经把「body 里 expectedFromStage
   * 是 null」和「body 里根本没有这个字段」都解析成 undefined，导致并发闸对
   * 「这个人还没标过任何阶段」这批人（PersonDrawer 发的正是 `row.stage`，
   * 刚导入的客户这里就是 null）完全失效——而这正是两人同时抢着标第一下最容易
   * 撞上的场景。这里锁住修好之后的行为。
   */
  it('expectedFromStage: null，且库里这个人确实还没标过 → 照常改（两边都是"还没标"）', async () => {
    const { status } = await patch('client-a', 'a2', { toStage: 'qualified', expectedFromStage: null })
    expect(status).toBe(200)
  })

  it('🔴 expectedFromStage: null，但库里其实已经被标过了 → 409，null 不等于"没传"', async () => {
    const { status, body } = await patch('client-a', 'a1', { toStage: 'qualified', expectedFromStage: null })
    expect(status).toBe(409)
    expect(body.actualStage).toBe('new')
  })
})
