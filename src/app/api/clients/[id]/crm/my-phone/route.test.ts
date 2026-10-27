import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const access = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: (id: string) => access(id) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const selectFilters: Array<[string, unknown]> = []
const updates: Array<{ patch: unknown; filters: Array<[string, unknown]> }> = []

function mockDb(rows: Array<Record<string, unknown>> | null, selectError = false, updateError = false) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: () => {
      const c: Record<string, unknown> = {}
      c.eq = (k: string, v: unknown) => {
        selectFilters.push([k, v])
        return c
      }
      c.limit = async () => ({ data: rows, error: selectError ? { message: 'x' } : null })
      return c
    },
    update: (patch: unknown) => {
      const rec = { patch, filters: [] as Array<[string, unknown]> }
      updates.push(rec)
      const c: Record<string, unknown> = {}
      c.eq = (k: string, v: unknown) => {
        rec.filters.push([k, v])
        return rec.filters.length >= 2 ? Promise.resolve({ error: updateError ? { message: 'x' } : null }) : c
      }
      return c
    },
  }))
}

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost:3001/x', { method: 'POST', body: JSON.stringify(body) }), { params: { id: 'client-a' } })

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  selectFilters.length = 0
  access.mockResolvedValue({ ok: true, user: { email: 'Op1@Example.test' }, tier: 'admin', allowedClientId: null })
  mockDb([{ id: 'conn-1', extension_map: { '+64277520888': 'boss@example.test' } }])
})

describe('POST 员工登记自己的手机', () => {
  it('成功：只写登录者自己的邮箱，保留别人的，更新限定在本客户的这条连接', async () => {
    const res = await post({ phone: '021 234 5678' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phone: '+64212345678' })
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toEqual({ extension_map: { '+64277520888': 'boss@example.test', '+64212345678': 'op1@example.test' } })
    // 读连接时也必须限定在本客户（防止登记到别的客户的电话连接上）
    expect(selectFilters).toEqual([['client_id', 'client-a'], ['provider', 'twilio'], ['active', true]])
    expect(updates[0].filters).toEqual([['id', 'conn-1'], ['client_id', 'client-a']])
  })
  it('没权限 → 原样返回，不碰数据库', async () => {
    access.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    expect((await post({ phone: '0212345678' })).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  it('body 里想替别人登记（多带 email）也只认登录者', async () => {
    await post({ phone: '0212345678', email: 'boss@example.test' })
    expect((updates[0].patch as { extension_map: Record<string, string> }).extension_map['+64212345678']).toBe('op1@example.test')
  })
  it('没填 / 不是手机号 / 号码属于同事 → 不写库', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ phone: '09 123 4567' })).status).toBe(422)
    expect((await post({ phone: '027 752 0888' })).status).toBe(422)
    expect(updates).toHaveLength(0)
  })
  it('没接入电话 / 连接不唯一 / 读写失败 → 明确报错不写库', async () => {
    mockDb([])
    expect((await post({ phone: '0212345678' })).status).toBe(422)
    mockDb([{ id: 'a', extension_map: {} }, { id: 'b', extension_map: {} }])
    expect((await post({ phone: '0212345678' })).status).toBe(422)
    mockDb(null, true)
    expect((await post({ phone: '0212345678' })).status).toBe(500)
    expect(updates).toHaveLength(0)
    mockDb([{ id: 'conn-1', extension_map: null }], false, true)
    expect((await post({ phone: '0212345678' })).status).toBe(500)
  })
})
