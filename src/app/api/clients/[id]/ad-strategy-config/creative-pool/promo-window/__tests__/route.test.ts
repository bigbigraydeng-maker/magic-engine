/**
 * 素材池"设置推广期"接口 —— 谁能设、设什么、什么时候刷新时间戳。
 *
 * promo_window_set_by 必须由服务端从会话派生，绝不接受客户端传入。
 * 测试盯的是：
 *   - 内部员工设置 dated（未来）→ 写库，set_by 来自会话，set_at / changed_at 是合法 ISO
 *   - 再次设置同样内容 → set_at / changed_at 都保持原值
 *   - 再次设置不同内容 → set_at 保持原值，changed_at 变成新值
 *   - end 在过去 → 422，不写库
 *   - 非法 promo_window → 400，不写库
 *   - body 夹带 promo_window_set_by → 400，不写库
 *   - alias 冲突 → 409，不写库
 *   - alias_refs 写入并去重；空数组清空
 *   - ref 不在池 → 404
 *   - 付费客户门户成员 / 未登录 → 403 / 401，不写库
 *
 * 用真的 requireGlobalAdmin + 真的白名单（只假登录态和 env）。
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

const CLIENT = 'client-uuid-creative-pool-promo-window-test'
const STAFF = 'fde@staff.test'
const VIEWER = 'bdm@client.test'
const DEMO = 'demo@staff.test'
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
  return `http://localhost:3001/api/clients/${CLIENT}/ad-strategy-config/creative-pool/promo-window`
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

const STAFF2 = 'second@staff.test'
const NOW_ISO = '2026-10-21T00:00:00.000Z' // 新西兰 10/21 13:00

beforeEach(() => {
  // 固定时钟：同毫秒变异和日期边界都要能被测出来
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW_ISO))
  vi.stubEnv('ADMIN_EMAILS', `${STAFF},${STAFF2}`)
  vi.stubEnv('ADMIN_EMAIL_DOMAIN', '')
  vi.stubEnv('CLIENT_VIEWERS', `${VIEWER}:${CLIENT}`)
  vi.stubEnv('DEMO_ADMINS', `${DEMO}:${CLIENT}`)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('creative-pool/promo-window — 内部员工设置', () => {
  it('设置 dated（未来）→ 200，写库：promo_window 正确、set_by 来自会话、set_at / changed_at 合法 ISO，其它条目原样', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-12-31' } }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.promo_window).toEqual({ kind: 'dated', start: '2026-11-01', end: '2026-12-31' })
    expect(v1.promo_window_set_by).toBe(STAFF)
    expect(typeof v1.promo_window_set_at).toBe('string')
    expect(Number.isNaN(Date.parse(v1.promo_window_set_at as string))).toBe(false)
    expect(typeof v1.promo_window_changed_at).toBe('string')
    expect(Number.isNaN(Date.parse(v1.promo_window_changed_at as string))).toBe(false)
    const wo9 = pool.find(e => e.ref === 'wo-9')!
    expect(wo9).toEqual(SEED_POOL[1])
    expect(json.config.creative_pool.find((e: { ref: string }) => e.ref === 'v1').promo_window).toEqual({
      kind: 'dated',
      start: '2026-11-01',
      end: '2026-12-31',
    })
  })

  it('再次设置同样内容 → set_at / changed_at 都保持原值', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const first = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-12-31' } }),
      params(),
    )
    expect(first.status).toBe(200)
    const firstPool = upsert.mock.calls[0][0].creative_pool as Array<Record<string, unknown>>
    const firstV1 = firstPool.find(e => e.ref === 'v1')!
    const setAt = firstV1.promo_window_set_at
    const changedAt = firstV1.promo_window_changed_at

    const second = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-12-31' } }),
      params(),
    )
    expect(second.status).toBe(200)
    const secondPool = upsert.mock.calls[1][0].creative_pool as Array<Record<string, unknown>>
    const secondV1 = secondPool.find(e => e.ref === 'v1')!
    expect(secondV1.promo_window_set_at).toBe(setAt)
    expect(secondV1.promo_window_changed_at).toBe(changedAt)
  })

  it('再次设置不同内容 → set_at 保持原值，changed_at 变成新值', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const first = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-01', end: '2026-12-31' } }),
      params(),
    )
    expect(first.status).toBe(200)
    const firstPool = upsert.mock.calls[0][0].creative_pool as Array<Record<string, unknown>>
    const firstV1 = firstPool.find(e => e.ref === 'v1')!
    const setAt = firstV1.promo_window_set_at
    const changedAt = firstV1.promo_window_changed_at

    vi.setSystemTime(new Date('2026-10-22T00:00:00.000Z'))
    const second = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-11-15', end: '2026-12-31' } }),
      params(),
    )
    expect(second.status).toBe(200)
    const secondPool = upsert.mock.calls[1][0].creative_pool as Array<Record<string, unknown>>
    const secondV1 = secondPool.find(e => e.ref === 'v1')!
    expect(secondV1.promo_window_set_at).toBe(setAt)
    expect(secondV1.promo_window_changed_at).not.toBe(changedAt)
    expect(typeof secondV1.promo_window_changed_at).toBe('string')
    expect(Number.isNaN(Date.parse(secondV1.promo_window_changed_at as string))).toBe(false)
  })

  it('end 在过去 → 422 promo_window_end_in_past，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2020-01-01', end: '2020-12-31' } }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toBe('promo_window_end_in_past')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('非法 promo_window（start>end）→ 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-12-31', end: '2026-11-01' } }),
      params(),
    )

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('非法 promo_window（缺 kind）→ 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { start: '2026-11-01', end: '2026-12-31' } }),
      params(),
    )

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('body 夹带 promo_window_set_by → 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({
        ref: 'v1',
        promo_window: { kind: 'evergreen' },
        promo_window_set_by: 'attacker@x',
      }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe('only ref, promo_window, alias_refs are accepted')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('alias 等于另一条的 ref → 409 alias_conflict，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({
        ref: 'v1',
        promo_window: { kind: 'evergreen' },
        alias_refs: ['wo-9'],
      }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe('alias_conflict')
    expect(json.alias).toBe('wo-9')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('alias_refs 写入并去重', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({
        ref: 'v1',
        promo_window: { kind: 'evergreen' },
        alias_refs: ['a1', 'a1', 'a2'],
      }),
      params(),
    )

    expect(res.status).toBe(200)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.alias_refs).toEqual(['a1', 'a2'])
  })

  it('alias_refs 给空数组 → 清空', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([
      {
        client_id: CLIENT,
        enabled: true,
        digest_recipients: [],
        creative_pool: [
          { kind: 'meta_video', ref: 'v1', status: 'candidate', alias_refs: ['old1', 'old2'] },
          SEED_POOL[1],
        ],
      },
    ])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'evergreen' }, alias_refs: [] }),
      params(),
    )

    expect(res.status).toBe(200)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.alias_refs).toBeUndefined()
  })

  it('ref 不在池 → 404，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'nope', promo_window: { kind: 'evergreen' } }),
      params(),
    )

    expect(res.status).toBe(404)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('creative-pool/promo-window — 非内部员工设不动', () => {
  it('付费客户门户成员 → 403，不写库', async () => {
    signedInAs(PORTAL_MEMBER)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'evergreen' } }),
      params(),
    )

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('没登录 → 401，不写库', async () => {
    mockAccess.mockResolvedValue({ ok: true, user: { email: STAFF } as never } as never)
    mockSession.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'evergreen' } }),
      params(),
    )

    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })
})

const DATED = { kind: 'dated', start: '2026-10-21', end: '2026-11-30' }
const APPROVED = { approved_by: 'earlier@staff.test', approved_at: '2026-09-01T00:00:00.000Z' }

function poolRow(pool: Row[]): Row {
  return { client_id: CLIENT, enabled: true, digest_recipients: [], creative_pool: pool }
}

function lastPool(upsert: { mock: { calls: Array<[Row, unknown]> } }): Array<Record<string, unknown>> {
  const calls = upsert.mock.calls
  return calls[calls.length - 1][0].creative_pool as Array<Record<string, unknown>>
}

describe('creative-pool/promo-window — 日期边界（固定时钟）', () => {
  it('end = 今天（新西兰日期）→ 允许', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])
    const res = await POST(postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-10-21', end: '2026-10-21' } }), params())
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('UTC 还是 10/20 但新西兰已是 10/21：end=10/20 → 422（按新西兰日期算）', async () => {
    signedInAs(STAFF)
    vi.setSystemTime(new Date('2026-10-20T11:30:00.000Z')) // 新西兰 10/21 00:30
    const { upsert } = fakeTable([seedRow()])
    const res = await POST(postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-10-01', end: '2026-10-20' } }), params())
    expect(res.status).toBe(422)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('新西兰还是 10/20 23:30：end=10/20 → 允许', async () => {
    signedInAs(STAFF)
    vi.setSystemTime(new Date('2026-10-20T10:30:00.000Z')) // 新西兰 10/20 23:30
    const { upsert } = fakeTable([seedRow()])
    const res = await POST(postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-10-01', end: '2026-10-20' } }), params())
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('end 超过今天往后 12 个月 → 422 promo_window_end_too_far；正好 12 个月 → 允许', async () => {
    signedInAs(STAFF)
    const far = fakeTable([seedRow()])
    const tooFar = await POST(postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-10-21', end: '2027-10-22' } }), params())
    expect(tooFar.status).toBe(422)
    expect((await tooFar.json()).error).toBe('promo_window_end_too_far')
    expect(far.upsert).not.toHaveBeenCalled()
    const edge = fakeTable([seedRow()])
    const ok = await POST(postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2026-10-21', end: '2027-10-21' } }), params())
    expect(ok.status).toBe(200)
    expect(edge.upsert).toHaveBeenCalledTimes(1)
  })
})

describe('creative-pool/promo-window — 已批准条目改动 / 设置人 / 别名 / 并发', () => {
  it('已批准且原来没有推广期：首次声明 → 降回 candidate 并清掉批准人和时间', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([{ kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED }])])
    const res = await POST(postRequest({ ref: 'a', promo_window: DATED }), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.demoted_to_candidate).toBe(true)
    const a = lastPool(upsert).find(e => e.ref === 'a')!
    expect(a.status).toBe('candidate')
    expect(a).not.toHaveProperty('approved_by')
    expect(a).not.toHaveProperty('approved_at')
  })

  it('已批准：结束日延后 → 降回 candidate 并清掉批准人和时间', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([{ kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED, promo_window: DATED }])])
    const res = await POST(postRequest({ ref: 'a', promo_window: { ...DATED, end: '2026-12-31' } }), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.demoted_to_candidate).toBe(true)
    const a = lastPool(upsert).find(e => e.ref === 'a')!
    expect(a.status).toBe('candidate')
    expect(a).not.toHaveProperty('approved_by')
    expect(a).not.toHaveProperty('approved_at')
  })

  it('已批准：改成长期有效 / 开始日提前 → 降回 candidate；结束日提前（收窄）→ 保持 approved', async () => {
    signedInAs(STAFF)
    for (const [win, expected] of [
      [{ kind: 'evergreen' }, 'candidate'],
      [{ ...DATED, start: '2026-10-01' }, 'candidate'],
      [{ ...DATED, end: '2026-11-15' }, 'approved'],
    ] as const) {
      const { upsert } = fakeTable([poolRow([{ kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED, promo_window: DATED }])])
      const res = await POST(postRequest({ ref: 'a', promo_window: win }), params())
      expect(res.status).toBe(200)
      expect(lastPool(upsert).find(e => e.ref === 'a')!.status).toBe(expected)
    }
  })

  it('已批准：增减别名 → 降回 candidate（别名决定哪些广告归这条素材管）', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([{ kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED, promo_window: DATED, alias_refs: ['x1'] }])])
    const res = await POST(postRequest({ ref: 'a', promo_window: DATED, alias_refs: ['x1', 'x2'] }), params())
    expect(res.status).toBe(200)
    const a = lastPool(upsert).find(e => e.ref === 'a')!
    expect(a.status).toBe('candidate')
    expect(a.promo_window_changed_at).toBe(NOW_ISO)
  })

  it('别名没变、推广期没变：已批准条目保持 approved，changed_at 不动', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([{
      kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED, promo_window: DATED, alias_refs: ['x1', 'x2'],
      promo_window_set_by: STAFF, promo_window_set_at: '2026-10-01T00:00:00.000Z', promo_window_changed_at: '2026-10-01T00:00:00.000Z',
    }])])
    const res = await POST(postRequest({ ref: 'a', promo_window: DATED, alias_refs: ['x2', 'x1'] }), params())
    expect(res.status).toBe(200)
    const a = lastPool(upsert).find(e => e.ref === 'a')!
    expect(a.status).toBe('approved')
    expect(a.promo_window_changed_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('另一个员工重复提交：set_by / set_at 保持第一次设置的人和时间', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])
    await POST(postRequest({ ref: 'v1', promo_window: DATED }), params())
    const first = lastPool(upsert).find(e => e.ref === 'v1')!
    vi.setSystemTime(new Date('2026-10-22T00:00:00.000Z'))
    signedInAs(STAFF2)
    await POST(postRequest({ ref: 'v1', promo_window: DATED }), params())
    const second = lastPool(upsert).find(e => e.ref === 'v1')!
    expect(second.promo_window_set_by).toBe(STAFF)
    expect(second.promo_window_set_at).toBe(first.promo_window_set_at)
    expect(second.promo_window_changed_at).toBe(first.promo_window_changed_at)
  })

  it('别名等于另一条的别名 → 409 alias_conflict，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([
      { kind: 'meta_video', ref: 'a', status: 'candidate' },
      { kind: 'meta_video', ref: 'b', status: 'candidate', alias_refs: ['shared'] },
    ])])
    const res = await POST(postRequest({ ref: 'a', promo_window: DATED, alias_refs: ['shared'] }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).alias).toBe('shared')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('读完版本之后有人改了设置行 → 409 creative_pool_changed_concurrently，不覆盖', async () => {
    signedInAs(STAFF)
    // 第 1 次 select = 读版本；第 2 次 = 读内容。两次之间模拟别处写了设置行。
    const table = fakeTable([seedRow()], nth => {
      if (nth === 2) table.rows.get(CLIENT)!.updated_at = '2026-10-21T00:00:01.000Z'
    })
    const { upsert } = table
    const res = await POST(postRequest({ ref: 'v1', promo_window: DATED }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('creative_pool_changed_concurrently')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('已批准且原来没有推广期：首次声明长期有效 → 降回 candidate 并清掉批准人和时间', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([{ kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED }])])
    const res = await POST(postRequest({ ref: 'a', promo_window: { kind: 'evergreen' } }), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.demoted_to_candidate).toBe(true)
    const a = lastPool(upsert).find(e => e.ref === 'a')!
    expect(a.status).toBe('candidate')
    expect(a).not.toHaveProperty('approved_by')
    expect(a).not.toHaveProperty('approved_at')
  })

  it('已批准但库里的 promo_window 读不懂 → 重新声明合法 dated → 降回 candidate', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([poolRow([{
      kind: 'meta_video', ref: 'a', status: 'approved', ...APPROVED,
      promo_window: { kind: 'dated', start: '2026-12-01', end: '2026-11-01' },
    }])])
    const res = await POST(postRequest({ ref: 'a', promo_window: DATED }), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.demoted_to_candidate).toBe(true)
    const a = lastPool(upsert).find(e => e.ref === 'a')!
    expect(a.status).toBe('candidate')
    expect(a).not.toHaveProperty('approved_by')
    expect(a).not.toHaveProperty('approved_at')
  })

  it('成功响应里 version 的取得顺序：写入之后第一次 select 是 updated_at', async () => {
    signedInAs(STAFF)
    const { selects } = fakeTable([seedRow()])
    const res = await POST(postRequest({ ref: 'v1', promo_window: DATED }), params())
    expect(res.status).toBe(200)
    // 写入之前：读版本、读内容；写入之后：先读版本、再读内容。
    // 写入之后第一次 select 应该是 'updated_at'。
    const lastTwo = selects.slice(-2)
    expect(lastTwo[0]).toBe('updated_at')
  })
})

describe('creative-pool/promo-window — 写入成功后读回内容失败', () => {
  it('写入成功但读回内容失败 → 200，version_unreadable=true，无 version 键', async () => {
    signedInAs(STAFF)
    // 写入之前：读版本（updated_at）、读内容（config）。写入之后：读版本成功、读内容失败。
    // 用 select 的列名区分：updated_at 永远成功；内容列在写入之后（第 2 次及以后）失败。
    let contentSelects = 0
    const rows = new Map<string, Row>([[CLIENT, {
      client_id: CLIENT, enabled: true, digest_recipients: [], updated_at: '2026-10-20T00:00:00.000Z',
      creative_pool: [
        { kind: 'meta_video', ref: 'v1', status: 'candidate' },
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

    const res = await POST(postRequest({ ref: 'v1', promo_window: DATED }), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.version_unreadable).toBe(true)
    expect(json).not.toHaveProperty('version')
  })
})
