import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ email: null as string | null }))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email === null
      ? { ok: false, status: 401, error: 'Unauthorized' }
      : { ok: true, user: { id: 'u', email: h.email } },
}))

const db = vi.hoisted(() => ({
  tables: [] as string[],
  updates: [] as unknown[],
  loadResult: { data: null as unknown, error: null as unknown },
  updateResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    update: (arg: unknown) => {
      db.updates.push(arg)
      return chain
    },
    maybeSingle: () => Promise.resolve(db.loadResult),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(db.updateResult).then(resolve, reject),
  }
  return {
    supabaseAdmin: {
      from: (table: string) => {
        db.tables.push(table)
        return chain
      },
    },
  }
})

import { POST } from './route'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}
const CLIENT = 'aaaaaaaa-0000-0000-0000-000000000001'

function callPost() {
  return POST(new Request('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ id: 'wo-1' }),
  })
}

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT}`

  h.email = null
  db.tables.length = 0
  db.updates.length = 0
  db.loadResult = { data: null, error: null }
  db.updateResult = { data: [{ id: 'wo-1' }], error: null }
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('POST /api/factory/work-orders/[id]/revive', () => {
  it('revives a dead_letter order for a global admin', async () => {
    h.email = 'fde@magiclab.test'
    db.loadResult = {
      data: { id: 'wo-1', status: 'dead_letter', reclaim_count: 1, reject_reason: 'r' },
      error: null,
    }

    const res = await callPost()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, status: 'queued' })
    expect(db.updates.length).toBe(1)
    expect((db.updates[0] as { status: string }).status).toBe('queued')
  })

  it('refuses a client-scoped admin with 403 and never touches the database', async () => {
    h.email = 'demo@x.test'

    const res = await callPost()

    expect(res.status).toBe(403)
    expect(db.tables).toEqual([])
    expect(db.updates).toEqual([])
  })

  it('returns 401 without a session and never touches the database', async () => {
    h.email = null

    const res = await callPost()

    expect(res.status).toBe(401)
    expect(db.tables).toEqual([])
  })

  it('refuses a logged-in non-admin with 403 and never touches the database', async () => {
    h.email = 'stranger@x.test'

    const res = await callPost()

    expect(res.status).toBe(403)
    expect(db.tables).toEqual([])
  })

  it('refuses a session with an empty email with 403 and never touches the database', async () => {
    // ADMIN_EMAILS 末尾多一个逗号：getUserPermissions('') 会把没有邮箱的登录当成全局管理员，守卫必须自己拦住
    process.env.ADMIN_EMAILS = 'fde@magiclab.test,'
    h.email = ''

    const res = await callPost()

    expect(res.status).toBe(403)
    expect(db.tables).toEqual([])
  })

  it('rejects a work order that is not dead_letter with 409 and does not update', async () => {
    h.email = 'fde@magiclab.test'
    db.loadResult = {
      data: { id: 'wo-1', status: 'approved', reclaim_count: 0, reject_reason: null },
      error: null,
    }

    const res = await callPost()

    expect(res.status).toBe(409)
    expect(db.updates).toEqual([])
  })

  it('does not retry a recipe order until its production plan has been rebuilt', async () => {
    h.email = 'fde@magiclab.test'
    db.loadResult = {
      data: { id: 'wo-1', status: 'dead_letter', reclaim_count: 0, reject_reason: 'r', brief: { recipe_replan_required: true } },
      error: null,
    }

    const res = await callPost()

    expect(res.status).toBe(409)
    expect(db.updates).toEqual([])
  })

  it('returns 404 when the work order is missing', async () => {
    h.email = 'fde@magiclab.test'
    db.loadResult = { data: null, error: null }

    const res = await callPost()

    expect(res.status).toBe(404)
  })
})
