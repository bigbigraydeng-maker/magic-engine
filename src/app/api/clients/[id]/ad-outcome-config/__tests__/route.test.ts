/**
 * 客户结果阶梯配置接口（ads IMPACT 阶段 1，设计 §3.2 / §7 L4）。
 *
 * 这几项决定诊断会不会对客户报「花钱没结果」「钱和结果错配」，测试盯三种静默出错：
 *   - 客户成员（非内部员工）自己改掉，等于自己关掉自己的预警 → 403 且不写库
 *   - 存进矛盾 / 非法的阶梯（主结果排在领先结果前面、目标成本 0）→ 400 且不写库
 *   - migration 还没 apply 时把原始报错 500 甩给界面 → 503 人话
 *
 * 假 supabase 按表建模：只认 ad_strategy_configs，一张按 client_id 存行的内存表；
 * 读回走真实的 loadOutcomeConfig，写进去什么就读出来什么。
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
import { OUTCOME_STEPS } from '@/lib/ads-strategy/portfolio/outcome-ladder'

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
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-outcome-config`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/ad-outcome-config`)
}

const VALID = {
  leading_result: 'messaging_started',
  primary_result: 'lead',
  target_cost_per_primary: 25,
  min_primary_per_unit: 5,
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

describe('ad-outcome-config — GET', () => {
  it('下发阶梯选项（值 + 中文标签，按阶梯顺序）和已存配置', async () => {
    fakeTable([{
      client_id: CLIENT, leading_result: 'messaging_started', primary_result: 'lead',
      target_cost_per_primary: '25', min_primary_per_unit: 8,
    }])

    const res = await GET(getRequest(), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.steps.map((s: { value: string }) => s.value)).toEqual([...OUTCOME_STEPS])
    expect(json.steps[3]).toEqual({ value: 'messaging_started', label: '私信开聊' })
    expect(json.source).toBe('row')
    expect(json.config).toEqual({
      leading: 'messaging_started', primary: 'lead', targetCostPerPrimary: 25, minPrimaryPerUnit: 8,
    })
  })

  it('没有配置行 → 空配置且标 no_row，不猜行业默认', async () => {
    fakeTable()
    const json = await (await GET(getRequest(), params())).json()
    expect(json.source).toBe('no_row')
    expect(json.config).toEqual({ leading: null, primary: null, targetCostPerPrimary: null, minPrimaryPerUnit: 5 })
  })

  it('不是这个客户的成员 → 照访问闸的状态码拒绝，不读库', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

describe('ad-outcome-config — PATCH 谁能改', () => {
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

describe('ad-outcome-config — PATCH 能存什么', () => {
  it.each([
    ['领先结果不在阶梯里', { ...VALID, leading_result: 'purchase' }],
    ['主结果不在阶梯里', { ...VALID, primary_result: 'ROAS' }],
  ])('%s → 400，不写库', async (_name, body) => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest(body), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('主结果排在领先结果前面 → 400 中文错误，不写库', async () => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest({ ...VALID, leading_result: 'lead', primary_result: 'engagement' }), params())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('主结果')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('领先结果与主结果相同 → 允许', async () => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest({ ...VALID, leading_result: 'lead', primary_result: 'lead' }), params())
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['目标成本 0', { ...VALID, target_cost_per_primary: 0 }],
    ['目标成本负数', { ...VALID, target_cost_per_primary: -10 }],
    ['目标成本是字符串', { ...VALID, target_cost_per_primary: '25' }],
    ['最低数 0', { ...VALID, min_primary_per_unit: 0 }],
    ['最低数小数', { ...VALID, min_primary_per_unit: 2.5 }],
    ['最低数缺失', { leading_result: 'lead', primary_result: 'lead', target_cost_per_primary: null }],
    ['目标成本天文数字（悄悄关掉 D3）', { ...VALID, target_cost_per_primary: 1e308 }],
    ['最低数天文数字（悄悄关掉 D5）', { ...VALID, min_primary_per_unit: 1_000_000 }],
  ])('%s → 400，不写库', async (_name, body) => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest(body), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('合法写入：upsert 按 client_id，带修改人与修改时间，读回新配置', async () => {
    const { upsert, rows } = fakeTable([{ client_id: CLIENT, enabled: true, min_primary_per_unit: 5 }])

    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'client_id' })
    expect(written).toMatchObject({ client_id: CLIENT, ...VALID, outcome_config_updated_by: STAFF })
    expect(Number.isNaN(Date.parse(String(written.outcome_config_updated_at)))).toBe(false)
    expect(rows.get(CLIENT)?.enabled).toBe(true) // 不碰广告健康监测开关
    expect(json.config).toEqual({
      leading: 'messaging_started', primary: 'lead', targetCostPerPrimary: 25, minPrimaryPerUnit: 5,
    })
  })

  it('目标成本留空 = null 可存（不判「花钱没结果」）', async () => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest({ ...VALID, leading_result: null, primary_result: null, target_cost_per_primary: null }), params())
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][0]).toMatchObject({ leading_result: null, primary_result: null, target_cost_per_primary: null })
  })

  it.each([
    ['PostgREST 找不到列', { code: 'PGRST204', message: "Could not find the 'leading_result' column of 'ad_strategy_configs' in the schema cache" }],
    ['Postgres 列不存在', { code: '42703', message: 'column "leading_result" of relation "ad_strategy_configs" does not exist' }],
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
    fakeTable([], { code: '23514', message: 'violates check constraint ad_strategy_configs_target_cost_chk' })
    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(JSON.stringify(json)).not.toContain('constraint')
  })
})
