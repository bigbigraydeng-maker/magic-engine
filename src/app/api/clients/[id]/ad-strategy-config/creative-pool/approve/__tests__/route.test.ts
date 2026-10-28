/**
 * 素材池"批准"接口 —— 谁能批、批什么。
 *
 * approved_by 必须由服务端从会话派生，绝不接受客户端传入（2026-08-04 事故规则）。
 * 测试盯的是：
 *   - 内部员工 POST { ref } → 写库，approved_by 来自会话、approved_at 是合法 ISO
 *   - body 里夹带 approved_by → 400，不写库
 *   - ref 不在池里 → 404
 *   - 已批准的 ref → 200 且 idempotent，不写库
 *   - 付费客户门户成员 / 未登录 → 403 / 401，不写库
 *
 * 用真的 requireGlobalAdmin + 真的白名单（只假登录态和 env），
 * 这样「去掉守卫」或「守卫放行受限管理员」都会让用例红。
 *
 * 假 supabase 按表建模：只认 ad_strategy_configs，一张按 client_id 存行的内存表；
 * 读回走真实的 loadAdStrategyConfig。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/email/sender', () => ({ ME_MAIL_TO_ADDRESS: 'team@example.com' }))
vi.mock('@/lib/ads-strategy/plan-to-draft', () => ({
  assemblePausedDraftsForClient: vi.fn(async () => ({ steps: [] })),
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'client-uuid-creative-pool-approve-test'
const STAFF = 'fde@staff.test'
const VIEWER = 'bdm@client.test'
const DEMO = 'demo@staff.test'
// A paid portal member passes requirePaidClientAccess but is on no env whitelist.
// (Self-serve users are already stopped earlier by requirePaidClientAccess.)
const PORTAL_MEMBER = 'owner@client.test'

type Row = Record<string, unknown>

function fakeTable(initial: Row[] = [], onSelect?: (nth: number) => void) {
  let selectCount = 0
  const selects: string[] = []
  const rows = new Map<string, Row>(initial.map(r => [String(r.client_id), r]))
  const upsert = vi.fn(async (row: Row, opts: { onConflict: string }) => {
    const key = String(row[opts.onConflict])
    rows.set(key, { ...(rows.get(key) ?? {}), ...row })
    return { error: null }
  })
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
    return {
      select: (cols?: string) => {
        selectCount += 1
        selects.push(cols ?? '*')
        onSelect?.(selectCount)
        return {
          eq: (col: string, val: string) => ({
            maybeSingle: async () => ({
              data: [...rows.values()].find(r => r[col] === val) ?? null,
              error: null,
            }),
          }),
        }
      },
      upsert,
      // 乐观锁写法（writeConfigCas）：update().eq().eq()/is().select() 与 insert()
      update: (row: Row) => {
        const filters: Array<(r: Row) => boolean> = []
        const chain = {
          eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return chain },
          is: (col: string, val: unknown) => { filters.push(r => (r[col] ?? null) === val); return chain },
          select: async () => {
            const hit = [...rows.values()].filter(r => filters.every(f => f(r)))
            for (const r of hit) await upsert({ ...r, ...row }, { onConflict: 'client_id' })
            return { data: hit.map(r => ({ client_id: r.client_id })), error: null }
          },
        }
        return chain
      },
      insert: async (row: Row) => {
        if (rows.has(String(row.client_id))) return { error: { code: '23505', message: 'duplicate key' } }
        await upsert(row, { onConflict: 'client_id' })
        return { error: null }
      },
    }
  }) as never)
  return { rows, upsert, selects }
}

function params() {
  return { params: { id: CLIENT } }
}

function url() {
  return `http://localhost:3001/api/clients/${CLIENT}/ad-strategy-config/creative-pool/approve`
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(url(), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 访问闸放行（付费客户成员都过得去），登录态是 email 这个人。 */
function signedInAs(email: string) {
  mockAccess.mockResolvedValue({ ok: true, user: { email } as never } as never)
  mockSession.mockResolvedValue({ ok: true, user: { email } as never })
}

const SEED_POOL = [
  { kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'dated', start: '2026-01-01', end: '2099-12-31' } },
  { kind: 'work_order', ref: 'wo-9', status: 'approved', approved_by: 'earlier@staff.test', approved_at: '2026-09-01T00:00:00.000Z' },
]

function seedRow(): Row {
  return { client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: SEED_POOL }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T00:00:00.000Z'))
  vi.stubEnv('ADMIN_EMAILS', STAFF)
  vi.stubEnv('ADMIN_EMAIL_DOMAIN', '')
  vi.stubEnv('CLIENT_VIEWERS', `${VIEWER}:${CLIENT}`)
  vi.stubEnv('DEMO_ADMINS', `${DEMO}:${CLIENT}`)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('creative-pool/approve — 内部员工批准', () => {
  it('POST { ref } → 200，approved_by 来自会话、approved_at 合法 ISO，其它条目原样保留', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.status).toBe('approved')
    expect(v1.approved_by).toBe(STAFF)
    expect(typeof v1.approved_at).toBe('string')
    expect(Number.isNaN(Date.parse(v1.approved_at as string))).toBe(false)
    const wo9 = pool.find(e => e.ref === 'wo-9')!
    expect(wo9).toEqual(SEED_POOL[1])
    expect(json.config.creative_pool.find((e: { ref: string }) => e.ref === 'v1').status).toBe('approved')
  })

  it('body 夹带 approved_by → 400 only ref is accepted，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1', approved_by: 'attacker@x' }), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('only ref is accepted')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('ref 不在池里 → 404，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'nope' }), params())

    expect(res.status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('已批准的 ref → 200 且 idempotent，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'wo-9' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.idempotent).toBe(true)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('creative-pool/approve — 非内部员工批不动', () => {
  it('付费客户门户成员 → 403，不写库', async () => {
    signedInAs(PORTAL_MEMBER)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1' }), params())

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('没登录 → 401，不写库', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: STAFF } as never } as never)
    mockSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1' }), params())

    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('creative-pool/approve — 自动流程状态不能手动批准', () => {
  it.each(['pending_qc', 'test_queue', 'testing', 'scaling', 'rejected', 'inconclusive', 'retired', 'manual_approved'])(
    'status=%s → 409 status_not_approvable，不写库',
    async status => {
      signedInAs(STAFF)
      const { upsert } = fakeTable([{
        client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
          { kind: 'meta_video', ref: 'v1', status, promo_window: { kind: 'evergreen' } },
        ],
      }])

      const res = await POST(postRequest({ ref: 'v1' }), params())
      const json = await res.json()

      expect(res.status).toBe(409)
      expect(json.error).toBe('status_not_approvable')
      expect(upsert).not.toHaveBeenCalled()
    },
  )
})

describe('creative-pool/approve — 推广期闸', () => {
  function seedWith(entry: Record<string, unknown>): Row {
    return { client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [entry] }
  }

  it('条目没有 promo_window → 422 promo_window_undeclared，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedWith({ kind: 'meta_video', ref: 'v1', status: 'candidate' })])

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toBe('promo_window_undeclared')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('条目推广期已过 → 422 promo_window_expired，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([
      seedWith({
        kind: 'meta_video',
        ref: 'v1',
        status: 'candidate',
        promo_window: { kind: 'dated', start: '2020-01-01', end: '2020-12-31' },
      }),
    ])

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toBe('promo_window_expired')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('条目 evergreen → 200，写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([
      seedWith({ kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } }),
    ])

    const res = await POST(postRequest({ ref: 'v1' }), params())

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('条目 dated 且 start 在未来 → 200（未开始允许批准）', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([
      seedWith({
        kind: 'meta_video',
        ref: 'v1',
        status: 'candidate',
        promo_window: { kind: 'dated', start: '2099-01-01', end: '2099-12-31' },
      }),
    ])

    const res = await POST(postRequest({ ref: 'v1' }), params())

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('已批准的条目即使没有 promo_window → 200 idempotent，不写库（存量不被误伤）', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([
      seedWith({ kind: 'meta_video', ref: 'v1', status: 'approved', approved_by: 'earlier@staff.test', approved_at: '2026-09-01T00:00:00.000Z' }),
    ])

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.idempotent).toBe(true)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('creative-pool/approve — 日期边界与并发（固定时钟）', () => {
  it('推广期 end = 今天（新西兰日期）→ 还能批准；end = 昨天 → 422，且带中文说明', async () => {
    signedInAs(STAFF)
    const ok = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
      { kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'dated', start: '2026-10-01', end: '2026-10-21' } },
    ] }])
    const res = await POST(postRequest({ ref: 'v1' }), params())
    expect(res.status).toBe(200)
    expect(ok.upsert).toHaveBeenCalledTimes(1)

    const late = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
      { kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'dated', start: '2026-10-01', end: '2026-10-20' } },
    ] }])
    const rejected = await POST(postRequest({ ref: 'v1' }), params())
    const json = await rejected.json()
    expect(rejected.status).toBe(422)
    expect(json.error).toBe('promo_window_expired')
    expect(String(json.message)).toContain('推广期')
    expect(late.upsert).not.toHaveBeenCalled()
  })

  it('读完版本之后有人改了设置行 → 409，不覆盖', async () => {
    signedInAs(STAFF)
    const table = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
      { kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } },
    ] }], nth => {
      if (nth === 2) table.rows.get(CLIENT)!.updated_at = '2026-10-21T00:00:01.000Z'
    })
    const { upsert } = table
    const res = await POST(postRequest({ ref: 'v1' }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('creative_pool_changed_concurrently')
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('creative-pool/approve — 幂等分支的版本与读取顺序', () => {
  it('已批准：响应里的 version 等于种子行的 updated_at，且先读版本再读内容', async () => {
    signedInAs(STAFF)
    const { selects } = fakeTable([
      { client_id: CLIENT, enabled: true, digest_recipients: [], updated_at: '2026-10-20T00:00:00.000Z', creative_pool: [
        { kind: 'work_order', ref: 'wo-9', status: 'approved', approved_by: 'earlier@staff.test', approved_at: '2026-09-01T00:00:00.000Z' },
      ] },
    ])

    const res = await POST(postRequest({ ref: 'wo-9' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.idempotent).toBe(true)
    expect(json.version).toBe('2026-10-20T00:00:00.000Z')
    expect(selects[0]).toBe('updated_at')
  })
})

describe('creative-pool/approve — 写入成功后读回内容失败', () => {
  it('写入成功但读回内容失败 → 200，version_unreadable=true，无 version 键', async () => {
    signedInAs(STAFF)
    // 写入之前：读版本（updated_at）、读内容（config）。写入之后：读版本成功、读内容失败。
    // 用 select 的列名区分：updated_at 永远成功；内容列在写入之后（第 2 次及以后）失败。
    let contentSelects = 0
    const rows = new Map<string, Row>([[CLIENT, {
      client_id: CLIENT, enabled: true, digest_recipients: [], updated_at: '2026-10-20T00:00:00.000Z',
      creative_pool: [
        { kind: 'meta_video', ref: 'v1', status: 'candidate', promo_window: { kind: 'evergreen' } },
      ],
    }]])
    const upsert = vi.fn(async (row: Row, opts: { onConflict: string }) => {
      const key = String(row[opts.onConflict])
      rows.set(key, { ...(rows.get(key) ?? {}), ...row })
      return { error: null }
    })
    mockFrom.mockImplementation(((table: string) => {
      if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
      return {
        select: (cols?: string) => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              if (cols === 'updated_at') {
                const row = [...rows.values()].find(r => r[col] === val)
                return { data: row ? { updated_at: row.updated_at } : null, error: null }
              }
              contentSelects += 1
              // 第 1 次内容读 = 写入之前的 config；第 2 次 = 写入之后的读回 → 失败。
              if (contentSelects >= 2) {
                return { data: null, error: { message: 'timeout' } }
              }
              const row = [...rows.values()].find(r => r[col] === val)
              return { data: row ?? null, error: null }
            },
          }),
        }),
        upsert,
        update: (row: Row) => {
          const filters: Array<(r: Row) => boolean> = []
          const chain = {
            eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return chain },
            is: (col: string, val: unknown) => { filters.push(r => (r[col] ?? null) === val); return chain },
            select: async () => {
              const hit = [...rows.values()].filter(r => filters.every(f => f(r)))
              for (const r of hit) await upsert({ ...r, ...row }, { onConflict: 'client_id' })
              return { data: hit.map(r => ({ client_id: r.client_id })), error: null }
            },
          }
          return chain
        },
        insert: async (row: Row) => {
          if (rows.has(String(row.client_id))) return { error: { code: '23505', message: 'duplicate key' } }
          await upsert(row, { onConflict: 'client_id' })
          return { error: null }
        },
      }
    }) as never)

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.version_unreadable).toBe(true)
    expect(json).not.toHaveProperty('version')
  })
})
