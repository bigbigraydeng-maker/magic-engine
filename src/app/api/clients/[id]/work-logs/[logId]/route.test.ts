import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>

// 假 supabase：按「表」建模（一张内存里的 fde_work_logs），不按调用次序。
// touched = 路由碰了几次库；鉴权被拒的用例必须断言它是 0。
const db = vi.hoisted(() => {
  const state = { rows: [] as Record<string, unknown>[], touched: 0, fail: false }
  function from(table: string) {
    if (table !== 'fde_work_logs') throw new Error(`unexpected table ${table}`)
    state.touched += 1
    let op: 'select' | 'insert' | 'delete' = 'select'
    let inserted: Record<string, unknown> | null = null
    const filters: Record<string, unknown> = {}
    const run = () => {
      if (state.fail) return { data: null, error: { message: 'SECRET_DB_DETAIL relation "fde_work_logs" column xyz' } }
      const match = (r: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => r[k] === v)
      if (op === 'insert' && inserted) {
        const row = { id: 'log-new', created_at: '2026-10-10T00:00:00Z', ...inserted }
        state.rows.push(row)
        return { data: [row], error: null }
      }
      if (op === 'delete') {
        const removed = state.rows.filter(match)
        state.rows = state.rows.filter((r) => !match(r))
        return { data: removed, error: null }
      }
      return { data: state.rows.filter(match), error: null }
    }
    const builder = {
      select: () => builder,
      insert: (row: Record<string, unknown>) => { op = 'insert'; inserted = row; return builder },
      delete: () => { op = 'delete'; return builder },
      eq: (col: string, val: unknown) => { filters[col] = val; return builder },
      order: () => builder,
      limit: () => builder,
      single: async () => { const r = run(); return { data: r.data ? r.data[0] ?? null : null, error: r.error } },
      then: <T>(resolve: (v: ReturnType<typeof run>) => T) => Promise.resolve(run()).then(resolve),
    }
    return builder
  }
  return { state, from }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: db.from } }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))

import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const mockAccess = vi.mocked(requireDashboardClientAccess)

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000000'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000000'

// 守卫的真实行为：按「调用时传入的 clientId」判，而不是固定放行。
// 这样「A 客户成员请求 B 客户」的用例测的是路由把 params.id 原样交给守卫。
function asMemberOf(clientId: string, email = 'staff@client-a.example') {
  mockAccess.mockImplementation(async (requested: string) =>
    requested === clientId
      ? { ok: true, user: { email } as never, role: 'client-viewer', tier: 'paid_client', allowedClientId: clientId }
      : { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' },
  )
}
function asGlobalAdmin(email = 'ray@magicengine.example') {
  mockAccess.mockImplementation(async () => ({
    ok: true, user: { email } as never, role: 'admin', tier: 'admin', allowedClientId: null,
  }))
}
function asScopedAdminOf(clientId: string, email = 'demo@magicengine.example') {
  mockAccess.mockImplementation(async (requested: string) =>
    requested === clientId
      ? { ok: true, user: { email } as never, role: 'admin', tier: 'admin', allowedClientId: clientId }
      : { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' },
  )
}
function asAnonymous() {
  mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized', reason: 'unauthorized' })
}

// 非管理员的全部档位：写删必须对每一档都拒，而不是只拒 paid_client。
const NON_ADMIN_TIERS = ['paid_client', 'self_serve', 'portal_only'] as const
function asTierOf(clientId: string, tier: (typeof NON_ADMIN_TIERS)[number]) {
  mockAccess.mockImplementation(async (requested: string) =>
    requested === clientId
      ? { ok: true, user: { email: 'staff@client-a.example' } as never, role: 'client-viewer', tier, allowedClientId: clientId }
      : { ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' },
  )
}
function asAdminWithoutEmail() {
  mockAccess.mockImplementation(async () => ({
    ok: true, user: {} as never, role: 'admin', tier: 'admin', allowedClientId: null,
  }))
}
function asLookupFailed() {
  mockAccess.mockResolvedValue({ ok: false, status: 500, error: 'Authorization check failed', reason: 'lookup_failed' })
}

function seed(): Row[] {
  return [
    { id: 'log-a1', client_id: CLIENT_A, log_date: '2026-10-09', summary: 'A one', author_email: 'fde@magicengine.example', created_at: '2026-10-09T01:00:00Z' },
    { id: 'log-b1', client_id: CLIENT_B, log_date: '2026-10-09', summary: 'B one', author_email: 'fde@magicengine.example', created_at: '2026-10-09T02:00:00Z' },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  db.state.rows = seed()
  db.state.touched = 0
  db.state.fail = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

import { DELETE } from './route'

function del(id: string, logId: string) {
  return DELETE(
    new NextRequest(`http://localhost:3001/api/clients/${id}/work-logs/${logId}`, { method: 'DELETE' }),
    { params: { id, logId } },
  )
}

describe('DELETE /api/clients/[id]/work-logs/[logId]', () => {
  it('未登录 → 401，不碰库，数据不变', async () => {
    asAnonymous()

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(401)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('A 客户成员删 B 客户的日志 → 403，不碰库，数据不变', async () => {
    asMemberOf(CLIENT_A)

    const res = await del(CLIENT_B, 'log-b1')

    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('本客户成员（client-viewer）删自己客户的日志 → 403 admin_only，不碰库，数据不变', async () => {
    asMemberOf(CLIENT_A)

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.reason).toBe('admin_only')
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('受限管理员删别的客户 → 403，不碰库，数据不变', async () => {
    asScopedAdminOf(CLIENT_A)

    const res = await del(CLIENT_B, 'log-b1')

    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('全局管理员删本客户日志 → 204，只剩 log-b1', async () => {
    asGlobalAdmin()

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(204)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual([seed()[1]])
  })

  it('受限管理员删自己客户的日志 → 204', async () => {
    asScopedAdminOf(CLIENT_A)

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(204)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual([seed()[1]])
  })

  it('logId 属于别的客户：全局管理员 → 404，数据不变', async () => {
    asGlobalAdmin()

    const res = await del(CLIENT_A, 'log-b1')

    expect(res.status).toBe(404)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('logId 属于别的客户：本客户受限管理员 → 404，数据不变', async () => {
    asScopedAdminOf(CLIENT_A)

    const res = await del(CLIENT_A, 'log-b1')

    expect(res.status).toBe(404)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('logId 不存在 → 404，数据不变', async () => {
    asGlobalAdmin()

    const res = await del(CLIENT_A, 'log-does-not-exist')

    expect(res.status).toBe(404)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('数据库报错 → 500，body.error 为 work_logs_delete_failed，且不泄露内部细节', async () => {
    asGlobalAdmin()
    db.state.fail = true

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(500)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    const body = await res.json()
    expect(body.error).toBe('work_logs_delete_failed')
    expect(JSON.stringify(body)).not.toContain('SECRET_DB_DETAIL')
  })

  it.each(NON_ADMIN_TIERS)('%s 档成员删自己客户的日志 → 403 admin_only，不碰库，数据不变', async (tier) => {
    asTierOf(CLIENT_A, tier)

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.reason).toBe('admin_only')
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('管理员身份但会话没有邮箱 → 403 missing_email，不碰库，数据不变', async () => {
    asAdminWithoutEmail()

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.reason).toBe('missing_email')
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('守卫查库失败 → 500 lookup_failed，不碰库，数据不变', async () => {
    asLookupFailed()

    const res = await del(CLIENT_A, 'log-a1')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.reason).toBe('lookup_failed')
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })
})
