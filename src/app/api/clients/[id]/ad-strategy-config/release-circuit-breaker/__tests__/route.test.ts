/**
 * 解除熔断路由 —— 谁能解、解到哪个 mode。
 *
 * 用真的 requireGlobalAdmin + 真的白名单（只假登录态和 env），跟
 * ad-strategy-config/__tests__/route.test.ts 同一理由：「去掉守卫」或
 * 「守卫放行受限管理员」都会让用例红，不是靠 mock 掉守卫本身通过。
 *
 * 只测装配 + 调用形状（每个 ads.* 键调一次 RPC，updated_by 带
 * circuit-breaker-release: 前缀），不重跑 SQL 函数本身的逻辑（那在 migration 里）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSession = vi.mocked(requireSession)
const mockRpc = vi.mocked(supabaseAdmin.rpc)

const CLIENT = 'client-uuid-release-circuit-breaker-test'
const STAFF = 'fde@staff.test'
const VIEWER = 'bdm@client.test'
const DEMO = 'demo@staff.test'
const PORTAL_MEMBER = 'owner@client.test'

function params() {
  return { params: { id: CLIENT } }
}

function postRequest(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-strategy-config/release-circuit-breaker`, {
    method: 'POST',
  })
}

function signedInAs(email: string) {
  mockAccess.mockResolvedValue({ ok: true, user: { email } as never } as never)
  mockSession.mockResolvedValue({ ok: true, user: { email } as never })
}

beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', STAFF)
  vi.stubEnv('ADMIN_EMAIL_DOMAIN', '')
  vi.stubEnv('CLIENT_VIEWERS', `${VIEWER}:${CLIENT}`)
  vi.stubEnv('DEMO_ADMINS', `${DEMO}:${CLIENT}`)
  mockRpc.mockResolvedValue({ data: 'released', error: null } as never)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('release-circuit-breaker — 非内部员工解不动', () => {
  it.each([
    ['付费客户门户成员（不在任何白名单）', PORTAL_MEMBER],
    ['客户查看者', VIEWER],
    ['受限演示管理员（role=admin 但限定单客户）', DEMO],
  ])('%s → 403，不调 RPC', async (_name, email) => {
    signedInAs(email)
    const res = await POST(postRequest(), params())
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('没登录 → 401，不调 RPC', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: STAFF } as never } as never)
    mockSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await POST(postRequest(), params())
    expect(res.status).toBe(401)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('不是这个客户的成员 → 照访问闸状态码拒绝，不调 RPC', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const res = await POST(postRequest(), params())
    expect(res.status).toBe(403)
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('release-circuit-breaker — 内部员工可以解', () => {
  it('🔴 每个 ads.* 键调一次 RPC，updated_by 带 circuit-breaker-release: 前缀（不是原始 email）', async () => {
    signedInAs(STAFF)
    const res = await POST(postRequest(), params())
    const json = (await res.json()) as { success: boolean; released: number }

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)

    const keys = listAdsActionKeys()
    expect(mockRpc).toHaveBeenCalledTimes(keys.length)
    expect(json.released).toBe(keys.length)

    for (const call of mockRpc.mock.calls) {
      expect(call[0]).toBe('ads_release_circuit_breaker_policy')
      const rpcParams = call[1] as Record<string, unknown>
      expect(rpcParams.p_client_id).toBe(CLIENT)
      expect(typeof rpcParams.p_updated_by).toBe('string')
      expect(String(rpcParams.p_updated_by)).toMatch(new RegExp(`^circuit-breaker-release:${STAFF}:`))
    }
  })

  it('RPC 报错 → 500，把出错的键名带进 error', async () => {
    signedInAs(STAFF)
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never)
    const res = await POST(postRequest(), params())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('boom')
  })

  it('outcome=not_circuit_tripped 不计入 released 计数', async () => {
    signedInAs(STAFF)
    mockRpc.mockResolvedValue({ data: 'not_circuit_tripped', error: null } as never)
    const res = await POST(postRequest(), params())
    const json = (await res.json()) as { released: number }
    expect(json.released).toBe(0)
  })
})
