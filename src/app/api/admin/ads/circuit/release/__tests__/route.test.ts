/**
 * 人工解除熔断路由的测试。
 *
 * 这份假 supabase **真的按过滤条件筛行**，不是无条件返回一个固定数组。
 * 理由：本路由最要命的两个错法都是「过滤没生效」的形状——
 *   ① 把别的账户 / 别的客户的 trip 也解掉；
 *   ② 把已经解除过的 trip 再解一遍（多写一行没有意义的账）。
 * 假件如果无条件返回，这两个错法在测试里都是绿的。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))

interface EventRow {
  id: string
  client_id: string
  ad_account_id: string
  kind: 'trip' | 'release'
  trip_event_id: string | null
  reason: string
  sticky: boolean
  created_at: string
}

const inserted: Array<Record<string, unknown>> = []
let rows: EventRow[] = []
/** 'trip' → 查 trip 那一步报错；'release' → 查 release 那一步报错。 */
let failStep: 'trip' | 'release' | null = null

function makeQuery() {
  const filters: Array<(r: EventRow) => boolean> = []
  let kindAsked: string | null = null

  const q = {
    select: () => q,
    eq(col: string, value: unknown) {
      if (col === 'kind') kindAsked = String(value)
      filters.push((r) => (r as unknown as Record<string, unknown>)[col] === value)
      return q
    },
    or(expr: string) {
      // 只支持本路由真正用的那一种：`sticky.eq.true,created_at.gt.<iso>`
      const cutoff = expr.split('created_at.gt.')[1]
      filters.push((r) => r.sticky === true || r.created_at > cutoff)
      return q
    },
    in(col: string, values: unknown[]) {
      filters.push((r) => values.includes((r as unknown as Record<string, unknown>)[col]))
      return q
    },
    order() {
      return q
    },
    insert(payload: Record<string, unknown>[]) {
      inserted.push(...payload)
      return {
        select: () => Promise.resolve({ data: payload.map((_, i) => ({ id: `new-${i}` })), error: null }),
      }
    },
    then(resolve: (v: { data: EventRow[] | null; error: { message: string } | null }) => unknown) {
      if (failStep && kindAsked === failStep) {
        return Promise.resolve({ data: null, error: { message: '库炸了' } }).then(resolve)
      }
      const data = rows.filter((r) => filters.every((f) => f(r)))
      // 路由按 created_at DESC 取，假件照做，好让「最新那条」可断言
      data.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => makeQuery() },
}))

import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { POST } from '../route'

const mockAdmin = vi.mocked(requireGlobalAdmin)
const CLIENT = '11111111-1111-1111-1111-111111111111'
const OTHER_CLIENT = '22222222-2222-2222-2222-222222222222'

function asAdmin(email: string | null | undefined) {
  mockAdmin.mockResolvedValue({
    ok: true,
    // 只用到 email，其余字段路由不碰
    user: { email } as never,
  })
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/ads/circuit/release', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function trip(over: Partial<EventRow> & { id: string }): EventRow {
  return {
    client_id: CLIENT,
    ad_account_id: 'act_1',
    kind: 'trip',
    trip_event_id: null,
    reason: 'circuit:overspend',
    sticky: true,
    created_at: '2026-09-27T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  inserted.length = 0
  rows = []
  failStep = null
  vi.clearAllMocks()
})

describe('鉴权', () => {
  it('不是全局 admin → 原样透传状态码，一行都不写', async () => {
    mockAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    rows = [trip({ id: 't1' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(403)
    expect(inserted).toHaveLength(0)
  })

  it('未登录（401）也原样透传', async () => {
    mockAdmin.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(res.status).toBe(401)
  })

  it('🔴 是 admin 但 email 取不到 → 拒，且一行都不写（不许兜底成 human:）', async () => {
    asAdmin(null)
    rows = [trip({ id: 't1' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(403)
    expect(inserted).toHaveLength(0)
    expect((await res.json()).error).toContain('登录邮箱')
  })

  it('🔴 email 是空串 / 不成形状，同样拒', async () => {
    for (const bad of ['', '   ', 'not-an-email', 'a@', '@b.c', 'a b@c.d']) {
      inserted.length = 0
      asAdmin(bad)
      rows = [trip({ id: 't1' })]
      const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
      expect(res.status, `email=${JSON.stringify(bad)} 应被拒`).toBe(403)
      expect(inserted).toHaveLength(0)
    }
  })

  it('actor 来自登录身份、小写化；body 里给的 actor 被无视', async () => {
    asAdmin('PM@MagicEngine.Cloud')
    rows = [trip({ id: 't1' })]

    const res = await POST(
      req({ clientId: CLIENT, adAccountId: 'act_1', actor: 'human:attacker@evil.com' }),
    )

    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].actor).toBe('human:pm@magicengine.cloud')
  })
})

describe('请求体', () => {
  beforeEach(() => asAdmin('pm@magicengine.cloud'))

  it('不是合法 JSON → 400', async () => {
    const bad = new NextRequest('http://localhost/x', { method: 'POST', body: '{oops' })
    expect((await POST(bad)).status).toBe(400)
  })

  it.each([
    ['缺 clientId', { adAccountId: 'act_1' }],
    ['缺 adAccountId', { clientId: CLIENT }],
    ['clientId 是空白', { clientId: '   ', adAccountId: 'act_1' }],
    ['adAccountId 不是字符串', { clientId: CLIENT, adAccountId: 7 }],
  ])('%s → 400，一行都不写', async (_label, body) => {
    rows = [trip({ id: 't1' })]
    const res = await POST(req(body))
    expect(res.status).toBe(400)
    expect(inserted).toHaveLength(0)
  })
})

describe('解除哪些 trip', () => {
  beforeEach(() => asAdmin('pm@magicengine.cloud'))

  it('没有任何 trip → released: 0，不写行', async () => {
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).released).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('🔴 多条未解 trip → **每条各写一行** release，各自指回自己那条', async () => {
    rows = [
      trip({ id: 't1', reason: 'circuit:rollback_failed' }),
      trip({ id: 't2', reason: 'circuit:overspend', created_at: '2026-09-27T01:00:00.000Z' }),
      trip({ id: 't3', reason: 'circuit:jev_low', created_at: '2026-09-27T02:00:00.000Z' }),
    ]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    const body = await res.json()

    expect(body.released).toBe(3)
    expect(inserted).toHaveLength(3)
    expect(new Set(inserted.map((r) => r.trip_event_id))).toEqual(new Set(['t1', 't2', 't3']))
    // 写一行「全解了」就会漏掉另外两条，看板仍会说熔断中
    expect(inserted.every((r) => r.kind === 'release')).toBe(true)
    expect(inserted.every((r) => r.trip_event_id !== null)).toBe(true)
  })

  it('已解除过的 trip 不再写第二行', async () => {
    rows = [
      trip({ id: 't1' }),
      trip({ id: 't2', created_at: '2026-09-27T01:00:00.000Z' }),
      {
        ...trip({ id: 'r1' }),
        kind: 'release',
        trip_event_id: 't1',
        sticky: false,
        reason: '人工解除',
      },
    ]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect((await res.json()).released).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].trip_event_id).toBe('t2')
  })

  it('全部都解除过了 → released: 0，不写行', async () => {
    rows = [
      trip({ id: 't1' }),
      { ...trip({ id: 'r1' }), kind: 'release', trip_event_id: 't1', sticky: false },
    ]
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect((await res.json()).released).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('🔴 不碰别的账户：act_2 的 trip 不会被 act_1 的解除请求带走', async () => {
    rows = [trip({ id: 't1' }), trip({ id: 't2', ad_account_id: 'act_2' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect((await res.json()).released).toBe(1)
    expect(inserted.map((r) => r.trip_event_id)).toEqual(['t1'])
  })

  it('🔴 不碰别的客户：同一个账户号挂在别的客户下也不解', async () => {
    rows = [trip({ id: 't1', client_id: OTHER_CLIENT })]
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect((await res.json()).released).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('🔴 非 sticky 且已超 24h 的 trip 不在解除范围（它已自然过期）', async () => {
    rows = [
      trip({ id: 'old', sticky: false, created_at: '2020-01-01T00:00:00.000Z' }),
      trip({ id: 'fresh', sticky: false, created_at: new Date().toISOString() }),
    ]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(inserted.map((r) => r.trip_event_id)).toEqual(['fresh'])
  })

  it('sticky 的老 trip 仍在范围内（时间对 sticky 无效）', async () => {
    rows = [trip({ id: 'old-sticky', sticky: true, created_at: '2020-01-01T00:00:00.000Z' })]
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(inserted.map((r) => r.trip_event_id)).toEqual(['old-sticky'])
  })

  it('写的行里 sticky 固定 false，evidence 留着被解那条的性质', async () => {
    rows = [trip({ id: 't1', sticky: true, reason: 'circuit:rollback_failed' })]
    await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(inserted[0].sticky).toBe(false)
    expect(inserted[0].evidence).toEqual({
      released_trip_reason: 'circuit:rollback_failed',
      released_trip_sticky: true,
    })
  })

  it('给了 note 就用 note 当 reason，没给就带上原因', async () => {
    rows = [trip({ id: 't1', reason: 'circuit:overspend' })]
    await POST(req({ clientId: CLIENT, adAccountId: 'act_1', note: '已确认预算配置修好' }))
    expect(inserted[0].reason).toBe('已确认预算配置修好')

    inserted.length = 0
    rows = [trip({ id: 't1', reason: 'circuit:overspend' })]
    await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(String(inserted[0].reason)).toContain('circuit:overspend')
  })
})

describe('查询失败必须 fail closed', () => {
  beforeEach(() => asAdmin('pm@magicengine.cloud'))

  it('查 trip 失败 → 500，一行都不写（不当成「没有熔断」）', async () => {
    rows = [trip({ id: 't1' })]
    failStep = 'trip'
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(res.status).toBe(500)
    expect(inserted).toHaveLength(0)
  })

  it('查 release 失败 → 500，一行都不写（不当成「都没解除过」去重复解）', async () => {
    rows = [trip({ id: 't1' })]
    failStep = 'release'
    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))
    expect(res.status).toBe(500)
    expect(inserted).toHaveLength(0)
  })
})

describe('紧急开关熔断只有授权人能解除', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('名单已配，调用者不在名单 → 403，一行都不写', async () => {
    vi.stubEnv('ADS_ACTIVATION_APPROVER_EMAILS', 'ray@x.com')
    asAdmin('other@x.com')
    rows = [trip({ id: 't1', reason: 'manual_emergency_stop: 测试' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(403)
    expect(inserted).toHaveLength(0)
  })

  it('名单已配，调用者在名单（大小写不敏感）→ 200，写一行 release', async () => {
    vi.stubEnv('ADS_ACTIVATION_APPROVER_EMAILS', 'ray@x.com')
    asAdmin('RAY@X.COM')
    rows = [trip({ id: 't1', reason: 'manual_emergency_stop: 测试' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).released).toBe(1)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].trip_event_id).toBe('t1')
  })

  it('名单没配 → 任意全局管理员仍可解除（退回原行为，防死锁）', async () => {
    vi.stubEnv('ADS_ACTIVATION_APPROVER_EMAILS', '')
    asAdmin('anyone@x.com')
    rows = [trip({ id: 't1', reason: 'manual_emergency_stop: 测试' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).released).toBe(1)
    expect(inserted).toHaveLength(1)
  })

  it('名单已配，只有系统熔断 → 调用者不在名单也照旧可解除', async () => {
    vi.stubEnv('ADS_ACTIVATION_APPROVER_EMAILS', 'ray@x.com')
    asAdmin('other@x.com')
    rows = [trip({ id: 't1', reason: 'spend_over_cap' })]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).released).toBe(1)
    expect(inserted).toHaveLength(1)
  })

  it('🔴 紧急开关 trip 与系统 trip 并存，调用者不在名单 → 403，一行都不写（all-or-nothing）', async () => {
    vi.stubEnv('ADS_ACTIVATION_APPROVER_EMAILS', 'ray@x.com')
    asAdmin('other@x.com')
    rows = [
      trip({ id: 't1', reason: 'manual_emergency_stop: 测试' }),
      trip({ id: 't2', reason: 'spend_over_cap', created_at: '2026-09-27T01:00:00.000Z' }),
    ]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(403)
    expect(inserted).toHaveLength(0)
  })

  it('紧急开关 trip 已解除过（不在 open 里）→ 不再限制，只解系统那条', async () => {
    vi.stubEnv('ADS_ACTIVATION_APPROVER_EMAILS', 'ray@x.com')
    asAdmin('other@x.com')
    rows = [
      trip({ id: 't1', reason: 'manual_emergency_stop: 测试' }),
      {
        ...trip({ id: 'r1' }),
        kind: 'release',
        trip_event_id: 't1',
        sticky: false,
        reason: '人工解除',
      },
      trip({ id: 't2', reason: 'spend_over_cap', created_at: '2026-09-27T01:00:00.000Z' }),
    ]

    const res = await POST(req({ clientId: CLIENT, adAccountId: 'act_1' }))

    expect(res.status).toBe(200)
    expect((await res.json()).released).toBe(1)
    expect(inserted.map((r) => r.trip_event_id)).toEqual(['t2'])
  })
})
