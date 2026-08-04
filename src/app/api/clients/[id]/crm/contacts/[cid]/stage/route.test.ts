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
    insert: async (row: Row) => {
      inserts.push(row)
      return { error: null }
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
