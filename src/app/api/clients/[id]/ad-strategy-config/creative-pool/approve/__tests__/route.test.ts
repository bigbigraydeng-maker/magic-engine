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
 * 读回走真实的 loadAdStrategyConfigWithSource。
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

function fakeTable(initial: Row[] = [], readError: 'never' | 'always' | 'after_write' = 'never') {
  const rows = new Map<string, Row>(initial.map(r => [String(r.client_id), r]))
  let written = false
  const upsert = vi.fn(async (row: Row, opts: { onConflict: string }) => {
    const key = String(row[opts.onConflict])
    rows.set(key, { ...(rows.get(key) ?? {}), ...row })
    written = true
    return { error: null }
  })
  mockFrom.mockImplementation(((table: string) => {
    if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
    return {
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: async () => {
            if (readError === 'always' || (readError === 'after_write' && written)) {
              return { data: null, error: { message: 'timeout' } }
            }
            return {
              data: [...rows.values()].find(r => r[col] === val) ?? null,
              error: null,
            }
          },
        }),
      }),
      upsert,
    }
  }) as never)
  return { rows, upsert }
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

describe('creative-pool/approve — 读失败不冒充空素材池', () => {
  it('🔴 读不出素材池 → 503 + 中文提示，不报「ref 不在池里」、不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()], 'always')

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toContain('读不出')
    expect(upsert).not.toHaveBeenCalled()
    // 界面靠 saved 分清「已批准但读不回」和「根本没批」——没批的这条绝不能带它
    expect(json.saved).toBeUndefined()
  })

  it('🔴 批准写成功但回读失败 → 503 且 saved:true，不回空素材池', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()], 'after_write')

    const res = await POST(postRequest({ ref: 'v1' }), params())
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.saved).toBe(true)
    expect(json.error).toContain('已批准')
    expect(json.config).toBeUndefined()
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.status).toBe('approved')
    expect(v1.approved_by).toBe(STAFF)
  })
})
