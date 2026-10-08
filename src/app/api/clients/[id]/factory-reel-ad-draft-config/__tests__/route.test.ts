/**
 * 工厂 Reel 自动起草广告 · 每客户开关 + 参数接口。
 *
 * 测试盯几种静默出错：
 *   - 客户成员（非内部员工）自己开自动花钱 → 403 且不读不写
 *   - 非法参数（预算超上限、mode 不在词表里）→ 400 且不写库
 *   - 客户端自己塞 updated_by / 未知键 → 不落库
 *   - migration 还没 apply 时把原始报错甩给界面 → 503 人话
 *   - 其它写库错误 → 500 人话，不甩原始报错
 *
 * 假 supabase 按表建模：只认 ad_strategy_configs，一张按 client_id 存行的内存表；
 * 读回走真实的 loadFactoryReelDraftConfig，写进去什么就读出来什么。
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
import { MAX_AUTO_DAILY_BUDGET } from '@/lib/ads-strategy/ad-draft'

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
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/factory-reel-ad-draft-config`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/factory-reel-ad-draft-config`)
}

const VALID = {
  mode: 'dry_run',
  geo_countries: ['NZ'],
  geo_city_keys: ['auckland'],
  age_min: 18,
  age_max: 45,
  daily_budget: 20,
  duration_days: 7,
  max_age_hours: 24,
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

describe('factory-reel-ad-draft-config — GET', () => {
  it('非内部员工 → 403，且不读库', async () => {
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await GET(getRequest(), params())
    expect(res.status).toBe(403)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('已存 dry_run → 200，effectiveMode 为 dry_run', async () => {
    fakeTable([{ client_id: CLIENT, factory_reel_ad_draft: { ...VALID, mode: 'dry_run' } }])
    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.effectiveMode).toBe('dry_run')
    expect(json.source).toBe('row')
    expect(json.modes).toEqual(['off', 'dry_run', 'on'])
  })

  it('没有配置行 → 200，config 为 null，effectiveMode off，source no_row', async () => {
    fakeTable()
    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.config).toBeNull()
    expect(json.effectiveMode).toBe('off')
    expect(json.source).toBe('no_row')
  })

  it('存的值非法 → effectiveMode off，source invalid_value', async () => {
    fakeTable([{ client_id: CLIENT, factory_reel_ad_draft: { ...VALID, mode: 'maybe' } }])
    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.effectiveMode).toBe('off')
    expect(json.source).toBe('invalid_value')
  })

  it('migration 还没 apply（列不存在）→ 503 人话', async () => {
    mockFrom.mockImplementation(((table: string) => {
      if (table !== 'ad_strategy_configs') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: '42703', message: 'column "factory_reel_ad_draft" does not exist' },
            }),
          }),
        }),
      }
    }) as never)

    const res = await GET(getRequest(), params())
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.error).toBe('数据库还没升级，请联系技术')
  })
})

describe('factory-reel-ad-draft-config — PATCH 谁能改', () => {
  it('非内部员工 → 403，且不写库', async () => {
    mockGuard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest(VALID), params())
    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('factory-reel-ad-draft-config — PATCH 能存什么', () => {
  it('请求体不是合法 JSON → 400', async () => {
    fakeTable()
    const req = new NextRequest(`http://localhost:3001/api/clients/${CLIENT}/factory-reel-ad-draft-config`, {
      method: 'PATCH',
      body: '{ not json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, params())
    expect(res.status).toBe(400)
  })

  it('daily_budget 超过自动发布上限 → 400，不写库', async () => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest({ ...VALID, daily_budget: MAX_AUTO_DAILY_BUDGET + 1 }), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('mode 不在词表里 → 400，不写库', async () => {
    const { upsert } = fakeTable()
    const res = await PATCH(patchRequest({ ...VALID, mode: 'maybe' }), params())
    expect(res.status).toBe(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('合法写入：upsert 按 client_id，带修改人与修改时间，忽略客户端塞的 updated_by 和未知键', async () => {
    const { upsert, rows } = fakeTable([{ client_id: CLIENT, enabled: true }])

    const res = await PATCH(
      patchRequest({ ...VALID, updated_by: 'evil@example.test', foo: 'bar' }),
      params(),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledTimes(1)
    const [written, opts] = upsert.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'client_id' })
    expect(written.client_id).toBe(CLIENT)

    const stored = written.factory_reel_ad_draft as Record<string, unknown>
    expect(stored.updated_by).toBe(STAFF)
    expect(stored.updated_by).not.toBe('evil@example.test')
    expect(stored.foo).toBeUndefined()
    expect(Number.isNaN(Date.parse(String(stored.updated_at)))).toBe(false)

    expect(rows.get(CLIENT)?.enabled).toBe(true) // 不碰广告健康监测开关
    expect(json.effectiveMode).toBe('dry_run')
  })

  it('数据库还没升级（42703）→ 503 人话', async () => {
    fakeTable([], { code: '42703', message: 'column "factory_reel_ad_draft" does not exist' })
    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.error).toBe('数据库还没升级，请联系技术')
  })

  it('其它写库错误 → 500 人话，不甩原始报错', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fakeTable([], { code: 'XX000', message: 'secret detail' })
    const res = await PATCH(patchRequest(VALID), params())
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(JSON.stringify(json)).not.toContain('secret detail')
  })
})
