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
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn(), from: vi.fn() } }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSession = vi.mocked(requireSession)
const mockRpc = vi.mocked(supabaseAdmin.rpc)
const mockFrom = vi.mocked(supabaseAdmin.from)

/**
 * `ad_strategy_configs` 的假 `.from()` 链——支撑两条路径：
 * `.select('autonomy_mode').eq(...).maybeSingle()` 读当前意向，
 * `.update({...}).eq(...)` 写降级。`.eq()` 的返回值同时可 `await`（给 update
 * 用）又能再 `.maybeSingle()`（给 select 用），因为两条路径共用同一个 `.eq()`。
 */
function fakeConfigFrom(
  autonomyMode: 'bounded_auto' | 'observe' | null,
  opts: { readError?: string; updateError?: string } = {},
) {
  const updateCalls: Record<string, unknown>[] = []
  const eqResult = {
    maybeSingle: async () =>
      opts.readError
        ? { data: null, error: { message: opts.readError } }
        : { data: autonomyMode === null ? null : { autonomy_mode: autonomyMode }, error: null },
    then: (resolve: (v: { error: { message: string } | null }) => void) =>
      resolve(opts.updateError ? { error: { message: opts.updateError } } : { error: null }),
  }
  const chain = {
    select: () => chain,
    update: (payload: Record<string, unknown>) => {
      updateCalls.push(payload)
      return chain
    },
    eq: () => eqResult,
  }
  return { chain, updateCalls }
}

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
  vi.stubEnv('INNGEST_EVENT_KEY', '') // 不真的发事件；notifyAutonomyModeChanged 内部 catch，不影响响应
  mockRpc.mockResolvedValue({ data: 'released', error: null } as never)
  mockFrom.mockReturnValue(fakeConfigFrom('bounded_auto').chain as never)
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
    const json = (await res.json()) as { success: boolean; released: number; intent_downgraded_to_observe: boolean }

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)

    const keys = listAdsActionKeys()
    expect(mockRpc).toHaveBeenCalledTimes(keys.length)
    expect(json.released).toBe(keys.length)
    expect(json.intent_downgraded_to_observe).toBe(true) // 默认 mock 意向是 bounded_auto，真的解了 → 必须跟着降

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

  it('🔴 Codex P2：任一键 race_lost → 500 且不假装成功，不进入降意向逻辑', async () => {
    signedInAs(STAFF)
    // 第一个键正常解开，第二个键并发被改动导致 race_lost——之前的实现会照样 success:true。
    mockRpc.mockResolvedValueOnce({ data: 'released', error: null } as never)
    mockRpc.mockResolvedValueOnce({ data: 'race_lost', error: null } as never)
    const res = await POST(postRequest(), params())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('race_lost')
    expect(mockFrom).not.toHaveBeenCalled() // 半解除状态不确定，不该顺手降 autonomy_mode
  })

  it('🔴 Codex P2：rpc 返回非字符串（unknown outcome）同样当失败，不当成功报告', async () => {
    signedInAs(STAFF)
    mockRpc.mockResolvedValue({ data: null, error: null } as never) // data 不是字符串 → 'unknown'
    const res = await POST(postRequest(), params())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('unknown')
  })

  it('🔴 Codex P1（round 7）：outcome 全是 not_circuit_tripped（重试场景）但意向仍是 bounded_auto → 照样降级，不因 released=0 跳过', async () => {
    signedInAs(STAFF)
    // 模拟"第一次调用已经把策略解开，这次重试每个键都幂等报 not_circuit_tripped"——
    // released 计数是 0，但 autonomy_mode 还没降，必须照样处理，不能靠 released 判断。
    mockRpc.mockResolvedValue({ data: 'not_circuit_tripped', error: null } as never)
    const { chain, updateCalls } = fakeConfigFrom('bounded_auto')
    mockFrom.mockReturnValue(chain as never)

    const res = await POST(postRequest(), params())
    const json = (await res.json()) as { released: number; intent_downgraded_to_observe: boolean }
    expect(json.released).toBe(0)
    expect(json.intent_downgraded_to_observe).toBe(true) // released=0 不再等于"不用降"
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].autonomy_mode).toBe('observe')
  })

  it('outcome 全是 not_circuit_tripped 且意向已经是 observe → 不产生多余写入', async () => {
    signedInAs(STAFF)
    mockRpc.mockResolvedValue({ data: 'not_circuit_tripped', error: null } as never)
    const { chain, updateCalls } = fakeConfigFrom('observe')
    mockFrom.mockReturnValue(chain as never)

    const res = await POST(postRequest(), params())
    const json = (await res.json()) as { released: number; intent_downgraded_to_observe: boolean }
    expect(json.released).toBe(0)
    expect(json.intent_downgraded_to_observe).toBe(false)
    expect(updateCalls).toHaveLength(0) // 已经是安全状态，不该反复写
  })
})

describe('release-circuit-breaker — 🔴 Codex P1：解除后必须同步收紧 autonomy_mode，否则下一次 reconcile 悄悄恢复 auto_approve', () => {
  it('意向仍是 bounded_auto + 真的解了 → 降到 observe，intent_downgraded_to_observe: true', async () => {
    signedInAs(STAFF)
    const { chain, updateCalls } = fakeConfigFrom('bounded_auto')
    mockFrom.mockReturnValue(chain as never)

    const res = await POST(postRequest(), params())
    const json = (await res.json()) as { intent_downgraded_to_observe: boolean }

    expect(res.status).toBe(200)
    expect(json.intent_downgraded_to_observe).toBe(true)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].autonomy_mode).toBe('observe')
    expect(updateCalls[0].autonomy_mode_updated_by).toBe(STAFF)
    expect(typeof updateCalls[0].updated_at).toBe('string')
  })

  it('意向已经是 observe（PM 已手动关过）→ 不再多写一次，intent_downgraded_to_observe: false', async () => {
    signedInAs(STAFF)
    const { chain, updateCalls } = fakeConfigFrom('observe')
    mockFrom.mockReturnValue(chain as never)

    const res = await POST(postRequest(), params())
    const json = (await res.json()) as { intent_downgraded_to_observe: boolean }

    expect(res.status).toBe(200)
    expect(json.intent_downgraded_to_observe).toBe(false)
    expect(updateCalls).toHaveLength(0) // 已经是安全状态，不产生多余写入 / 多余同步事件
  })

  it('读 autonomy_mode 失败 → 500，不假装降级成功', async () => {
    signedInAs(STAFF)
    const { chain } = fakeConfigFrom('bounded_auto', { readError: 'read boom' })
    mockFrom.mockReturnValue(chain as never)

    const res = await POST(postRequest(), params())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('read boom')
  })

  it('写 autonomy_mode 失败 → 500，不假装降级成功（策略表已经解开，但意向没跟上必须让人看见）', async () => {
    signedInAs(STAFF)
    const { chain } = fakeConfigFrom('bounded_auto', { updateError: 'update boom' })
    mockFrom.mockReturnValue(chain as never)

    const res = await POST(postRequest(), params())
    expect(res.status).toBe(500)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('update boom')
  })
})
