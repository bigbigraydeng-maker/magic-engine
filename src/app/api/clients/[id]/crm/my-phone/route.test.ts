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
  /** 我们每次条件更新执行前调用（模拟别的员工在我们读完之后抢先写入）。 */
  beforeUpdate?: (n: number) => void
}
let fake: Fake
const selectFilters: Array<[string, unknown]> = []
const updates: Array<{ patch: unknown; filters: Array<[string, unknown]> }> = []
let updateCount = 0
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x))

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
        return c
      }
      c.is = c.eq
      // 条件更新：旧值对不上就 0 行；beforeUpdate 让别的请求在「我读完、我写之前」插进来。
      c.select = async () => {
        fake.beforeUpdate?.(++updateCount)
        if (fake.updateError) return { data: null, error: { message: 'x' } }
        const get = (key: string) => rec.filters.find(([k]) => k === key)?.[1]
        const row = fake.rows.find((r) => r.id === get('id'))
        const want = get('extension_map')
        const same = row && (want === null ? row.extension_map === null : canon(row.extension_map) === canon(JSON.parse(want as string)))
        if (!row || !same) return { data: [], error: null }
        row.extension_map = patch.extension_map
        return { data: [{ id: row.id }], error: null }
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
    expect(updates[0].filters.slice(0, 2)).toEqual([['id', 'conn-1'], ['client_id', 'client-a']])
    expect(updates[0].filters[2][0]).toBe('extension_map')
    expect(selectFilters.filter(([k]) => k === 'client_id').every(([, v]) => v === 'client-a')).toBe(true)
    expect(selectFilters.filter(([k]) => k === 'client_id').length).toBe(2)
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
  it('🔴 两人交错：同事在我读完后先登记成功，我的旧快照写入被拒，重读后两个号都保留（同事号码不丢）', async () => {
    fake.beforeUpdate = (n) => {
      if (n === 1) (fake.rows[0].extension_map as Record<string, string>)['+64219999999'] = 'colleague@example.test'
    }
    const res = await post({ phone: '0212345678' })
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(2)
    expect(fake.rows[0].extension_map).toEqual({
      '+64277520888': 'boss@example.test',
      '+64219999999': 'colleague@example.test',
      '+64212345678': 'op1@example.test',
    })
  })
  it('🔴 两人交错抢同一个号：对方先登记成功，我重读校验后被拒，不覆盖对方', async () => {
    fake.beforeUpdate = (n) => {
      if (n === 1) (fake.rows[0].extension_map as Record<string, string>)['+64212345678'] = 'colleague@example.test'
    }
    const res = await post({ phone: '0212345678' })
    expect(res.status).toBe(422)
    expect((fake.rows[0].extension_map as Record<string, string>)['+64212345678']).toBe('colleague@example.test')
  })
  it('一直有人抢先写 → 5 次后老实报 409，不假装成功', async () => {
    let i = 0
    fake.beforeUpdate = () => {
      ;(fake.rows[0].extension_map as Record<string, string>)[`+6421000000${i++}`] = 'x@example.test'
    }
    const res = await post({ phone: '0212345678' })
    expect(res.status).toBe(409)
    expect(updates).toHaveLength(5)
  })
})
