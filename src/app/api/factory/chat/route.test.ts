/**
 * POST /api/factory/chat — 客户范围校验。
 *
 * 钉住：限定客户的管理员（DEMO_ADMINS）只能对自己客户的 client_id 用对话助手；
 * 越界必须在 clients 名字查询和 chatWithFactory 之前就 403。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  email: null as string | null,
  tables: [] as string[],
  chatWithFactory: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email === null
      ? { ok: false, status: 401, error: 'Unauthorized' }
      : { ok: true, user: { id: 'u', email: h.email } },
}))

vi.mock('@/lib/factory/chat', () => ({
  chatWithFactory: h.chatWithFactory,
}))

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: { name: 'Client A' }, error: null }),
  }
  return {
    supabaseAdmin: {
      from: (table: string) => {
        h.tables.push(table)
        return chain
      },
    },
  }
})

import { POST } from './route'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}
const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT_A}`
  h.email = null
  h.tables.length = 0
  h.chatWithFactory.mockReset()
  h.chatWithFactory.mockResolvedValue({ text: 'hi', tool_calls: [] })
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function call(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
  )
}

describe('POST /api/factory/chat — scope', () => {
  it('全局 admin 可以问任意客户', async () => {
    h.email = 'fde@magiclab.test'
    const res = await call({ client_id: CLIENT_B, message: 'hello' })
    expect(res.status).toBe(200)
    expect(h.chatWithFactory).toHaveBeenCalledTimes(1)
  })

  it('限定客户的管理员问别的客户 → 403，且不查 clients、不调 chatWithFactory', async () => {
    h.email = 'demo@x.test'
    const res = await call({ client_id: CLIENT_B, message: 'hello' })
    expect(res.status).toBe(403)
    expect(h.chatWithFactory).not.toHaveBeenCalled()
    expect(h.tables).toEqual([])
  })

  it('限定客户的管理员问自己的客户 → 200，chatWithFactory 收到 CLIENT_A', async () => {
    h.email = 'demo@x.test'
    const res = await call({ client_id: CLIENT_A, message: 'hello' })
    expect(res.status).toBe(200)
    expect(h.chatWithFactory).toHaveBeenCalledTimes(1)
    expect(h.chatWithFactory.mock.calls[0][1]).toBe(CLIENT_A)
  })

  it('邮箱大小写/空白与 client_id 大小写都不影响匹配', async () => {
    h.email = '  Demo@X.TEST '
    const res = await call({ client_id: CLIENT_A.toUpperCase(), message: 'hello' })
    expect(res.status).toBe(200)
    expect(h.chatWithFactory).toHaveBeenCalledTimes(1)
  })

  it('没登录 → 401，什么都不调', async () => {
    h.email = null
    const res = await call({ client_id: CLIENT_A, message: 'hello' })
    expect(res.status).toBe(401)
    expect(h.chatWithFactory).not.toHaveBeenCalled()
    expect(h.tables).toEqual([])
  })

  it.each(['viewer@x.test', 'stranger@x.test'])('非管理员 %s → 403，什么都不调', async email => {
    h.email = email
    const res = await call({ client_id: CLIENT_A, message: 'hello' })
    expect(res.status).toBe(403)
    expect(h.chatWithFactory).not.toHaveBeenCalled()
    expect(h.tables).toEqual([])
  })

  it('session 邮箱为空 → 403，什么都不调', async () => {
    h.email = ''
    const res = await call({ client_id: CLIENT_A, message: 'hello' })
    expect(res.status).toBe(403)
    expect(h.chatWithFactory).not.toHaveBeenCalled()
    expect(h.tables).toEqual([])
  })

  it('client_id 不是 uuid → 400', async () => {
    h.email = 'fde@magiclab.test'
    const res = await call({ client_id: 'nope', message: 'hello' })
    expect(res.status).toBe(400)
    expect(h.chatWithFactory).not.toHaveBeenCalled()
  })

  it('message 为空 → 400', async () => {
    h.email = 'fde@magiclab.test'
    const res = await call({ client_id: CLIENT_A, message: '   ' })
    expect(res.status).toBe(400)
    expect(h.chatWithFactory).not.toHaveBeenCalled()
  })
})
