/**
 * 广告健康监测配置接口 —— 谁能改。
 *
 * enabled=false 会让每日广告体检、摘要、广告快照 cron 全部跳过这个客户；
 * digest_recipients 决定内部摘要发给谁。所以测试盯的是「非内部员工改得动」这种静默出错：
 *   - 付费客户门户成员 / 客户查看者 / 受限演示管理员 PATCH → 403，且不写库
 *   - 内部员工 PATCH → 照常写库、读回新配置
 *   - 客户成员 GET 仍然能看
 *
 * 用真的 guardGlobalAdmin + 真的白名单（只假登录态和 env），
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

import { GET, PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'client-uuid-ad-strategy-config-test'
const STAFF = 'fde@staff.test'
const VIEWER = 'bdm@client.test'
const DEMO = 'demo@staff.test'
// A paid portal member passes requirePaidClientAccess but is on no env whitelist.
// (Self-serve users are already stopped earlier by requirePaidClientAccess.)
const PORTAL_MEMBER = 'owner@client.test'

type Row = Record<string, unknown>

function fakeTable(initial: Row[] = []) {
  const rows = new Map<string, Row>(initial.map(r => [String(r.client_id), r]))
  const upsert = vi.fn(async (row: Row, opts: { onConflict: string }) => {
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
      upsert,
    }
  }) as never)
  return { rows, upsert }
}

function params() {
  return { params: { id: CLIENT } }
}

function url() {
  return `http://localhost:3001/api/clients/${CLIENT}/ad-strategy-config`
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(url(), {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 访问闸放行（付费客户成员都过得去），登录态是 email 这个人。 */
function signedInAs(email: string) {
  mockAccess.mockResolvedValue({ ok: true, user: { email } as never } as never)
  mockSession.mockResolvedValue({ ok: true, user: { email } as never })
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

describe('ad-strategy-config — PATCH 非内部员工改不动', () => {
  it.each([
    ['付费客户门户成员（不在任何白名单）', PORTAL_MEMBER],
    ['客户查看者', VIEWER],
    ['受限演示管理员（role=admin 但限定单客户）', DEMO],
  ])('%s 关掉监测 → 403，且不写库', async (_name, email) => {
    signedInAs(email)
    const { upsert, rows } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: ['fde@staff.test'] }])

    const res = await PATCH(patchRequest({ enabled: false }), params())

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
    expect(rows.get(CLIENT)?.enabled).toBe(true)
  })

  it('客户查看者改摘要收件人 → 403，收件人不变', async () => {
    signedInAs(VIEWER)
    const { upsert, rows } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: ['fde@staff.test'] }])

    const res = await PATCH(patchRequest({ digest_recipients: ['attacker@evil.test'] }), params())

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
    expect(rows.get(CLIENT)?.digest_recipients).toEqual(['fde@staff.test'])
  })

  it('没登录 → 401，不写库', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: STAFF } as never } as never)
    mockSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const { upsert } = fakeTable()

    const res = await PATCH(patchRequest({ enabled: false }), params())

    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('不是这个客户的成员 → 照访问闸的状态码拒绝，不写库', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const { upsert } = fakeTable()

    const res = await PATCH(patchRequest({ enabled: false }), params())

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('ad-strategy-config — PATCH 内部员工照常改', () => {
  it('关掉监测 + 改收件人：upsert 按 client_id，读回新配置', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [] }])

    const res = await PATCH(
      patchRequest({ enabled: false, digest_recipients: [' a@staff.test ', 'b@staff.test'] }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'client_id' })
    expect(written).toMatchObject({
      client_id: CLIENT, enabled: false, digest_recipients: ['a@staff.test', 'b@staff.test'],
    })
    expect(json.config).toEqual({
      client_id: CLIENT, enabled: false, digest_recipients: ['a@staff.test', 'b@staff.test'],
    })
  })

  it('内部员工填错邮箱 → 400，不写库（守卫不吞掉原有校验）', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable()

    const res = await PATCH(patchRequest({ digest_recipients: ['not-an-email'] }), params())

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('ad-strategy-config — GET 客户成员仍可查看', () => {
  it('客户查看者 GET → 200 读到配置', async () => {
    signedInAs(VIEWER)
    fakeTable([{ client_id: CLIENT, enabled: false, digest_recipients: ['x@staff.test'] }])

    const res = await GET(new NextRequest(url()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.config).toEqual({ client_id: CLIENT, enabled: false, digest_recipients: ['x@staff.test'] })
  })
})
