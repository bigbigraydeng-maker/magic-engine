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
vi.mock('@/lib/ads-strategy/autonomy/notify', () => ({
  notifyAutonomyModeChanged: vi.fn(async () => ({ sent: true, events: 2 })),
}))

import { GET, PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { notifyAutonomyModeChanged } from '@/lib/ads-strategy/autonomy/notify'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockNotify = vi.mocked(notifyAutonomyModeChanged)

const CLIENT = 'client-uuid-ad-strategy-config-test'
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
      daily_budget_cap_cents: null, autonomy_mode: 'observe', creative_pool: [],
      autopilot_enabled: false, autopilot_dry_run: true,
    })
  })

  it('🔴 改之前的设置读不出 → 照样保存（收紧必须存得进去），并且一律发叫醒铃——不拿默认值 observe 当「改之前」', async () => {
    signedInAs(STAFF)
    const upsert = vi.fn(async () => ({ error: null }))
    mockFrom.mockImplementation(((table: string) => {
      if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }) }) }),
        upsert,
      }
    }) as never)

    // 默认值的 autonomy_mode 也是 observe：按默认值比会判成「没变」，一个事件都不发。
    const res = await PATCH(patchRequest({ autonomy_mode: 'observe' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(json.sync_events).toEqual({ sent: true, events: 2 })
  })

  it('改之前读得出、值没变 → 不发叫醒铃（读成功的路径行为不变）', async () => {
    signedInAs(STAFF)
    fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], autonomy_mode: 'observe' }])

    const res = await PATCH(patchRequest({ autonomy_mode: 'observe' }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(mockNotify).not.toHaveBeenCalled()
    expect(json.sync_events).toEqual({ sent: false, events: 0 })
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
    expect(json.config).toEqual({
      client_id: CLIENT, enabled: false, digest_recipients: ['x@staff.test'],
      daily_budget_cap_cents: null, autonomy_mode: 'observe', creative_pool: [],
      autopilot_enabled: false, autopilot_dry_run: true,
    })
  })
})

describe('ad-strategy-config — 自治三列（spec 2026-09-24 G1）', () => {
  it('内部员工设预算上限 + 自治模式 → 200，写库并读回', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [] }])

    const res = await PATCH(
      patchRequest({ daily_budget_cap_cents: 15000, autonomy_mode: 'bounded_auto' }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written] = upsert.mock.calls[0]
    expect(written).toMatchObject({ daily_budget_cap_cents: 15000, autonomy_mode: 'bounded_auto' })
    expect(json.config.daily_budget_cap_cents).toBe(15000)
    expect(json.config.autonomy_mode).toBe('bounded_auto')
  })

  it('预算上限为负 → 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable()

    const res = await PATCH(patchRequest({ daily_budget_cap_cents: -5 }), params())

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('自治模式非法 → 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable()

    const res = await PATCH(patchRequest({ autonomy_mode: 'yolo' }), params())

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('creative_pool 带 status:approved → 400 指向 /creative-pool/approve，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable()

    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'approved' }] }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toContain('creative-pool/approve')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('creative_pool 带 approved_by → 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable()

    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate', approved_by: 'x' }] }),
      params(),
    )

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('内部员工加候选素材 → 200，读回 status=candidate 且无 approved_by', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [] }])

    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'work_order', ref: 'wo-1', status: 'candidate' }] }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(json.config.creative_pool[0].status).toBe('candidate')
    expect(json.config.creative_pool[0]).not.toHaveProperty('approved_by')
  })

  it('素材池重写时保住已有素材的推广期、别名和时间戳（通用 PATCH 不能把它们抹掉）', async () => {
    signedInAs(STAFF)
    const existing = {
      kind: 'meta_video', ref: 'v1', status: 'approved',
      promo_window: { kind: 'dated', start: '2026-10-01', end: '2026-11-30' },
      alias_refs: ['a1'],
      promo_window_set_by: 'fde@staff.test',
      promo_window_set_at: '2026-10-21T00:00:00.000Z',
      promo_window_changed_at: '2026-10-21T00:00:00.000Z',
    }
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [existing] }])

    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }, { kind: 'meta_video', ref: 'v2', status: 'candidate' }] }),
      params(),
    )

    expect(res.status).toBe(200)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.promo_window).toEqual(existing.promo_window)
    expect(v1.alias_refs).toEqual(['a1'])
    expect(v1.promo_window_set_by).toBe('fde@staff.test')
    expect(v1.promo_window_set_at).toBe(existing.promo_window_set_at)
    expect(v1.promo_window_changed_at).toBe(existing.promo_window_changed_at)
    const v2 = pool.find(e => e.ref === 'v2')!
    expect(v2).not.toHaveProperty('promo_window')
  })

  it('creative_pool 带 promo_window / alias_refs / 推广期时间戳 → 400 指向 promo-window 接口，不写库', async () => {
    signedInAs(STAFF)
    for (const extra of [
      { promo_window: { kind: 'evergreen' } },
      { alias_refs: ['x'] },
      { promo_window_set_by: 'x' },
      { promo_window_changed_at: '2026-01-01T00:00:00.000Z' },
    ]) {
      const { upsert } = fakeTable()
      const res = await PATCH(
        patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate', ...extra }] }),
        params(),
      )
      const json = await res.json()
      expect(res.status).toBe(400)
      expect(json.error).toContain('promo-window')
      expect(upsert).not.toHaveBeenCalled()
    }
  })

  it('改素材池时读不出现有素材池 → 503，不写库（不能在看不见的情况下抹掉推广期）', async () => {
    signedInAs(STAFF)
    const upsert = vi.fn(async () => ({ error: null }))
    mockFrom.mockImplementation(((table: string) => {
      if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }) }) }),
        upsert,
      }
    }) as never)

    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }] }),
      params(),
    )

    expect(res.status).toBe(503)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('界面保存素材池（带回旧条目）：已批准的保持 approved 和批准人/时间，新加的才是候选', async () => {
    signedInAs(STAFF)
    const approvedEntry = {
      kind: 'meta_video', ref: 'v1', status: 'approved', approved_by: 'boss@x.test', approved_at: '2026-10-18T00:00:00.000Z',
      promo_window: { kind: 'dated', start: '2026-10-21', end: '2026-11-30' },
    }
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [approvedEntry] }])
    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }, { kind: 'meta_video', ref: 'v9', status: 'candidate' }] }),
      params(),
    )
    expect(res.status).toBe(200)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.status).toBe('approved')
    expect(v1.approved_by).toBe('boss@x.test')
    expect(v1.approved_at).toBe('2026-10-18T00:00:00.000Z')
    const v9 = pool.find(e => e.ref === 'v9')!
    expect(v9.status).toBe('candidate')
    expect(v9).not.toHaveProperty('approved_by')
  })

  it('新加的素材 id 恰好是别的素材的别名 → 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
      { kind: 'meta_video', ref: 'v1', status: 'candidate', alias_refs: ['alias-1'] },
    ] }])
    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }, { kind: 'meta_video', ref: 'alias-1', status: 'candidate' }] }),
      params(),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('ref_conflicts_with_existing_alias')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('读完版本之后有人改了设置行 → 409，不覆盖（整数组读改写的并发保护）', async () => {
    signedInAs(STAFF)
    // 第 1 次 select = 读版本；第 2 次 = 读内容。两次之间模拟别处写了设置行。
    const table = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [] }], nth => {
      if (nth === 2) table.rows.get(CLIENT)!.updated_at = '2026-10-21T00:00:01.000Z'
    })
    const { upsert } = table
    const res = await PATCH(patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }] }), params())
    expect(res.status).toBe(409)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('付费客户门户成员改自治模式 → 403，不写库', async () => {
    signedInAs(PORTAL_MEMBER)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [] }])

    const res = await PATCH(patchRequest({ autonomy_mode: 'bounded_auto' }), params())

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('已存在素材的 kind 被改（meta_video → work_order）→ 400 creative_pool_kind_mismatch，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
      { kind: 'meta_video', ref: 'v1', status: 'approved', approved_by: 'boss@x.test', approved_at: '2026-10-18T00:00:00.000Z' },
    ] }])
    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'work_order', ref: 'v1', status: 'candidate' }] }),
      params(),
    )
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('creative_pool_kind_mismatch')
    expect(json.ref).toBe('v1')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('请求体里同一个 ref 出现两次 → 400 creative_pool_duplicate_ref，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [] }])
    const res = await PATCH(
      patchRequest({ creative_pool: [
        { kind: 'meta_video', ref: 'v1', status: 'candidate' },
        { kind: 'meta_video', ref: 'v1', status: 'candidate' },
      ] }),
      params(),
    )
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('creative_pool_duplicate_ref')
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('ad-strategy-config — 素材池版本（乐观锁）随界面往返', () => {
  it('GET 返回 version（= 库里 updated_at）', async () => {
    signedInAs(VIEWER)
    fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await GET(new NextRequest(url()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.version).toBe('2026-10-21T00:00:00.000Z')
  })

  it('PATCH 带 creative_pool 且 expected_version 与库里一致 → 200，响应里有 version', async () => {
    signedInAs(STAFF)
    fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await PATCH(
      patchRequest({
        creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }],
        expected_version: '2026-10-21T00:00:00.000Z',
      }), params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toHaveProperty('version')
    expect(typeof json.version).toBe('string')
  })

  it('expected_version 与库里不同 → 409 creative_pool_changed_concurrently，message 含「刷新」，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await PATCH(
      patchRequest({
        creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }],
        expected_version: '2026-10-20T00:00:00.000Z',
      }), params(),
    )
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe('creative_pool_changed_concurrently')
    expect(json.message).toContain('刷新')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('expected_version 是数字 → 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [] }])

    const res = await PATCH(
      patchRequest({
        creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }],
        expected_version: 123,
      }), params(),
    )

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('不带 expected_version 的老请求（带 creative_pool）仍然 200（行为不变）', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await PATCH(
      patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }] }),
      params(),
    )

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})

describe('ad-strategy-config — 版本读取顺序 / 老客户端 / 通知时间戳 / 400 说明', () => {
  it('GET：先读版本（select updated_at）再读内容，响应带 version', async () => {
    signedInAs(VIEWER)
    const { selects } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await GET(new NextRequest(url()), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(selects[0]).toBe('updated_at')
    expect(json.version).toBe('2026-10-21T00:00:00.000Z')
  })

  it('GET：版本读失败 → 503 config_version_unreadable', async () => {
    signedInAs(VIEWER)
    mockFrom.mockImplementation(((table: string) => {
      if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }),
          }),
        }),
      }
    }) as never)

    const res = await GET(new NextRequest(url()), params())
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toBe('config_version_unreadable')
  })

  it('PATCH 成功后：写入之后的第一次 select 是 updated_at（版本先于内容）', async () => {
    signedInAs(STAFF)
    const { selects } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await PATCH(patchRequest({ enabled: false }), params())
    expect(res.status).toBe(200)
    // 写入之前：读 before（内容）一次；写入之后：先读版本、再读内容。
    // 找写入之后第一次 select：写入发生在 upsert 里，之后 selects 里应出现 'updated_at'。
    const lastTwo = selects.slice(-2)
    expect(lastTwo[0]).toBe('updated_at')
  })

  it('PATCH 带 creative_pool 不带 expected_version → 200，且 console.warn 被调用一次', async () => {
    signedInAs(STAFF)
    fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [], updated_at: '2026-10-21T00:00:00.000Z' }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await PATCH(
        patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }] }),
        params(),
      )
      expect(res.status).toBe(200)
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('同一请求既改 autonomy_mode 又带 creative_pool：notify 的 updatedAt 等于实际写入行的 updated_at', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], autonomy_mode: 'observe', creative_pool: [], updated_at: '2026-10-21T00:00:00.000Z' }])

    const res = await PATCH(
      patchRequest({
        autonomy_mode: 'bounded_auto',
        creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }],
        expected_version: '2026-10-21T00:00:00.000Z',
      }),
      params(),
    )
    expect(res.status).toBe(200)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    const writtenRow = upsert.mock.calls[0][0]
    const notifyArgs = mockNotify.mock.calls[0]
    expect(notifyArgs[1]).toBe(writtenRow.updated_at)
  })

  it('三个 400 都带中文 message', async () => {
    signedInAs(STAFF)
    // duplicate_ref
    {
      fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [] }])
      const res = await PATCH(
        patchRequest({ creative_pool: [
          { kind: 'meta_video', ref: 'v1', status: 'candidate' },
          { kind: 'meta_video', ref: 'v1', status: 'candidate' },
        ] }),
        params(),
      )
      const json = await res.json()
      expect(res.status).toBe(400)
      expect(typeof json.message).toBe('string')
      expect(json.message.length).toBeGreaterThan(0)
    }
    // ref_conflicts_with_existing_alias
    {
      fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
        { kind: 'meta_video', ref: 'v1', status: 'candidate', alias_refs: ['alias-1'] },
      ] }])
      const res = await PATCH(
        patchRequest({ creative_pool: [{ kind: 'meta_video', ref: 'v1', status: 'candidate' }, { kind: 'meta_video', ref: 'alias-1', status: 'candidate' }] }),
        params(),
      )
      const json = await res.json()
      expect(res.status).toBe(400)
      expect(typeof json.message).toBe('string')
      expect(json.message.length).toBeGreaterThan(0)
    }
    // creative_pool_kind_mismatch
    {
      fakeTable([{ client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: [
        { kind: 'meta_video', ref: 'v1', status: 'approved', approved_by: 'boss@x.test', approved_at: '2026-10-18T00:00:00.000Z' },
      ] }])
      const res = await PATCH(
        patchRequest({ creative_pool: [{ kind: 'work_order', ref: 'v1', status: 'candidate' }] }),
        params(),
      )
      const json = await res.json()
      expect(res.status).toBe(400)
      expect(typeof json.message).toBe('string')
      expect(json.message.length).toBeGreaterThan(0)
    }
  })
})
