/**
 * POST /api/admin/conversions/outcomes/[id]/redact —— 客人要求删除个人信息。
 *
 * 钉住一件事：被清空的列必须包含 Facebook 线索编号（meta_lead_id）。它能反查到具体
 * 一次表单提交（含姓名电话），跟邮箱/电话/PSID 一样是“能认出真人的标识符”。
 * 以后有人重构这个路由漏掉这一列，数据库那条约束会报错、而这条测试会先红。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: vi.fn(async () => null),
  requireAdmin: vi.fn(async () => ({ ok: true, user: { email: 'fde@example.com' } })),
}))
vi.mock('@/lib/conversions/route-guard', () => ({
  assertClientScope: vi.fn(() => null),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { redactQualifiedSourceRef } from '@/lib/conversions/conversion-lead'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const RAW_LEAD = '1687504185706630'
const RAW_REF = `crm_qualified:${RAW_LEAD}:quoted`

type Row = Record<string, unknown>
let updates: Array<{ table: string; patch: Row }>
let inserts: Array<{ table: string; row: Row }>

function chain(table: string) {
  const q: Record<string, unknown> = {}
  const self = () => q
  q.select = self
  q.eq = self
  q.in = self
  q.maybeSingle = async () =>
    table === 'me_sale_outcomes'
      ? { data: { id: 'o-1', client_id: 'c-1', redacted_at: null, source_ref: RAW_REF }, error: null }
      : { data: null, error: null }
  q.update = (patch: Row) => {
    updates.push({ table, patch })
    return q
  }
  q.insert = async (row: Row) => {
    inserts.push({ table, row })
    return { data: null, error: null }
  }
  // `.select('id').eq(...).eq('status','sending')` 这类直接 await 的链
  q.then = (res: (v: { data: Row[]; error: null; patch?: Row }) => unknown) =>
    Promise.resolve(res({ data: [], error: null }))
  return q
}

beforeEach(() => {
  updates = []
  inserts = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => chain(table)) as never)
})

describe('redact · 清空个人信息列', () => {
  it('🔴 更新载荷里 meta_lead_id、page_scoped_user_id 和邮箱/电话/姓名一起被置 null', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: '{"reason":"客人要求"}' }), {
      params: { id: 'o-1' },
    })
    expect(res.status).toBe(200)

    const redact = updates.find((u) => u.table === 'me_sale_outcomes')
    expect(redact, '没有对 me_sale_outcomes 发出更新').toBeDefined()
    for (const col of [
      'customer_email',
      'customer_phone',
      'customer_first',
      'customer_last',
      'page_scoped_user_id',
      'meta_lead_id',
    ]) {
      expect(redact!.patch, col).toHaveProperty(col, null)
    }
    expect(typeof redact!.patch.redacted_at).toBe('string')
    expect(redact!.patch.source_ref).toBe(redactQualifiedSourceRef(RAW_REF))
    expect(JSON.stringify({ updates, inserts })).not.toContain(RAW_LEAD)
  })
})
