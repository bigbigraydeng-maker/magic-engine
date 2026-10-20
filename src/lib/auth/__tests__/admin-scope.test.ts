/**
 * requireAdminScope / scopeAllowsClient — 一次读取同时给出「是不是管理员」和「被限定在哪个客户」。
 * 读不到身份一律拒，不会退成全局管理员。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ email: null as string | null }))
vi.mock('../require-session', () => ({
  requireSession: async () =>
    h.email === null ? { ok: false, status: 401, error: 'Unauthorized' } : { ok: true, user: { id: 'u', email: h.email } },
}))

import { requireAdminScope, scopeAllowsClient } from '../require-admin'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}
const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test,dual@x.test'
  process.env.ADMIN_EMAIL_DOMAIN = 'staff.magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT_A},dual@x.test:${CLIENT_A},upper@x.test:${CLIENT_A.toUpperCase()}`
  process.env.CLIENT_VIEWERS = 'viewer@x.test:' + CLIENT_A
})
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('requireAdminScope', () => {
  it('ADMIN_EMAILS 里的全局管理员 → global，带回 user', async () => {
    h.email = 'fde@magiclab.test'
    const r = await requireAdminScope()
    expect(r).toMatchObject({ ok: true, scope: { kind: 'global' } })
    if (r.ok) expect(r.user.email).toBe('fde@magiclab.test')
  })

  it('ADMIN_EMAIL_DOMAIN 域名匹配 → global', async () => {
    h.email = 'someone@staff.magiclab.test'
    expect(await requireAdminScope()).toMatchObject({ ok: true, scope: { kind: 'global' } })
  })

  it('DEMO_ADMINS 受限管理员 → client scope', async () => {
    h.email = 'demo@x.test'
    expect(await requireAdminScope()).toMatchObject({
      ok: true,
      scope: { kind: 'client', clientId: CLIENT_A },
    })
  })

  it('邮箱带空格和大写 → 同一个 client scope', async () => {
    h.email = '  Demo@X.TEST '
    expect(await requireAdminScope()).toMatchObject({
      ok: true,
      scope: { kind: 'client', clientId: CLIENT_A },
    })
  })

  it('env 里客户 id 是大写 → 返回小写 id', async () => {
    h.email = 'upper@x.test'
    expect(await requireAdminScope()).toMatchObject({
      ok: true,
      scope: { kind: 'client', clientId: CLIENT_A },
    })
  })

  it('同时在 DEMO_ADMINS 和 ADMIN_EMAILS → 取更严格的 client scope', async () => {
    h.email = 'dual@x.test'
    expect(await requireAdminScope()).toMatchObject({
      ok: true,
      scope: { kind: 'client', clientId: CLIENT_A },
    })
  })

  it('CLIENT_VIEWERS → 403', async () => {
    h.email = 'viewer@x.test'
    expect(await requireAdminScope()).toMatchObject({ ok: false, status: 403 })
  })

  it('不在任何白名单（库里 scoped_admin=true 的账号也长这样）→ 403', async () => {
    h.email = 'stranger@x.test'
    expect(await requireAdminScope()).toMatchObject({ ok: false, status: 403 })
  })

  it('没登录 → 401', async () => {
    h.email = null
    expect(await requireAdminScope()).toMatchObject({ ok: false, status: 401 })
  })

  it('空邮箱一律拒（ADMIN_EMAILS 多一个逗号也不退成全局）', async () => {
    process.env.ADMIN_EMAILS = 'fde@magiclab.test,'
    h.email = ''
    expect(await requireAdminScope()).toMatchObject({ ok: false, status: 403 })
    h.email = '   '
    expect(await requireAdminScope()).toMatchObject({ ok: false, status: 403 })
  })
})

describe('scopeAllowsClient', () => {
  it('global scope 放行任意客户', () => {
    const scope = { kind: 'global' } as const
    expect(scopeAllowsClient(scope, CLIENT_A)).toBe(true)
    expect(scopeAllowsClient(scope, CLIENT_B)).toBe(true)
  })

  it('client scope 只放行自己那个客户（大小写 / 空白不敏感）', () => {
    const scope = { kind: 'client', clientId: CLIENT_A } as const
    expect(scopeAllowsClient(scope, CLIENT_A)).toBe(true)
    expect(scopeAllowsClient(scope, ' ' + CLIENT_A.toUpperCase() + ' ')).toBe(true)
    expect(scopeAllowsClient(scope, CLIENT_B)).toBe(false)
    expect(scopeAllowsClient(scope, '')).toBe(false)
  })
})
