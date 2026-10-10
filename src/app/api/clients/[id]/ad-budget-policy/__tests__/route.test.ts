/**
 * 客户广告预算管控配置接口（ads IMPACT 阶段 2，设计 §4.1 硬前置第 2 条 / §14 M4）。
 *
 * 测试盯三种静默出错，跟 ad-outcome-config 同一套：
 *   - 客户成员（非内部员工）自己改掉，等于自己决定自己的钱能不能被动 → 403 且不写库
 *   - 存进非法配置（上限 0、变动上限超 100%、locked 不是布尔）→ 400 且不写库
 *   - migration 还没 apply 时把原始报错 500 甩给界面 → 503 人话
 * 以及本 PR 的核心断言：GET 在 no_row / read_error 时下发的 policy 必须是锁定的。
 *
 * 假 supabase 按表建模：只认 ad_strategy_configs，一张按 client_id 存行的内存表；
 * 读回走真实的 loadBudgetPolicy，写进去什么就读出来什么。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: vi.fn() }))
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { GET, PATCH } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockGuard = vi.mocked(guardGlobalAdmin)
const mockSession = vi.mocked(requireSession)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const STAFF = 'fde@magicengine.cloud'

type Row = Record<string, unknown>

/** ad_strategy_configs 的内存假表。upsertError 非空时模拟写库失败。 */
function fakeTable(initial: Row[] = [], upsertError: { code?: string; message: string } | null = null) {
  const rows = new Map<string, Row>(initial.map(r => [String(r.client_id), r]))
  const upsert = vi.fn(async (row: Row, opts: { onConflict: string }) => {
    if (upsertError) return { error: upsertError }
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

function patchRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-budget-policy`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-budget-policy`)
}

const VALID = {
  budget_locked: false,
  total_daily_cap_minor: 500000,
  per_unit_daily_change_cap_pct: 15,
}

beforeEach(() => {
  mockAccess.mockResolvedValue({
    ok: true, user: { email: STAFF } as never, role: 'admin', tier: 'admin', allowedClientId: null,
  } as never)
  mockGuard.mockResolvedValue(null)
  mockSession.mockResolvedValue({ ok: true, user: { email: STAFF } as never })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ad-budget-policy — GET 缺行 / 读错误必须锁定（M4）', () => {
  it('没有配置行 → source no_row，policy.locked=true', async () => {
    fakeTable()
    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.source).toBe('no_row')
    expect(json.policy).toEqual({ locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null })
  })

  it('有行且显式 budget_locked=false → 不锁定，两个上限原样下发', async () => {
    fakeTable([{ client_id: CLIENT, budget_locked: false, total_daily_cap_minor: 500000, per_unit_daily_change_cap_pct: 15 }])
    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(json.source).toBe('row')
    expect(json.policy).toEqual({ locked: false, totalDailyCapMinor: 500000, perUnitDailyChangeCapPct: 15 })
  })

  it('不是这个客户的成员 → 照访问闸的状态码拒绝，不读库', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('ad-budget-policy — PATCH 谁能改', () => {
  it('客户成员（非内部员工）→ 403，且不写库', async () => {
    mockAccess.mockResolvedValue({
      ok: true, user: { email: 'bdm@client.co.nz' } as never, role: 'client-viewer', tier: 'paid_client', allowedClientId: CLIENT,
    } as never)
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    mockSession.mockResolvedValue({ ok: true, user: { email: 'bdm@client.co.nz' } as never })
    const { upsert } = fakeTable()

    const res = await PATCH(patchRequest(VALID), params())

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('ad-budget-policy — PATCH 能存什么', () => {
  it.each([
    ['budget_locked 缺失', { total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null }],
    ['budget_locked 是字符串', { ...VALID, budget_locked: 'false' }],
    ['budget_locked 是 0/1（非布尔）', { ...VALID, budget_locked: 0 }],
  ])('%s → 400，不写库', async (_name, body) => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest(body), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['总花费上限 0', { ...VALID, total_daily_cap_minor: 0 }],
    ['总花费上限负数', { ...VALID, total_daily_cap_minor: -100 }],
    ['总花费上限非整数', { ...VALID, total_daily_cap_minor: 100.5 }],
    ['总花费上限是字符串', { ...VALID, total_daily_cap_minor: '500000' }],
    ['总花费上限天文数字', { ...VALID, total_daily_cap_minor: 1e15 }],
  ])('%s → 400，不写库', async (_name, body) => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest(body), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([
    ['变动上限 0', { ...VALID, per_unit_daily_change_cap_pct: 0 }],
    ['变动上限负数', { ...VALID, per_unit_daily_change_cap_pct: -5 }],
    ['变动上限超 100', { ...VALID, per_unit_daily_change_cap_pct: 150 }],
    ['变动上限是字符串', { ...VALID, per_unit_daily_change_cap_pct: '15' }],
  ])('%s → 400，不写库', async (_name, body) => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest(body), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('两个上限都留空（只改 locked）→ 允许', async () => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest({ budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null }), params())
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('合法写入：upsert 按 client_id，带修改人与修改时间，读回新配置', async () => {
    const { upsert, rows } = fakeTable([{ client_id: CLIENT, enabled: true }])

    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'client_id' })
    expect(written).toMatchObject({ client_id: CLIENT, ...VALID, budget_policy_updated_by: STAFF })
    expect(Number.isNaN(Date.parse(String(written.budget_policy_updated_at)))).toBe(false)
    expect(rows.get(CLIENT)?.enabled).toBe(true) // 不碰广告健康监测开关
    expect(json.policy).toEqual({ locked: false, totalDailyCapMinor: 500000, perUnitDailyChangeCapPct: 15 })
  })

  it('把锁定改回 true 且清空两个上限 → 允许并原样存 null', async () => {
    const { upsert } = fakeTable([{ client_id: CLIENT, budget_locked: false, total_daily_cap_minor: 500000, per_unit_daily_change_cap_pct: 15 }])
    const res = await PATCH(patchRequest({ budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null }), params())
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][0]).toMatchObject({ budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null })
  })

  it.each([
    ['PostgREST 找不到列', { code: 'PGRST204', message: "Could not find the 'budget_locked' column of 'ad_strategy_configs' in the schema cache" }],
    ['Postgres 列不存在', { code: '42703', message: 'column "budget_locked" of relation "ad_strategy_configs" does not exist' }],
  ])('数据库还没升级（%s）→ 503 人话，不甩原始报错', async (_name, err) => {
    fakeTable([], err)
    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.error).toBe('数据库还没升级，请联系技术')
    expect(JSON.stringify(json)).not.toContain('schema cache')
  })

  it('其它写库错误 → 500 人话，不甩原始报错', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fakeTable([], { code: '23514', message: 'violates check constraint ad_strategy_configs_total_daily_cap_chk' })
    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(JSON.stringify(json)).not.toContain('constraint')
  })
})
