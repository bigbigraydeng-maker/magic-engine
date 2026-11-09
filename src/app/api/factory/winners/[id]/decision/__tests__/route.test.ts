/**
 * POST /api/factory/winners/[id]/decision 的拒绝分支：
 * 坏参数、赢家不存在、没登录的人、只认 PM 时的员工、受限管理员 / 演示账号、不是该客户员工的人。
 * 通过的路径（全局管理员 / 该客户员工）也各走一遍，证明闸门不是一刀全拒。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Tables } from '@/lib/kernel/__tests__/fake-supabase'

const ID = '86948d4f-69db-426a-a68d-0f19a6058f96'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const STAMP = '2026-11-04T07:48:49.640Z'

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  admin: { ok: false } as { ok: boolean; email?: string },
  paid: { ok: false } as { ok: boolean; role?: string; email?: string; status?: number },
  fake: null as unknown,
}))

vi.mock('@/lib/supabase', () => ({
  get supabaseAdmin() {
    return h.fake
  },
}))
vi.mock('@/lib/auth/require-admin', () => ({
  requireGlobalAdmin: async () =>
    h.admin.ok ? { ok: true, user: { email: h.admin.email } } : { ok: false, status: 403, error: 'Forbidden' },
}))
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: async () =>
    h.paid.ok
      ? { ok: true, role: h.paid.role, user: { email: h.paid.email } }
      : { ok: false, status: h.paid.status ?? 403, error: 'Forbidden' },
}))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: async () => ({ event_ids: ['e'] }) }))

import { POST } from '../route'

function seed(factoryConfig: Record<string, unknown> = {}): Tables {
  return {
    clients: [{ id: CLIENT, factory_config: factoryConfig }],
    client_portal_users: [{ client_id: CLIENT, email: 'lisa@ctstours.co.nz', access_type: 'client', scoped_admin: false }],
    winner_structures: [
      {
        id: ID, client_id: CLIENT, status: 'active', hook_segment: {}, middle_segment: {}, cta_segment: {},
        win_reason_tags: [], cost_per_thruplay: null, current_frequency: null, updated_at: STAMP,
        performance: { program_check: { state: 'passed', at: STAMP }, cost_per_result: 4.57, result_type: 'lead' },
      },
    ],
  }
}

const call = (id: string, body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: { id } })

function use(tables: Tables) {
  h.tables = tables
  h.fake = createFakeSupabase(tables)
}

beforeEach(() => {
  h.admin = { ok: false }
  h.paid = { ok: false }
  use(seed())
})

describe('参数与对象', () => {
  it('id 不是 uuid → 400', async () => {
    expect((await call('nope', { decision: 'approved' })).status).toBe(400)
  })
  it('请求体不是 JSON / decision 不合法 → 400', async () => {
    expect((await call(ID, 'not json')).status).toBe(400)
    expect((await call(ID, { decision: 'maybe' })).status).toBe(400)
  })
  it('赢家不存在 → 404', async () => {
    h.tables.winner_structures.length = 0
    expect((await call(ID, { decision: 'approved' })).status).toBe(404)
  })
})

describe('谁能点', () => {
  it('没登录 / 没权限 → 403（不写）', async () => {
    const res = await call(ID, { decision: 'approved' })
    expect(res.status).toBe(403)
    expect((h.tables.winner_structures[0].performance as Record<string, unknown>).pm_decision).toBeUndefined()
  })
  it('受限管理员 / 演示账号（role=admin 但不是全局管理员）→ 403', async () => {
    h.paid = { ok: true, role: 'admin', email: 'demo@magiclab.nz' }
    const res = await call(ID, { decision: 'approved' })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toContain('受限管理员')
  })
  it('登录了但不是该客户员工 → 403', async () => {
    h.paid = { ok: true, role: 'client-viewer', email: 'stranger@example.com' }
    expect((await call(ID, { decision: 'approved' })).status).toBe(403)
  })
  it('只认 PM 的客户：员工 → 403', async () => {
    use(seed({ winner_confirm_pm_only: true }))
    h.paid = { ok: true, role: 'client-viewer', email: 'lisa@ctstours.co.nz' }
    expect((await call(ID, { decision: 'approved' })).status).toBe(403)
  })
  it('赢家行带只认 PM 标记（配置开关没写上）：员工同样 403', async () => {
    const t = seed()
    ;(t.winner_structures[0].performance as Record<string, unknown>).pm_only_required = { by: 'pm@magiclab.nz', at: STAMP }
    use(t)
    h.paid = { ok: true, role: 'client-viewer', email: 'lisa@ctstours.co.nz' }
    expect((await call(ID, { decision: 'approved' })).status).toBe(403)
  })
})

describe('放行的两条路', () => {
  it('该客户员工 → 200，记成 client_staff', async () => {
    h.paid = { ok: true, role: 'client-viewer', email: 'Lisa@CTSTours.co.nz' }
    const res = await call(ID, { decision: 'approved' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { receipt: { role: string } }).receipt.role).toBe('client_staff')
  })
  it('全局管理员 → 200，记成 magic_lab；只认 PM 的客户也能点', async () => {
    use(seed({ winner_confirm_pm_only: true }))
    h.admin = { ok: true, email: 'pm@magiclab.nz' }
    const res = await call(ID, { decision: 'approved' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { receipt: { role: string } }).receipt.role).toBe('magic_lab')
  })
})
