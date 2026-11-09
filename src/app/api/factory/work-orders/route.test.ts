import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ email: null as string | null }))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email === null
      ? { ok: false, status: 401, error: 'Unauthorized' }
      : { ok: true, user: { id: 'u', email: h.email } },
}))

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'

const workOrderRow = {
  id: 'wo1',
  client_id: 'c1',
  status: 'in_review',
  template_id: 'postcard',
  music_file: 'jade_river_journey.mp3',
  heartbeat_at: null,
  published_ref: {
    platform: 'facebook',
    page_id: 'PAGE123',
    video_id: 'VID456',
    post_id: 'VID456',
    video_state: 'DRAFT',
    permalink: '/reel/9/',
    published_at: '2024-01-01T00:00:00Z',
    event_ids: ['EVT789'],
    first_comment_id: 'CMT1',
  },
}

const rowForClient = (id: string, clientId: string) => ({
  ...workOrderRow,
  id,
  client_id: clientId,
})

let workOrdersResult: { data: unknown[]; error: { message: string } | null }

const eqCalls: [string, unknown][] = []
const tables: string[] = []

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    tables.push(table)
    const result =
      table === 'content_work_orders'
        ? workOrdersResult
        : {
            data: [
              { id: CLIENT_A, name: 'Client A' },
              { id: CLIENT_B, name: 'Client B' },
            ],
            error: null,
          }
    const queryFilters: Array<[string, unknown, 'eq' | 'in']> = []
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.in = (col: string, values: unknown[]) => {
      queryFilters.push([col, values, 'in'])
      return chain
    }
    chain.eq = (col: string, val: unknown) => {
      eqCalls.push([col, val])
      queryFilters.push([col, val, 'eq'])
      return chain
    }
    chain.then = (resolve: (value: unknown) => unknown) => {
      if (table !== 'content_work_orders') return resolve(result)
      const rows = (result.data as Record<string, unknown>[]).filter((row) =>
        queryFilters.every(([col, val, method]) =>
          method === 'eq' ? row[col] === val : Array.isArray(val) && val.includes(row[col]),
        ),
      )
      return resolve({ data: rows, error: result.error })
    }
    return chain
  }
  return { supabaseAdmin: { from: (table: string) => builder(table) } }
})

import { GET } from './route'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.DEMO_ADMINS = `demo@x.test:${CLIENT_A}`
  process.env.CLIENT_VIEWERS = `viewer@x.test:${CLIENT_A}`

  h.email = 'fde@magiclab.test'

  eqCalls.length = 0
  tables.length = 0

  workOrdersResult = { data: [workOrderRow], error: null }
})

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('GET /api/factory/work-orders', () => {
  it('projects published_ref into a whitelisted view and never leaks raw fields', async () => {
    const res = await GET()
    const json = await res.json()

    expect(json.orders[0].published).toEqual({
      video_state: 'DRAFT',
      permalink: 'https://www.facebook.com/reel/9/',
      published_at: '2024-01-01T00:00:00Z',
      provisional: false,
    })
    expect(json.orders[0]).not.toHaveProperty('published_ref')
    expect(json.orders[0]).toMatchObject({ template_id: 'postcard', music_file: 'jade_river_journey.mp3' })

    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('PAGE123')
    expect(serialized).not.toContain('VID456')
    expect(serialized).not.toContain('EVT789')
    expect(serialized).not.toContain('CMT1')
  })

  it('no longer returns accepted_flags (the "PM accepted" feature was retired)', async () => {
    const res = await GET()
    const json = await res.json()

    expect(json).not.toHaveProperty('accepted_flags_error')
    expect(json.orders[0]).not.toHaveProperty('accepted_flags')
  })

  it('global admin → both clients returned, no client filter applied', async () => {
    workOrdersResult = {
      data: [rowForClient('wo-a', CLIENT_A), rowForClient('wo-b', CLIENT_B)],
      error: null,
    }

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.orders).toHaveLength(2)
    expect(json.orders.map((o: { client_id: string }) => o.client_id)).toEqual([CLIENT_A, CLIENT_B])
    expect(eqCalls).toEqual([['status', 'in_review']])
    expect(json.worker.active_count).toBe(0)
  })

  it('keeps active worker health visible while the inbox only returns in-review orders', async () => {
    workOrdersResult = {
      data: [
        rowForClient('wo-review', CLIENT_A),
        { ...rowForClient('wo-producing', CLIENT_A), status: 'producing', heartbeat_at: '2026-10-23T00:00:00Z' },
        { ...rowForClient('wo-published', CLIENT_B), status: 'published' },
      ],
      error: null,
    }

    const res = await GET()
    const json = await res.json()

    expect(json.orders.map((order: { id: string }) => order.id)).toEqual(['wo-review'])
    expect(json.worker).toEqual({ last_heartbeat_at: '2026-10-23T00:00:00Z', active_count: 1 })
  })

  it('client-scoped admin → only own client rows, filtered in the query', async () => {
    h.email = 'demo@x.test'
    workOrdersResult = {
      data: [rowForClient('wo-a', CLIENT_A), rowForClient('wo-b', CLIENT_B)],
      error: null,
    }

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.orders).toHaveLength(1)
    expect(json.orders[0].client_id).toBe(CLIENT_A)
    expect(json.orders[0].client_name).toBe('Client A')
    expect(eqCalls).toEqual([['status', 'in_review'], ['client_id', CLIENT_A], ['client_id', CLIENT_A]])

    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain(CLIENT_B)
    expect(serialized).not.toContain('Client B')
  })

  it('keeps dead-letter recovery separate from the review inbox and limits it to internal staff', async () => {
    workOrdersResult = { data: [{ ...rowForClient('wo-stuck', CLIENT_A), status: 'dead_letter' }], error: null }
    const res = await GET(new Request('http://localhost/api/factory/work-orders?view=recovery'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.orders).toHaveLength(1)
    expect(eqCalls).toContainEqual(['status', 'dead_letter'])

    h.email = 'demo@x.test'
    const scopedRes = await GET(new Request('http://localhost/api/factory/work-orders?view=recovery'))
    expect(scopedRes.status).toBe(403)
  })

  it('client-scoped admin with capitalised/spaced email → same scoping', async () => {
    h.email = '  Demo@X.TEST '
    workOrdersResult = {
      data: [rowForClient('wo-a', CLIENT_A), rowForClient('wo-b', CLIENT_B)],
      error: null,
    }

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.orders).toHaveLength(1)
    expect(json.orders[0].client_id).toBe(CLIENT_A)
    expect(eqCalls).toEqual([['status', 'in_review'], ['client_id', CLIENT_A], ['client_id', CLIENT_A]])

    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain(CLIENT_B)
    expect(serialized).not.toContain('Client B')
  })

  it('no session → 401 and no database access', async () => {
    h.email = null

    const res = await GET()

    expect(res.status).toBe(401)
    expect(tables).toEqual([])
  })

  it.each([
    ['CLIENT_VIEWERS', 'viewer@x.test'],
    ['not on any whitelist', 'stranger@x.test'],
  ])('logged in but not an admin (%s) → 403 and no database access', async (_label, email) => {
    h.email = email

    const res = await GET()

    expect(res.status).toBe(403)
    expect(tables).toEqual([])
  })

  it('session with an empty email → 403 and no database access', async () => {
    // ADMIN_EMAILS 末尾多一个逗号：getUserPermissions('') 会把没有邮箱的登录当成全局管理员，守卫必须自己拦住
    process.env.ADMIN_EMAILS = 'fde@magiclab.test,'
    h.email = ''

    const res = await GET()

    expect(res.status).toBe(403)
    expect(tables).toEqual([])
  })
})
