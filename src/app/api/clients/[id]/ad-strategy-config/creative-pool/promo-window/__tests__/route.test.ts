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

describe('creative-pool/promo-window — 内部员工设置', () => {
  it('设置 dated（未来）→ 200，写库：promo_window 正确、set_by 来自会话、set_at / changed_at 合法 ISO，其它条目原样', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2099-01-01', end: '2099-12-31' } }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written] = upsert.mock.calls[0]
    const pool = written.creative_pool as Array<Record<string, unknown>>
    const v1 = pool.find(e => e.ref === 'v1')!
    expect(v1.promo_window).toEqual({ kind: 'dated', start: '2099-01-01', end: '2099-12-31' })
    expect(v1.promo_window_set_by).toBe(STAFF)
    expect(typeof v1.promo_window_set_at).toBe('string')
    expect(Number.isNaN(Date.parse(v1.promo_window_set_at as string))).toBe(false)
    expect(typeof v1.promo_window_changed_at).toBe('string')
    expect(Number.isNaN(Date.parse(v1.promo_window_changed_at as string))).toBe(false)
    const wo9 = pool.find(e => e.ref === 'wo-9')!
    expect(wo9).toEqual(SEED_POOL[1])
    expect(json.config.creative_pool.find((e: { ref: string }) => e.ref === 'v1').promo_window).toEqual({
      kind: 'dated',
      start: '2099-01-01',
      end: '2099-12-31',
    })
  })

  it('再次设置同样内容 → set_at / changed_at 都保持原值', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const first = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2099-01-01', end: '2099-12-31' } }),
      params(),
    )
    expect(first.status).toBe(200)
    const firstPool = upsert.mock.calls[0][0].creative_pool as Array<Record<string, unknown>>
    const firstV1 = firstPool.find(e => e.ref === 'v1')!
    const setAt = firstV1.promo_window_set_at
    const changedAt = firstV1.promo_window_changed_at

    const second = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2099-01-01', end: '2099-12-31' } }),
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
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2099-01-01', end: '2099-12-31' } }),
      params(),
    )
    expect(first.status).toBe(200)
    const firstPool = upsert.mock.calls[0][0].creative_pool as Array<Record<string, unknown>>
    const firstV1 = firstPool.find(e => e.ref === 'v1')!
    const setAt = firstV1.promo_window_set_at
    const changedAt = firstV1.promo_window_changed_at

    const second = await POST(
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2099-02-01', end: '2099-12-31' } }),
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
      postRequest({ ref: 'v1', promo_window: { kind: 'dated', start: '2099-12-31', end: '2099-01-01' } }),
      params(),
    )

    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('非法 promo_window（缺 kind）→ 400，不写库', async () => {
    signedInAs(STAFF)
    const { upsert } = fakeTable([seedRow()])

    const res = await POST(
      postRequest({ ref: 'v1', promo_window: { start: '2099-01-01', end: '2099-12-31' } }),
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
