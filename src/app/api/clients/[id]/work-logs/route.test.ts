import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
import { GET, POST } from './route'

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

function getReq(id: string) {
  return new NextRequest(`http://localhost:3001/api/clients/${id}/work-logs`)
}

function postReq(id: string, body: unknown) {
  return new NextRequest(`http://localhost:3001/api/clients/${id}/work-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/clients/[id]/work-logs', () => {
  it('未登录 → 401，且不碰数据库', async () => {
    asAnonymous()
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(401)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('A 客户成员请求 B 客户 → 403，且不碰数据库', async () => {
    asMemberOf(CLIENT_A)
    const res = await GET(getReq(CLIENT_B), { params: { id: CLIENT_B } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('本客户成员（client-viewer）读自己这份 → 403 admin_only，且不碰数据库', async () => {
    asMemberOf(CLIENT_A)
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('admin_only')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
    expect(JSON.stringify(body)).not.toContain('A one')
    expect(JSON.stringify(body)).not.toContain('fde@magicengine.example')
  })

  it('全局管理员 → 200，canWrite true，带 author_email，且只返回本客户的行', async () => {
    asGlobalAdmin()
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(200)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.canWrite).toBe(true)
    expect(body.logs).toHaveLength(1)
    expect(body.logs[0].id).toBe('log-a1')
    expect(body.logs[0].author_email).toBe('fde@magicengine.example')
    expect(JSON.stringify(body)).not.toContain('log-b1')
  })

  it('受限管理员请求别的客户 → 403，且不碰数据库', async () => {
    asScopedAdminOf(CLIENT_A)
    const res = await GET(getReq(CLIENT_B), { params: { id: CLIENT_B } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('受限管理员请求自己的客户 → 200，canWrite true', async () => {
    asScopedAdminOf(CLIENT_A)
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(200)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.canWrite).toBe(true)
    expect(body.logs).toHaveLength(1)
    expect(body.logs[0].id).toBe('log-a1')
  })

  it('数据库报错 → 500，且不泄露数据库原文', async () => {
    asGlobalAdmin()
    db.state.fail = true
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(500)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.error).toBe('work_logs_read_failed')
    expect(JSON.stringify(body)).not.toContain('SECRET_DB_DETAIL')
  })

  it.each(NON_ADMIN_TIERS)('%s 档成员读自己这份 → 403 admin_only，且不碰数据库', async (tier) => {
    asTierOf(CLIENT_A, tier)
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('admin_only')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
    expect(JSON.stringify(body)).not.toContain('A one')
    expect(JSON.stringify(body)).not.toContain('fde@magicengine.example')
  })

  it('管理员身份但会话没有邮箱 → 403，reason missing_email，且不碰数据库', async () => {
    asAdminWithoutEmail()
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('missing_email')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('守卫查库失败 → 500，reason lookup_failed，且不碰数据库', async () => {
    asLookupFailed()
    const res = await GET(getReq(CLIENT_A), { params: { id: CLIENT_A } })
    expect(res.status).toBe(500)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('lookup_failed')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })
})

describe('POST /api/clients/[id]/work-logs', () => {
  it('未登录 → 401，且不碰数据库', async () => {
    asAnonymous()
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(401)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('A 客户成员写 B 客户 → 403，且不碰数据库', async () => {
    asMemberOf(CLIENT_A)
    const res = await POST(postReq(CLIENT_B, { summary: 'hello' }), { params: { id: CLIENT_B } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('本客户成员（client-viewer）写自己的客户 → 403 admin_only，且不碰数据库', async () => {
    asMemberOf(CLIENT_A)
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('admin_only')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('受限管理员写别的客户 → 403，且不碰数据库', async () => {
    asScopedAdminOf(CLIENT_A)
    const res = await POST(postReq(CLIENT_B, { summary: 'hello' }), { params: { id: CLIENT_B } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('全局管理员 → 201，写入本客户的行，summary 去空格、邮箱小写、log_date 采用请求值', async () => {
    asGlobalAdmin('Ray@MagicEngine.example')
    const res = await POST(
      postReq(CLIENT_A, { summary: '  hello  ', log_date: '2026-10-01' }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(201)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    expect(db.state.rows).toHaveLength(3)
    const created = db.state.rows[2]
    expect(created.client_id).toBe(CLIENT_A)
    expect(created.summary).toBe('hello')
    expect(created.author_email).toBe('ray@magicengine.example')
    expect(created.log_date).toBe('2026-10-01')
  })

  it('受限管理员写自己的客户 → 201', async () => {
    asScopedAdminOf(CLIENT_A)
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(201)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    expect(db.state.rows).toHaveLength(3)
    expect(db.state.rows[2].client_id).toBe(CLIENT_A)
  })

  it('管理员但会话没有邮箱 → 403 missing_email，且不碰数据库', async () => {
    mockAccess.mockResolvedValue({
      ok: true, user: {} as never, role: 'admin', tier: 'admin', allowedClientId: null,
    })
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('missing_email')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('summary 为空 → 400，且不碰数据库', async () => {
    asGlobalAdmin()
    const res = await POST(postReq(CLIENT_A, { summary: '   ' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('log_date 格式不对 → 400，且不碰数据库', async () => {
    asGlobalAdmin()
    const res = await POST(
      postReq(CLIENT_A, { summary: 'hello', log_date: '10/01/2026' }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('请求体夹带 client_id / author_email 被忽略 → 201，写入本客户与会话邮箱', async () => {
    asGlobalAdmin('ray@magicengine.example')
    const res = await POST(
      postReq(CLIENT_A, { summary: 'hello', client_id: CLIENT_B, author_email: 'evil@x.example' }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(201)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    expect(db.state.rows).toHaveLength(3)
    const created = db.state.rows[2]
    expect(created.client_id).toBe(CLIENT_A)
    expect(created.author_email).toBe('ray@magicengine.example')
  })

  it('数据库报错 → 500，且不泄露数据库原文', async () => {
    asGlobalAdmin()
    db.state.fail = true
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(500)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.error).toBe('work_logs_write_failed')
    expect(JSON.stringify(body)).not.toContain('SECRET_DB_DETAIL')
  })

  it.each(NON_ADMIN_TIERS)('%s 档成员写自己的客户 → 403 admin_only，不碰库', async (tier) => {
    asTierOf(CLIENT_A, tier)
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(403)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('admin_only')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })

  it('log_date 形状对但不是真实日期（2026-13-45）→ 400，数据不变', async () => {
    asGlobalAdmin()
    const res = await POST(
      postReq(CLIENT_A, { summary: 'hello', log_date: '2026-13-45' }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('log_date 2026-02-30 → 400，数据不变', async () => {
    asGlobalAdmin()
    const res = await POST(
      postReq(CLIENT_A, { summary: 'hello', log_date: '2026-02-30' }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('请求体是 JSON null → 400 summary required，数据不变', async () => {
    asGlobalAdmin()
    const req = new NextRequest(`http://localhost:3001/api/clients/${CLIENT_A}/work-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    const res = await POST(req, { params: { id: CLIENT_A } })
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.error).toBe('summary required')
    expect(db.state.rows).toEqual(seed())
  })

  it('summary 超过 5000 字 → 400，数据不变', async () => {
    asGlobalAdmin()
    const res = await POST(
      postReq(CLIENT_A, { summary: 'x'.repeat(5001) }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('summary 不是字符串 → 400，数据不变', async () => {
    asGlobalAdmin()
    const res = await POST(
      postReq(CLIENT_A, { summary: 123 }),
      { params: { id: CLIENT_A } },
    )
    expect(res.status).toBe(400)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
    expect(db.state.rows).toEqual(seed())
  })

  it('守卫查库失败 → 500，reason lookup_failed，且不碰数据库', async () => {
    asLookupFailed()
    const res = await POST(postReq(CLIENT_A, { summary: 'hello' }), { params: { id: CLIENT_A } })
    expect(res.status).toBe(500)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)

    const body = await res.json()
    expect(body.reason).toBe('lookup_failed')
    expect(db.state.touched).toBe(0)
    expect(db.state.rows).toEqual(seed())
  })
})

// 防回潮：PM 2026-10-11「先关」后，客户页面不得再直接读这张表。重新开放时连同这条一起改。
describe('客户侧页面不读 fde_work_logs', () => {
  it('旧门户首页源码里没有 fde_work_logs', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/portal/[clientId]/page.tsx'), 'utf8')
    expect(src).not.toMatch(/from\(\s*['"]fde_work_logs['"]\s*\)/)
  })
})
