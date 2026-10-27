import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const access = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: (id: string) => access(id) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

/** 带状态的假库：一张电话连接表，extension_map 真的会被读到、写回。 */
interface Fake {
  rows: Array<{ id: string; extension_map: unknown }>
  selectError: boolean
  updateError: boolean
  /** 每次 update 之后立刻把表改成这个（模拟别的员工同时写，覆盖掉我们的）；返回 null 表示不干扰。 */
  raceAfterUpdate?: (n: number) => unknown | null
}
let fake: Fake
const selectFilters: Array<[string, unknown]> = []
const updates: Array<{ patch: unknown; filters: Array<[string, unknown]> }> = []
let updateCount = 0

function install() {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: (cols: string) => {
      const filters: Array<[string, unknown]> = []
      const run = () => {
        selectFilters.push(...filters)
        if (fake.selectError) return { data: null, error: { message: 'x' } }
        const id = filters.find(([k]) => k === 'id')?.[1]
        const hit = id ? fake.rows.filter((r) => r.id === id) : fake.rows
        return { data: cols === 'id' ? hit.map((r) => ({ id: r.id })) : hit, error: null }
      }
      const c: Record<string, unknown> = {}
      c.eq = (k: string, v: unknown) => {
        filters.push([k, v])
        return c
      }
      c.limit = async () => run()
      c.maybeSingle = async () => {
        const r = run()
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error }
      }
      return c
    },
    update: (patch: { extension_map: unknown }) => {
      const rec = { patch, filters: [] as Array<[string, unknown]> }
      updates.push(rec)
      const c: Record<string, unknown> = {}
      c.eq = (k: string, v: unknown) => {
        rec.filters.push([k, v])
        if (rec.filters.length < 2) return c
        if (fake.updateError) return Promise.resolve({ error: { message: 'x' } })
        const row = fake.rows.find((r) => r.id === rec.filters[0][1])
        if (row) row.extension_map = patch.extension_map
        const race = fake.raceAfterUpdate?.(++updateCount)
        if (race != null && row) row.extension_map = race
        return Promise.resolve({ error: null })
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
  updateCount = 0
  fake = { rows: [{ id: 'conn-1', extension_map: { '+64277520888': 'boss@example.test' } }], selectError: false, updateError: false }
  access.mockResolvedValue({ ok: true, user: { email: 'Op1@Example.test' }, tier: 'admin', allowedClientId: null })
  install()
})

describe('POST 员工登记自己的手机', () => {
  it('成功：只写登录者自己的邮箱，保留别人的，读写都限定在本客户的这条连接', async () => {
    const res = await post({ phone: '021 234 5678' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, phone: '+64212345678' })
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toEqual({ extension_map: { '+64277520888': 'boss@example.test', '+64212345678': 'op1@example.test' } })
    expect(updates[0].filters).toEqual([['id', 'conn-1'], ['client_id', 'client-a']])
    expect(selectFilters.filter(([k]) => k === 'client_id').every(([, v]) => v === 'client-a')).toBe(true)
    expect(selectFilters.filter(([k]) => k === 'client_id').length).toBe(3)
    expect(selectFilters).toContainEqual(['provider', 'twilio'])
    expect(selectFilters).toContainEqual(['active', true])
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
    fake.rows = []
    expect((await post({ phone: '0212345678' })).status).toBe(422)
    fake.rows = [{ id: 'a', extension_map: {} }, { id: 'b', extension_map: {} }]
    expect((await post({ phone: '0212345678' })).status).toBe(422)
    fake.selectError = true
    expect((await post({ phone: '0212345678' })).status).toBe(500)
    expect(updates).toHaveLength(0)
    fake.selectError = false
    fake.rows = [{ id: 'conn-1', extension_map: {} }]
    fake.updateError = true
    expect((await post({ phone: '0212345678' })).status).toBe(500)
  })
  it('🔴 库里的登记表被人工改坏（含 null / 数字值、或根本不是对象）→ 清掉坏条目照常登记，不 500', async () => {
    fake.rows = [{ id: 'conn-1', extension_map: { '+64277520888': 'boss@example.test', '+64211111111': null, '+64222222222': 5 } }]
    expect((await post({ phone: '0212345678' })).status).toBe(200)
    expect(updates[0].patch).toEqual({ extension_map: { '+64277520888': 'boss@example.test', '+64212345678': 'op1@example.test' } })
    fake.rows = [{ id: 'conn-1', extension_map: ['x'] }]
    expect((await post({ phone: '0212345679' })).status).toBe(200)
  })
  it('🔴 同时有人登记把我们的写入盖掉 → 回读发现没保住，重来一次后成功，不骗员工「已登记」', async () => {
    fake.raceAfterUpdate = (n) => (n === 1 ? { '+64277520888': 'boss@example.test' } : null)
    const res = await post({ phone: '0212345678' })
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(2)
    expect((fake.rows[0].extension_map as Record<string, string>)['+64212345678']).toBe('op1@example.test')
  })
  it('一直被盖掉 → 3 次后老实报 409，不假装成功', async () => {
    fake.raceAfterUpdate = () => ({ '+64277520888': 'boss@example.test' })
    const res = await post({ phone: '0212345678' })
    expect(res.status).toBe(409)
    expect(updates).toHaveLength(3)
  })
})
