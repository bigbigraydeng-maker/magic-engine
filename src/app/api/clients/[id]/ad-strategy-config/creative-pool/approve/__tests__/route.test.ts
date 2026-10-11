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

function fakeTable(initial: Row[] = [], conflict = false) {
  const rows = new Map<string, Row>(initial.map(r => [String(r.client_id), r]))
  const write = vi.fn(async (row: Row, opts: { onConflict: string }) => {
    const key = String(row[opts.onConflict])
    rows.set(key, { ...(rows.get(key) ?? {}), ...row })
    return { error: null }
  })
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
    return {
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => ({
            data: [...rows.values()].find(r => r[col] === val) ?? null,
            error: null,
          }),
        }),
      }),
      update: (patch: Row) => {
        const filters: Array<[string, string]> = []
        const query = {
          eq: (field: string, value: string) => { filters.push([field, value]); return query },
          select: () => query,
          maybeSingle: async () => {
            const matched = [...rows.values()].find(row => filters.every(([field, value]) =>
              typeof row[field] === 'object' ? JSON.stringify(row[field]) === value : row[field] === value))
            if (!matched || conflict) return { data: null, error: null }
            await write({ ...patch, client_id: matched.client_id }, { onConflict: 'client_id' })
            return { data: { client_id: matched.client_id }, error: null }
          },
        }
        return query
      },
    }
  }) as never)
  return { rows, write }
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
  { kind: 'meta_video', ref: 'v1', status: 'candidate' },
  { kind: 'work_order', ref: 'wo-9', status: 'approved', approved_by: 'earlier@staff.test', approved_at: '2026-09-01T00:00:00.000Z' },
]

function seedRow(): Row {
  return { client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: SEED_POOL }
}

beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', STAFF)
  vi.stubEnv('ADMIN_EMAIL_DOMAIN', '')
  vi.stubEnv('CLIENT_VIEWERS', `${VIEWER}:${CLIENT}`)
  vi.stubEnv('DEMO_ADMINS', `${DEMO}:${CLIENT}`)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('creative-pool/approve — 内部员工批准', () => {
  it('POST { ref } → 200，approved_by 来自会话、approved_at 合法 ISO，其它条目原样保留', async () => {
    signedInAs(STAFF)
    const { write } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(write).toHaveBeenCalledTimes(1)
    const [written] = write.mock.calls[0]
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
    const { write } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1', approved_by: 'attacker@x' }), params())
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('only ref is accepted')
    expect(write).not.toHaveBeenCalled()
  })

  it('ref 不在池里 → 404，不写库', async () => {
    signedInAs(STAFF)
    const { write } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'nope' }), params())

    expect(res.status).toBe(404)
    expect(write).not.toHaveBeenCalled()
  })

  it('已批准的 ref → 200 且 idempotent，不写库', async () => {
    signedInAs(STAFF)
    const { write } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'wo-9' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.idempotent).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('creative-pool/approve — 非内部员工批不动', () => {
  it('付费客户门户成员 → 403，不写库', async () => {
    signedInAs(PORTAL_MEMBER)
    const { write } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1' }), params())

    expect(res.status).toBe(403)
    expect(write).not.toHaveBeenCalled()
  })

  it('没登录 → 401，不写库', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: STAFF } as never } as never)
    mockSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const { write } = fakeTable([seedRow()])

    const res = await POST(postRequest({ ref: 'v1' }), params())

    expect(res.status).toBe(401)
    expect(write).not.toHaveBeenCalled()
  })
})


describe('candidate append / approval concurrency boundary', () => {
  it('rejects a pool changed after the approval read', async () => {
    signedInAs(STAFF)
    const { write } = fakeTable([seedRow()], true)
    expect((await POST(postRequest({ ref: 'v1' }), params())).status).toBe(409)
    expect(write).not.toHaveBeenCalled()
  })
  it('never approves a client-library reference as an executable Meta video', async () => {
    signedInAs(STAFF)
    const { write } = fakeTable([{ ...seedRow(), creative_pool: [{ kind: 'client_video', ref: 'local-video', status: 'candidate' }] }])
    expect((await POST(postRequest({ ref: 'local-video' }), params())).status).toBe(409)
    expect(write).not.toHaveBeenCalled()
  })
})


it('approves only the matching kind when two reference types share a ref', async () => {
  signedInAs(STAFF)
  const { write } = fakeTable([{ ...seedRow(), creative_pool: [
    { kind: 'work_order', ref: 'shared-ref', status: 'candidate' },
    { kind: 'client_video', ref: 'shared-ref', status: 'candidate' },
  ] }])
  expect((await POST(postRequest({ ref: 'shared-ref' }), params())).status).toBe(200)
  expect(write.mock.calls[0][0].creative_pool).toEqual([
    expect.objectContaining({ kind: 'work_order', status: 'approved' }),
    { kind: 'client_video', ref: 'shared-ref', status: 'candidate' },
  ])
})
