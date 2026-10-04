/**
 * 广告「紧急开关」路由的测试。
 *
 * 假 supabase 记录每次 `insert` 的参数，好断言「一次批量插入、每账户一行」。
 * `activation-kill.ts` 不 mock（跑真实现），只 mock 它依赖的四个外部模块。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))
vi.mock('@/lib/meta/campaign-ownership', () => ({ getRegisteredAccountIds: vi.fn() }))
vi.mock('@/lib/ads-strategy/circuit-state', () => ({ readCircuitState: vi.fn() }))

/** 每次 insert 的参数（行数组）。 */
const insertCalls: Array<Array<Record<string, unknown>>> = []
let insertError: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (rows: Array<Record<string, unknown>>) => {
        insertCalls.push(rows)
        return {
          select: () =>
            Promise.resolve(
              insertError
                ? { data: null, error: insertError }
                : { data: rows.map((_, i) => ({ id: `new-${i}` })), error: null },
            ),
        }
      },
    }),
  },
}))

import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { readCircuitState } from '@/lib/ads-strategy/circuit-state'
import { POST, GET } from '../route'

const mockAdmin = vi.mocked(requireGlobalAdmin)
const mockAccounts = vi.mocked(getRegisteredAccountIds)
const mockCircuit = vi.mocked(readCircuitState)

const CLIENT = '11111111-1111-1111-1111-111111111111'

function asAdmin(email: string | null | undefined) {
  mockAdmin.mockResolvedValue({ ok: true, user: { email } as never })
}

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/ads/activation-kill', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function getReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/ads/activation-kill${query}`)
}

beforeEach(() => {
  insertCalls.length = 0
  insertError = null
  vi.clearAllMocks()
  asAdmin('ray@x.com')
  mockAccounts.mockResolvedValue({ ids: ['act_1'] })
  mockCircuit.mockResolvedValue({ tripped: false, reason: null, queryError: null })
})

describe('鉴权', () => {
  it('管理员校验失败 → 原样透传状态码，不写库', async () => {
    mockAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const res = await POST(postReq({ clientId: CLIENT, reason: '测试' }))
    expect(res.status).toBe(403)
    expect(insertCalls).toHaveLength(0)
  })

  it('登录邮箱缺失或形状不对 → 403，不写库', async () => {
    for (const bad of [null, undefined, '', '   ', 'not-an-email', 'a@', '@b.c', 'a b@c.d']) {
      insertCalls.length = 0
      asAdmin(bad)
      const res = await POST(postReq({ clientId: CLIENT, reason: '测试' }))
      expect(res.status, `email=${JSON.stringify(bad)} 应被拒`).toBe(403)
      expect(insertCalls).toHaveLength(0)
    }
  })
})

describe('请求体', () => {
  it('body 不是合法 JSON → 400，不写库', async () => {
    const bad = new NextRequest('http://localhost/x', { method: 'POST', body: '{oops' })
    expect((await POST(bad)).status).toBe(400)
    expect(insertCalls).toHaveLength(0)
  })

  it.each([
    ['缺 clientId', { reason: '测试' }],
    ['clientId 是空白', { clientId: '   ', reason: '测试' }],
    ['缺 reason', { clientId: CLIENT }],
    ['reason 是纯空白', { clientId: CLIENT, reason: '   ' }],
  ])('%s → 400，不写库', async (_label, body) => {
    const res = await POST(postReq(body))
    expect(res.status).toBe(400)
    expect(insertCalls).toHaveLength(0)
  })
})

describe('账户清单', () => {
  it('读账户清单报 error → 502，不写库', async () => {
    mockAccounts.mockResolvedValue({ ids: [], error: '读不到账户' })
    const res = await POST(postReq({ clientId: CLIENT, reason: '测试' }))
    expect(res.status).toBe(502)
    expect(insertCalls).toHaveLength(0)
  })

  it('账户清单为空 → 409，不写库', async () => {
    mockAccounts.mockResolvedValue({ ids: [] })
    const res = await POST(postReq({ clientId: CLIENT, reason: '测试' }))
    expect(res.status).toBe(409)
    expect(insertCalls).toHaveLength(0)
  })
})

describe('成功路径', () => {
  it('两个账户各写一行，账户号原样保留，邮箱规整成小写', async () => {
    asAdmin('Ray@X.com')
    mockAccounts.mockResolvedValue({ ids: ['act_111', '222'] })

    const res = await POST(postReq({ clientId: CLIENT, reason: '预算失控' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(insertCalls).toHaveLength(1)
    const rows = insertCalls[0]
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.ad_account_id)).toEqual(['act_111', '222'])
    for (const row of rows) {
      expect(row.kind).toBe('trip')
      expect(row.sticky).toBe(true)
      expect(String(row.reason).startsWith('manual_emergency_stop')).toBe(true)
      expect(row.actor).toBe('human:ray@x.com')
    }
    expect(body.engaged).toBe(true)
    expect(body.accounts).toEqual(['act_111', '222'])
  })

  it('插入报错 → 500', async () => {
    insertError = { message: '库炸了' }
    const res = await POST(postReq({ clientId: CLIENT, reason: '测试' }))
    expect(res.status).toBe(500)
  })

  it('原因超过 500 字 → 400，不写库', async () => {
    const res = await POST(postReq({ clientId: CLIENT, reason: 'x'.repeat(501) }))
    expect(res.status).toBe(400)
    expect(insertCalls).toHaveLength(0)
  })
})

describe('GET 查开关状态', () => {
  it('缺 clientId → 400', async () => {
    const res = await GET(getReq(''))
    expect(res.status).toBe(400)
  })

  it('管理员校验失败 → 对应 status', async () => {
    mockAdmin.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await GET(getReq(`?clientId=${CLIENT}`))
    expect(res.status).toBe(401)
  })

  it('账户都没熔断 → 200 且 engaged:false', async () => {
    mockAccounts.mockResolvedValue({ ids: ['act_1'] })
    mockCircuit.mockResolvedValue({ tripped: false, reason: null, queryError: null })
    const res = await GET(getReq(`?clientId=${CLIENT}`))
    expect(res.status).toBe(200)
    expect((await res.json()).engaged).toBe(false)
  })

  it('某账户熔断且 reason 以 manual_emergency_stop 开头 → kill_switch_engaged', async () => {
    mockAccounts.mockResolvedValue({ ids: ['act_1'] })
    mockCircuit.mockResolvedValue({
      tripped: true,
      reason: 'manual_emergency_stop: 测试',
      queryError: null,
    })
    const res = await GET(getReq(`?clientId=${CLIENT}`))
    const body = await res.json()
    expect(body.engaged).toBe(true)
    expect(body.code).toBe('kill_switch_engaged')
  })

  it('readCircuitState 返回 queryError → circuit_unreadable', async () => {
    mockAccounts.mockResolvedValue({ ids: ['act_1'] })
    mockCircuit.mockResolvedValue({ tripped: false, reason: null, queryError: '读不到' })
    const res = await GET(getReq(`?clientId=${CLIENT}`))
    const body = await res.json()
    expect(body.engaged).toBe(true)
    expect(body.code).toBe('circuit_unreadable')
  })
})

describe('源文件约束', () => {
  it('route.ts 里不出现英文单词 release（不区分大小写）', () => {
    const here = join(__dirname, 'route.ts')
    const path = existsSync(here) ? here : join(__dirname, '../route.ts')
    const src = readFileSync(path, 'utf8')
    expect(src.toLowerCase()).not.toContain('release')
  })
})
