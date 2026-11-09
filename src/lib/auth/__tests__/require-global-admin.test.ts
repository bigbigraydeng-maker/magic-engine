/**
 * requireGlobalAdmin — 「内部员工」的唯一判据（AD-SEC-3 起用于广告账户绑定）。
 * guardGlobalAdmin 改为复用它，这里同时钉住原有返回不变。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ email: null as string | null }))
vi.mock('../require-session', () => ({
  requireSession: async () =>
    h.email ? { ok: true, user: { id: 'u', email: h.email } } : { ok: false, status: 401, error: 'Unauthorized' },
}))

import { requireGlobalAdmin, guardGlobalAdmin } from '../require-admin'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}
const CLIENT = 'aaaaaaaa-0000-0000-0000-000000000001'

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.ADMIN_EMAIL_DOMAIN = 'staff.magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT}`
  process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT}`
})
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('requireGlobalAdmin', () => {
  it.each(['fde@magiclab.test', 'someone@staff.magiclab.test'])('%s（ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN）→ ok，带回 user', async email => {
    h.email = email
    const r = await requireGlobalAdmin()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.user.email).toBe(email)
  })

  it.each([
    ['DEMO_ADMINS 受限管理员', 'demo@x.test'],
    ['CLIENT_VIEWERS', 'viewer@x.test'],
    ['不在任何白名单', 'stranger@x.test'],
  ])('%s → 403', async (_l, email) => {
    h.email = email
    expect(await requireGlobalAdmin()).toMatchObject({ ok: false, status: 403 })
  })

  it('没登录 → 401', async () => {
    h.email = null
    expect(await requireGlobalAdmin()).toMatchObject({ ok: false, status: 401 })
  })
})

describe('guardGlobalAdmin — 行为不变', () => {
  it('全局 admin → null', async () => {
    h.email = 'fde@magiclab.test'
    expect(await guardGlobalAdmin()).toBeNull()
  })

  it('受限管理员 → 403 且保留原提示', async () => {
    h.email = 'demo@x.test'
    const res = await guardGlobalAdmin()
    expect(res?.status).toBe(403)
    expect((await res?.json()).error).toContain('scoped admins cannot use it')
  })
})
